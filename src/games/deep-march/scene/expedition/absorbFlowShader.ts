/**
 * GLSL of the absorb inflow (absorbFlow.ts), free of three imports. Each point
 * runs its own loop from the node to the tank in front of the diver's chest:
 * u = fract(t · rate + phase), eased along the axis, spiralling around it (the
 * spiral's radius swells mid-way and closes at both ends), fading in at the node
 * and out before it reaches the camera. Additive, no textures, no fog (≤ 4.5 m).
 */
export const FLOW_VERT = /* glsl */ `
attribute vec3 aSeed;          // x phase, y spiral angle, z spiral radius (m)
uniform float uTime;
uniform vec3 uFrom;
uniform vec3 uTo;
uniform float uFlow;           // 0 … 1: fades the whole stream
uniform float uPR;             // pixel ratio
varying float vA;
void main() {
  float u = fract(uTime * 0.85 + aSeed.x);
  float e = u * u * (3.0 - 2.0 * u);
  vec3 axis = uTo - uFrom;
  vec3 side = normalize(cross(axis, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
  vec3 up = normalize(cross(side, axis));
  float a = aSeed.y + u * 7.0;
  float r = aSeed.z * sin(3.14159 * u);
  vec3 p = uFrom + axis * e + (side * cos(a) + up * sin(a)) * r;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vA = uFlow * smoothstep(0.0, 0.12, u) * (1.0 - smoothstep(0.7, 0.95, u));
  gl_PointSize = clamp(7.0 * uPR / max(-mv.z, 0.2), 1.5, 9.0);
  gl_Position = projectionMatrix * mv;
}`;

export const FLOW_FRAG = /* glsl */ `
uniform vec3 uTint;
varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 6.0);
  gl_FragColor = vec4((uTint * (core + 0.35 * exp(-r2 * 2.0)) + vec3(0.5, 0.8, 1.0) * core * 0.3) * vA, 1.0);
}`;
