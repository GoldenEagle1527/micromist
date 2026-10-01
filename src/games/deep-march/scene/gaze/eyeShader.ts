/**
 * GLSL of the eye beyond the main breach (eyeMesh.ts), free of three imports.
 * Drawn on a low curtain just past the breach's outer mouth, but what it shows
 * is a sphere kilometres away, traced per pixel: the view ray hits the sphere,
 * the hit's place on it relative to where the eye looks gives sclera, iris
 * (slowly flowing radial fibres) and the vertical slit pupil (an ellipse on the
 * iris, half width uEyeR.z). An aperture mask keeps it to what the breach's
 * opening lets through (the ray must cross the outer face inside the breach and
 * between the void's floor and roof) even where the wall's far terrain is not
 * streamed; depth-tested against what is. Additive; fog-limited with a pierce.
 * Vertices past the far plane are pinned just inside it.
 */
export const EYE_VERT = /* glsl */ `
varying vec3 vWPos;
void main() {
  vWPos = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  if (gl_Position.w > 0.0 && gl_Position.z > gl_Position.w) gl_Position.z = gl_Position.w * 0.999999;
}`;

export const EYE_FRAG = /* glsl */ `
uniform vec3 uEyeC;        // sphere centre (world m)
uniform vec4 uEyeR;        // x radius, y sin(iris angle), z slit half width, w slit height (iris shares)
uniform vec3 uEyeLook;     // unit: where the eye looks (from its centre)
uniform vec4 uMouth;       // xy outer-mouth centre (x, z), z half width, w edge (m)
uniform vec4 uMouthN;      // xy outward normal, zw tangent
uniform vec2 uBand;        // the void's floor / roof (m)
uniform vec4 uEyeGlow;     // x gain, y fog pierce, z time, w presence
uniform vec3 uIris;
uniform vec3 uInner;
uniform vec3 uRim;
uniform vec3 uSclera;
uniform float uFogK;
varying vec3 vWPos;
float eH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float eN(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(eH(i), eH(i + vec2(1.0, 0.0)), f.x), mix(eH(i + vec2(0.0, 1.0)), eH(i + vec2(1.0, 1.0)), f.x), f.y);
}
float aperture(vec3 ro, vec3 rd) {
  float side = dot(ro.xz - uMouth.xy, uMouthN.xy);
  if (side >= 0.0) return 1.0;
  float dn = dot(rd.xz, uMouthN.xy);
  if (dn <= 1e-4) return 0.0;
  vec3 h = ro + rd * (-side / dn);
  float u = abs(dot(h.xz - uMouth.xy, uMouthN.zw));
  float e = uMouth.w;
  return (1.0 - smoothstep(uMouth.z - e, uMouth.z, u)) * smoothstep(uBand.x, uBand.x + e, h.y) * (1.0 - smoothstep(uBand.y - e, uBand.y, h.y));
}
vec3 eyeColour(vec3 n) {
  float front = dot(n, uEyeLook);
  vec3 up = normalize(vec3(0.0, 1.0, 0.0) - uEyeLook * uEyeLook.y);
  vec3 right = cross(up, uEyeLook);
  vec2 q = vec2(dot(n, right), dot(n, up)) / uEyeR.y;
  float r = length(q);
  float t = uEyeGlow.z;
  vec3 sclera = uSclera * (0.55 + 0.9 * eN(q * 3.0 + vec2(0.0, t * 0.01)));
  if (front <= 0.0 || r > 1.25) return sclera;
  float a = atan(q.y, q.x);
  float fib = eN(vec2(a * 14.0, r * 4.0 - t * 0.04)) * 0.6 + eN(vec2(a * 31.0 + t * 0.02, r * 9.0)) * 0.4;
  vec3 iris = mix(uIris, uInner, smoothstep(0.75, 0.15, r)) * (0.45 + 1.0 * fib * fib);
  iris = mix(iris, uRim, smoothstep(0.82, 1.0, r));
  vec3 col = mix(iris, sclera, smoothstep(0.97, 1.08, r));
  vec2 s = q / vec2(uEyeR.z, uEyeR.w);
  float e = dot(s, s);
  float d = (e - 1.0) * 2.2;
  float ring = exp(-d * d) * 0.5;
  return col * (smoothstep(0.75, 1.05, e) + ring * (1.0 - smoothstep(1.0, 1.6, e)));
}
void main() {
  vec3 ro = cameraPosition, rd = normalize(vWPos - ro);
  float ap = aperture(ro, rd);
  if (ap <= 0.001) discard;
  vec3 oc = ro - uEyeC;
  float b = dot(oc, rd), c = dot(oc, oc) - uEyeR.x * uEyeR.x;
  float disc = b * b - c;
  vec3 col = uSclera * 0.25;
  if (disc > 0.0) col = eyeColour(normalize(oc + rd * (-b - sqrt(disc))));
  float fog = exp(-uFogK * uEyeGlow.y * distance(vWPos, ro));
  gl_FragColor = vec4(col * (uEyeGlow.x * uEyeGlow.w * ap * fog), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
