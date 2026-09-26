/**
 * Glowing plankton: soft, deep-blue fluorescent specks wrapped in a box around the
 * camera. Additive, self-lit (not fogged), each with its own pulse phase and size;
 * they fade toward the box edge so wrapping never pops.
 */
import * as THREE from "three";

export class MarineSnow {
  readonly points: THREE.Points;
  private readonly base: Float32Array;
  private readonly pos: Float32Array;
  private readonly size = 24;
  private readonly material: THREE.ShaderMaterial;
  private t = 0;

  constructor(count = 900, seed = 1) {
    let s = seed >>> 0 || 1;
    const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    this.base = new Float32Array(count * 3);
    for (let i = 0; i < this.base.length; i++) this.base[i] = rand() * this.size;
    this.pos = new Float32Array(count * 3);
    const attr = new Float32Array(count * 3); // phase, size, hue
    for (let i = 0; i < count; i++) {
      attr[i * 3] = rand() * Math.PI * 2;
      const r = rand();
      attr[i * 3 + 1] = 0.6 + r * r * 1.8; // mostly small, a few large
      attr[i * 3 + 2] = rand();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(attr, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uHalf: { value: this.size / 2 },
        uPixelRatio: { value: 1 },
      },
      vertexShader: /* glsl */ `
uniform float uTime; uniform float uHalf; uniform float uPixelRatio;
attribute vec3 aSeed;
varying float vAlpha; varying float vHue;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = -mv.z;
  float pulse = 0.55 + 0.45 * sin(uTime * (0.8 + aSeed.z * 1.2) + aSeed.x);
  float edge = 1.0 - smoothstep(uHalf * 0.6, uHalf * 0.98, length(mv.xyz));
  vAlpha = pulse * edge * smoothstep(0.15, 0.6, dist);
  vHue = aSeed.z;
  gl_PointSize = clamp(aSeed.y * 18.0 * uPixelRatio / max(dist, 0.1), 1.5, 26.0);
  gl_Position = projectionMatrix * mv;
}`,
      fragmentShader: /* glsl */ `
varying float vAlpha; varying float vHue;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float core = exp(-r * r * 9.0);
  float halo = exp(-r * r * 2.5) * 0.45;
  vec3 deep = vec3(0.05, 0.35, 1.0);   // deep blue
  vec3 cyan = vec3(0.25, 0.9, 1.0);    // fluorescent cyan
  vec3 col = mix(deep, cyan, vHue * vHue);
  vec3 c = col * (core + halo) + vec3(0.6, 0.9, 1.0) * core * 0.35;
  gl_FragColor = vec4(c * vAlpha * 1.4, 1.0);
}`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  update(center: THREE.Vector3, dt: number) {
    this.t += dt;
    this.material.uniforms.uTime.value = this.t;
    this.material.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, 2);
    const S = this.size;
    const h = S / 2;
    const drift = this.t * 0.15;
    for (let i = 0; i < this.base.length; i += 3) {
      const bx = this.base[i] + Math.sin(this.t * 0.3 + i) * 0.2;
      const by = this.base[i + 1] - drift;
      const bz = this.base[i + 2] + Math.cos(this.t * 0.25 + i) * 0.2;
      this.pos[i] = center.x + ((((bx - center.x) % S) + S) % S) - h;
      this.pos[i + 1] = center.y + ((((by - center.y) % S) + S) % S) - h;
      this.pos[i + 2] = center.z + ((((bz - center.z) % S) + S) % S) - h;
    }
    (this.points.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
