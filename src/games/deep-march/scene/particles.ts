/** Marine snow: points wrapped in a box around the camera (fog-tinted). */
import * as THREE from "three";

export class MarineSnow {
  readonly points: THREE.Points;
  private readonly base: Float32Array;
  private readonly pos: Float32Array;
  private readonly size = 24;
  private t = 0;

  constructor(count = 900, seed = 1) {
    let s = seed >>> 0 || 1;
    const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    this.base = new Float32Array(count * 3);
    for (let i = 0; i < this.base.length; i++) this.base[i] = rand() * this.size;
    this.pos = new Float32Array(count * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    const mat = new THREE.PointsMaterial({
      color: 0x9ec9e8,
      size: 0.05,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  update(center: THREE.Vector3, dt: number) {
    this.t += dt;
    const S = this.size;
    const h = S / 2;
    const drift = this.t * 0.15;
    for (let i = 0; i < this.base.length; i += 3) {
      const bx = this.base[i] + Math.sin(this.t * 0.3 + i) * 0.2;
      const by = this.base[i + 1] - drift;
      const bz = this.base[i + 2];
      this.pos[i] = center.x + ((((bx - center.x) % S) + S) % S) - h;
      this.pos[i + 1] = center.y + ((((by - center.y) % S) + S) % S) - h;
      this.pos[i + 2] = center.z + ((((bz - center.z) % S) + S) % S) - h;
    }
    (this.points.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
