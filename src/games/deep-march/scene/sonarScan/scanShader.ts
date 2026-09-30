/**
 * GLSL of the sonar observation view (scanView.ts), free of three / asset imports
 * so test:shaders compiles it and runs the Mali budget on it. One additive point
 * per recorded surface cell: brighter where it faces the diver and on the 4 m
 * height contours, fading with distance; the latest ping's wavefront runs over the
 * record as a bright band. No textures, no discard, no depth.
 */
export const SCAN_VERT = /* glsl */ `
uniform float uPointSize;
uniform vec3 uPx;
uniform vec4 uFront;
uniform vec4 uScan;
varying float vI;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float d = max(-mv.z, 0.05);
  gl_PointSize = clamp(uPointSize * uPx.x / d, uPx.y, uPx.z);
  float facing = abs(dot(normal, normalize(cameraPosition - position)));
  float h = fract(position.y / uScan.x);
  float line = 1.0 - smoothstep(0.0, uScan.w, min(h, 1.0 - h));
  float fade = 1.0 - smoothstep(uScan.y, uScan.z, d);
  float x = (uFront.w - distance(position, uFront.xyz)) * 0.16;
  float front = uFront.w > 0.0 ? exp(-x * x) : 0.0;
  vI = ((0.2 + 0.55 * facing) * (1.0 + 0.8 * line) + 0.9 * front) * fade;
  gl_Position = projectionMatrix * mv;
}
`;

export const SCAN_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vI;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = 1.0 - smoothstep(0.16, 0.5, length(c));
  gl_FragColor = vec4(uColor * (vI * a), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
