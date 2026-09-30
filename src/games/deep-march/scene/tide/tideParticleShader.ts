/**
 * The tide's particle currents (design doc §5.5 P2–P4, plan M7: "simple
 * vortex, no p0 → p1 pairing"): every particle's path is analytic in the
 * vertex shader — the CPU only sets uniforms. A particle is born where the
 * P2 front passes its home radius (the old terrain breaking up), circles the
 * dome in a vortex with a curl-like wobble, and lands where the P4 front
 * passes (the new terrain condensing), fading out. The burst particles
 * (aSeed.w < 0) stream out of the diver when the tide takes them (§5.6).
 * uGeom = (dome radius, reach, height span, currents on 1 / off 0 — the murk);
 * uTimes = (P2 start, P2 length, P4 start, P4 length); uView = (size m, px per m, fade 1/m).
 * Additive points; far ones fade into the water.
 */
export const PARTICLE_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uT;
uniform vec3 uCenter;
uniform vec4 uGeom;
uniform vec4 uTimes;
uniform vec4 uBurst;
uniform vec3 uView;
varying float vA;
void main() {
  float domeR = uGeom.x, reach = uGeom.y;
  float span = max(reach - domeR, 1.0);
  vec3 p;
  float a;
  if (aSeed.w >= 0.0) {
    float r0 = mix(domeR, reach, aSeed.y);
    float born = uTimes.x + uTimes.y * (reach - r0) / span;
    float land = uTimes.z + uTimes.w * (r0 - domeR) / span;
    float age = max(uT - born, 0.0);
    float spin = 0.9 * domeR / r0 + 0.05;
    float ang = aSeed.x + spin * age;
    float rr = mix(r0, r0 * 0.65 + domeR * 0.35, smoothstep(0.0, 7.0, age));
    rr += 5.0 * sin(ang * 3.0 + uT * 0.8 + aSeed.w * 12.0);
    float y = uCenter.y + (aSeed.z - 0.3) * uGeom.z + 7.0 * sin(age * 0.6 + aSeed.w * 6.2831);
    p = vec3(uCenter.x + cos(ang) * rr, y, uCenter.z + sin(ang) * rr);
    vec3 home = vec3(uCenter.x + cos(aSeed.x + 2.1) * r0, uCenter.y + (aSeed.z - 0.5) * uGeom.z * 0.3, uCenter.z + sin(aSeed.x + 2.1) * r0);
    p = mix(p, home, smoothstep(land - 2.0, land + 0.5, uT));
    a = uGeom.w * step(born, uT) * smoothstep(0.0, 0.8, age) * (1.0 - smoothstep(land - 0.5, land + 0.8, uT));
  } else {
    float bt = uT - uBurst.w;
    vec3 dir = normalize(aSeed.xyz - 0.5 + vec3(0.0, 0.001, 0.0));
    float out1 = 1.5 + bt * (2.5 + 3.0 * aSeed.y);
    float ang = bt * (0.6 + aSeed.x);
    vec3 off = dir * out1;
    p = uBurst.xyz + vec3(off.x * cos(ang) - off.z * sin(ang), off.y + bt * 0.8, off.x * sin(ang) + off.z * cos(ang));
    a = step(0.0, bt) * (1.0 - smoothstep(2.0, 5.0, bt));
  }
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  a *= step(0.2, d) * exp(-d * uView.z);
  vA = a;
  gl_PointSize = clamp(uView.x * uView.y / max(d, 0.2), 1.0, 22.0);
  gl_Position = a > 0.002 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
}`;

export const PARTICLE_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float k = 1.0 - smoothstep(0.03, 0.25, dot(c, c));
  gl_FragColor = vec4(uColor * (k * vA), 1.0);
}`;
