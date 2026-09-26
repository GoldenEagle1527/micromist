/**
 * Night-vision goggles as a render mode: the scene renders into an HDR target,
 * then a full-screen pass amplifies luminance into a green phosphor image with
 * grain, faint scanlines and a tube vignette, cross-faded with the normal image
 * by `strength` (0 = plain render, no extra pass). Scene-side visibility boosts
 * (ambient up, haze down) come from lampRig.ts.
 */
import * as THREE from "three";

export type NightVisionTuning = {
  /** Luminance amplification before the phosphor curve. */
  gain: number;
  grain: number;
  scanline: number;
};

export const NIGHT_VISION: NightVisionTuning = { gain: 5.5, grain: 0.05, scanline: 0.06 };

export class NightVision {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;

  private readonly renderer: THREE.WebGLRenderer;

  /** @param samples MSAA samples of the scene target (0 on low-spec devices). */
  constructor(renderer: THREE.WebGLRenderer, samples = 4) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples, depthBuffer: true });
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.target.texture },
        uStrength: { value: 0 },
        uTime: { value: 0 },
        uGain: { value: NIGHT_VISION.gain },
        uGrain: { value: NIGHT_VISION.grain },
        uScan: { value: NIGHT_VISION.scanline },
        uRes: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: /* glsl */ `varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
uniform sampler2D tScene; uniform float uStrength; uniform float uTime;
uniform float uGain; uniform float uGrain; uniform float uScan; uniform vec2 uRes;
varying vec2 vUv;
float nvHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 src = texture2D(tScene, vUv).rgb;
  float lum = dot(src, vec3(0.2126, 0.7152, 0.0722));
  // intensifier: strong gain with a soft shoulder, slight floor (tube glow)
  float amp = 1.0 - exp(-lum * uGain);
  amp = amp * 0.92 + 0.025;
  vec2 px = vUv * uRes;
  float grain = nvHash(floor(px * 0.75) + fract(uTime * 43.0) * 97.0) - 0.5;
  amp += grain * uGrain * (0.6 + amp);
  amp *= 1.0 - uScan * (0.5 + 0.5 * sin(px.y * 3.14159 * 0.5));
  // goggle tube vignette
  vec2 q = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float r = length(q);
  amp *= smoothstep(0.9, 0.38, r) * (1.0 - 0.15 * r);
  vec3 phosphor = vec3(0.32, 1.0, 0.42) * amp * 1.5;
  vec3 col = mix(src, phosphor, uStrength);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** Drawing-buffer size in physical pixels. */
  setSize(w: number, h: number) {
    this.target.setSize(Math.max(1, w), Math.max(1, h));
    this.material.uniforms.uRes.value.set(Math.max(1, w), Math.max(1, h));
  }

  render(scene: THREE.Scene, camera: THREE.Camera, strength: number, time: number) {
    if (strength < 0.005) {
      this.renderer.render(scene, camera);
      return;
    }
    const u = this.material.uniforms;
    u.uStrength.value = strength;
    u.uTime.value = time;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  dispose() {
    this.target.dispose();
    this.quad.geometry.dispose();
    this.material.dispose();
  }
}
