/**
 * GLSL of the placement hologram (hologram.ts), free of three imports so
 * test:shaders can compile it: the building's own mesh drawn additive in
 * green (placeable) or red, bright at grazing angles, with scan bands rising.
 */
export const HOLO_VERT = /* glsl */ `
varying vec3 vWPos;
varying vec3 vN;
varying float vY;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWPos = w.xyz;
  vN = mat3(modelMatrix) * normal;
  vY = position.y;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const HOLO_FRAG = /* glsl */ `
uniform vec3 uHoloColor;
uniform vec2 uHoloParams;
varying vec3 vWPos;
varying vec3 vN;
varying float vY;
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(cameraPosition - vWPos)));
  float scan = 0.55 + 0.45 * step(0.5, fract(vY * 0.8 - uHoloParams.y * 0.9));
  gl_FragColor = vec4(uHoloColor * (uHoloParams.x * (0.25 + 0.75 * f * f) * scan), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
