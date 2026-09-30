/**
 * The base dome (design doc §5.5 key point 4, §5.6): an additive fresnel shell,
 * brighter where the diver comes near its edge (uDiver.w = the edge warning).
 * No textures; a handful of ALU per pixel (Mali budget in test:shaders).
 */
export const DOME_VERT = /* glsl */ `
varying vec3 vW;
varying vec3 vN;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const DOME_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uGlow;
uniform float uTime;
uniform vec4 uDiver;
varying vec3 vW;
varying vec3 vN;
void main() {
  vec3 v = normalize(cameraPosition - vW);
  float f = 1.0 - abs(dot(normalize(vN), v));
  f = f * f * f;
  float band = 0.6 + 0.4 * sin(vW.y * 0.45 - uTime * 1.6);
  float near = uDiver.w * exp(-distance(vW, uDiver.xyz) * 0.2);
  float k = uGlow * (0.12 + f * band) + near;
  gl_FragColor = vec4(uColor * k, 1.0);
}`;
