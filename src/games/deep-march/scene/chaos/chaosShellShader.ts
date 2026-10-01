/**
 * GLSL of the chaos beyond the wall (chaosShell.ts), free of three imports. An
 * emissive curtain: two octaves of drifting value noise, its colour cycling
 * through the shell's palette, brighter where the eye "watches" (uShellGlow.y),
 * dimmed by the blink and crossed by the pupil's dark bar; faded at the band's
 * bottom / top and the patch's sides, and through the turbidity with a pierce
 * (fog-limited, but it carries further than lit rock). Additive, depth-tested:
 * only what a through crack lets the eye see of it is drawn.
 */
export const SHELL_VERT = /* glsl */ `
attribute float aSide;         // −1 … 1 across the patch
varying vec3 vWPos;
varying float vSide;
void main() {
  vWPos = position;
  vSide = aSide;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;

export const SHELL_FRAG = /* glsl */ `
uniform float uTime;
uniform vec4 uShellGlow;       // x gain, y watch factor × blink, z fog pierce, w noise cell (m)
uniform vec4 uShellBand;       // x bottom, y top, z edge, w drift (m/s)
uniform vec3 uShellPupil;      // x position (−1 … 1), y strength, z half width
uniform vec3 uShellA;          // palette (linear RGB)
uniform vec3 uShellB;
uniform float uShellHue;       // 0 … 1 between A and B
uniform float uFogK;
varying vec3 vWPos;
varying float vSide;
float dmH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float dmN(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(dmH(i), dmH(i + vec2(1.0, 0.0)), f.x), mix(dmH(i + vec2(0.0, 1.0)), dmH(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 q = vec2(vSide * 8.0 + vWPos.x * 0.002, (vWPos.y + uTime * uShellBand.w) / uShellGlow.w);
  float n = 0.65 * dmN(q + vec2(0.0, uTime * 0.05)) + 0.35 * dmN(q * 2.3 - vec2(uTime * 0.11, 0.0));
  float k = smoothstep(uShellBand.x, uShellBand.x + uShellBand.z, vWPos.y) * (1.0 - smoothstep(uShellBand.y - uShellBand.z, uShellBand.y, vWPos.y));
  k *= 1.0 - smoothstep(0.7, 1.0, abs(vSide));
  float x = (vSide - uShellPupil.x) / uShellPupil.z;
  float pupil = 1.0 - uShellPupil.y * exp(-x * x);
  vec3 col = mix(uShellA, uShellB, uShellHue) * (0.35 + 1.1 * n * n);
  float dist = distance(vWPos, cameraPosition);
  float t = exp(-uFogK * uShellGlow.z * dist);
  gl_FragColor = vec4(col * (uShellGlow.x * uShellGlow.y * k * pupil * t), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
