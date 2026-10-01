/**
 * Draws phantom contacts (phantomContacts.ts) as sonar returns: one additive
 * THREE.Points draw (≤ 24 soft round sprites, world-sized, no texture), each lit
 * on the CPU by the near sonar pulses exactly as the seabed shader lights rock —
 * a bright band as the front passes, then the afterglow (sonar.ts mirrors) — so a
 * return only appears when a ping (or a ghost echo) reaches it. A return, not a
 * sight: no depth test, rock does not hide it (like the omen). Nothing is drawn
 * while no contact glows.
 */
import * as THREE from "three";
import { sonarFront, sonarRangeFade, sonarTrail, type SonarPulses } from "../sonar";
import { CHAOS_LOOK } from "./config";
import type { PhantomContact } from "./phantomContacts";

const MAX_BLIPS = 24;

const VERT = /* glsl */ `
attribute float aSize;
attribute float aGlow;
uniform float uScale;
uniform float uMaxPx;
varying float vGlow;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vGlow = aGlow;
  gl_PointSize = aGlow > 0.004 ? clamp(aSize * uScale / max(1.0, -mv.z), 2.0, uMaxPx) : 0.0;
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vGlow;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(q, q);
  if (d2 >= 1.0) discard;
  float a = 1.0 - d2;
  gl_FragColor = vec4(uColor * (vGlow * a * a), 1.0);
}`;

export class PhantomMesh {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(MAX_BLIPS * 3);
  private readonly size = new Float32Array(MAX_BLIPS);
  private readonly glow = new Float32Array(MAX_BLIPS);
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.ShaderMaterial;
  private readonly buf = new THREE.Vector2();

  constructor(color: THREE.Color) {
    const P = CHAOS_LOOK.late.phantom;
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aGlow", new THREE.BufferAttribute(this.glow, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: color }, uScale: { value: 500 }, uMaxPx: { value: P.maxPx } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 12;
    this.points.visible = false;
    this.points.name = "deep-march-phantom-returns";
    // world-sized sprites: pixels per metre at 1 m from the camera
    this.points.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getDrawingBufferSize(this.buf);
      const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 70;
      this.mat.uniforms.uScale.value = this.buf.y / (2 * Math.tan((fov * Math.PI) / 360));
    };
  }

  /** Per frame, after the pulses' update: light every blip by the pulses alive now. */
  update(contacts: readonly PhantomContact[], pulses: SonarPulses): void {
    const P = CHAOS_LOOK.late.phantom;
    let n = 0, lit = false;
    for (const c of contacts) {
      for (const b of c.blips) {
        if (n >= MAX_BLIPS) break;
        const g = c.fade * returnAt(pulses, b.x, b.y, b.z, P.front, P.trail);
        this.pos[n * 3] = b.x;
        this.pos[n * 3 + 1] = b.y;
        this.pos[n * 3 + 2] = b.z;
        this.size[n] = b.size;
        this.glow[n] = g;
        lit ||= g > 0.004;
        n++;
      }
    }
    this.geo.setDrawRange(0, n);
    this.points.visible = lit;
    if (!lit) return;
    for (const k of ["position", "aSize", "aGlow"]) (this.geo.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** The sonar light at a point: the brightest pulse's front band and afterglow, range-faded. */
function returnAt(pulses: SonarPulses, x: number, y: number, z: number, front: number, trail: number): number {
  let v = 0;
  for (let i = 0; i < pulses.max; i++) {
    const p = pulses.pulse[i];
    if (p.w < 0 || pulses.amp[i] <= 0) continue;
    const r = Math.hypot(x - p.x, y - p.y, z - p.z);
    if (r > pulses.tuning.range) continue;
    const k = pulses.amp[i] * sonarRangeFade(r);
    v = Math.max(v, k * (front * sonarFront(p.w, r) + trail * sonarTrail(p.w, r)));
  }
  return Math.min(1.5, v);
}
