/**
 * Conservative GPU occlusion culling for the terrain columns.
 *
 * Every drawn column gets an invisible proxy box (its tight bounds, padded) that is
 * drawn after the opaque terrain with colour and depth writes off, wrapped in an
 * ANY_SAMPLES_PASSED_CONSERVATIVE query (onBeforeRender / onAfterRender, so it
 * works in whatever framebuffer three.js is rendering the scene into: the canvas,
 * or any render target). Results are read in later frames
 * (never stalling) and decide whether the column is drawn:
 *
 * - a column is culled only when its latest query found no visible sample, that
 *   query is fresh (issued ≤ MAX_RESULT_AGE frames ago) and it has not passed for
 *   HOLD_FRAMES frames (hysteresis: false-visible is cheap, false-hidden pops);
 * - never culled: the camera is inside / within NEAR_PAD of its box, the column is
 *   mid LOD-crossfade (both halves of the dither must draw), or the camera just
 *   jumped / turned fast (all culling suspended for a few frames);
 * - culled columns are re-queried every frame (their proxy box is tested against the
 *   rest of the scene), visible ones every VISIBLE_REQUERY frames, staggered;
 * - culling = moving the mesh to a layer the camera doesn't render, so the chunk
 *   manager's own `visible` bookkeeping (crossfade) is untouched;
 * - no WebGL2 query support, switched off in the debug panel, or any GL error → everything drawn.
 * Tuning, the pure decision and result collection: occlusionPolicy.ts.
 */
import * as THREE from "three";
import { HIDDEN_LAYER, OCC, collectQuery, shouldDraw, type Entry } from "./occlusionPolicy";

export { OCC, shouldDraw, type OccState } from "./occlusionPolicy";

export class TerrainOcclusion {
  enabled: boolean;
  private readonly gl: WebGL2RenderingContext | null;
  private readonly entries = new Map<THREE.Mesh, Entry>();
  private readonly proxies = new THREE.Group();
  private readonly boxGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly boxMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
  private frame = 0;
  private unsafeUntil = 0;
  private readonly lastPos = new THREE.Vector3();
  private readonly lastDir = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private readonly tmpBox = new THREE.Box3();
  private hasLast = false;
  private failed = false;
  culledCount = 0;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, enabled: boolean) {
    const gl = renderer.getContext();
    this.gl = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext ? gl : null;
    this.enabled = enabled && !!this.gl;
    this.proxies.name = "occlusion proxies";
    scene.add(this.proxies);
  }

  /**
   * Before rendering: collect results, decide culling for every column mesh in
   * `group`, set up this frame's queries. `isStable(mesh)`: false while the mesh
   * is mid-crossfade (never culled).
   */
  update(group: THREE.Object3D, camera: THREE.Camera, isStable: (m: THREE.Mesh) => boolean) {
    this.frame++;
    const f = this.frame;
    const gl = this.gl;
    const on = this.enabled && !this.failed && !!gl;

    const pos = camera.getWorldPosition(this.pos);
    camera.getWorldDirection(this.dir);
    if (this.hasLast && (pos.distanceTo(this.lastPos) > OCC.JUMP_DIST || 1 - this.dir.dot(this.lastDir) > OCC.JUMP_TURN)) {
      this.unsafeUntil = f + OCC.JUMP_FRAMES;
    }
    this.lastPos.copy(pos);
    this.lastDir.copy(this.dir);
    this.hasLast = true;
    const suspended = f <= this.unsafeUntil;

    let culled = 0;
    for (const obj of group.children) {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) continue;
      let e = this.entries.get(mesh);
      if (e && e.geometry !== mesh.geometry) {
        // pooled mesh reused for another column: start over
        this.drop(e);
        e = undefined;
      }
      if (!e) {
        const proxy = new THREE.Mesh(this.boxGeo, this.boxMat);
        proxy.matrixAutoUpdate = false;
        proxy.renderOrder = 1e9; // after all opaque terrain (depth complete)
        proxy.visible = false;
        e = {
          mesh, geometry: mesh.geometry, proxy, query: null, pendingFrame: -1, issuing: false, culled: false, touched: f,
          lastSeen: f, resultFrame: -1, resultVisible: true,
        };
        const entry = e;
        proxy.onBeforeRender = () => this.begin(entry);
        proxy.onAfterRender = () => this.end(entry);
        this.entries.set(mesh, e);
        this.proxies.add(proxy);
      }
      e.touched = f;

      // 1. collect a finished query
      if (on && e.pendingFrame >= 0 && e.query) {
        if (!collectQuery(gl!, e, f)) this.failed = true;
      }
      e.issuing = false;

      // 2. decide
      const bb = mesh.geometry.boundingBox;
      let unsafe = suspended || !on || !mesh.visible || !bb || !isStable(mesh);
      if (!unsafe && bb) {
        this.tmpBox.copy(bb).expandByScalar(OCC.NEAR_PAD);
        if (this.tmpBox.containsPoint(pos)) unsafe = true;
      }
      const draw = shouldDraw(e, f, unsafe);
      e.culled = !draw;
      mesh.layers.set(draw ? 0 : HIDDEN_LAYER);
      if (!draw) culled++;

      // 3. query this frame? (only a drawable, testable column, one query in flight)
      let issue = on && !!bb && mesh.visible && e.pendingFrame < 0;
      if (issue && !e.culled) {
        // visible columns: staggered, every VISIBLE_REQUERY frames (never while unsafe:
        // the camera is inside / near the box, where the test says nothing)
        issue = !unsafe && (f + mesh.id) % OCC.VISIBLE_REQUERY === 0;
      }
      if (issue && bb) {
        this.tmpBox.copy(bb).expandByScalar(OCC.BOX_PAD);
        this.tmpBox.getCenter(e.proxy.position);
        this.tmpBox.getSize(e.proxy.scale);
        e.proxy.updateMatrix();
        e.proxy.matrixWorld.copy(e.proxy.matrix);
      }
      e.proxy.visible = issue;
    }
    // forget columns that left the scene
    for (const e of this.entries.values()) if (e.touched !== f) this.drop(e);
    this.culledCount = culled;
  }

  private begin(e: Entry) {
    const gl = this.gl;
    if (!gl || this.failed) return;
    try {
      if (!e.query) e.query = gl.createQuery();
      if (!e.query) return;
      gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE, e.query);
      e.issuing = true;
    } catch {
      this.failed = true;
    }
  }

  private end(e: Entry) {
    const gl = this.gl;
    if (!gl || !e.issuing) return;
    try {
      gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE);
      e.pendingFrame = this.frame;
    } catch {
      this.failed = true;
    }
    // stays `issuing` until the next update(): the result can't be available
    // before control returns to the browser anyway
  }

  private drop(e: Entry) {
    this.entries.delete(e.mesh);
    this.proxies.remove(e.proxy);
    e.mesh.layers.set(0);
    if (e.query && this.gl) this.gl.deleteQuery(e.query);
    e.query = null;
  }

  dispose() {
    for (const e of [...this.entries.values()]) this.drop(e);
    this.proxies.removeFromParent();
    this.boxGeo.dispose();
    this.boxMat.dispose();
  }
}
