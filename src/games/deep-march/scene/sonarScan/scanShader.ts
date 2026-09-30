/**
 * GLSL of the sonar observation view (scanView.ts), free of three / asset imports
 * so test:shaders compiles it and runs the Mali budget on it. The recorded surfaces
 * are shaded the way the old continuous SONAR light mode shaded the live seabed
 * (sonar.ts SONAR_OPAQUE, before the active ping): world-height contour lines
 * anti-aliased in screen space with a minimum pixel width (blended to their mean
 * where they crowd), a rim from the normals and a faint facing echo, held at a
 * steady level instead of a decaying trail; the latest ping's front runs over the
 * record as the bright band. Opaque on black, no textures.
 */
export const SCAN_VERT = /* glsl */ `
varying vec3 vWPos;
varying vec3 vNormal;
void main() {
  vWPos = position;
  vNormal = normal;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

export const SCAN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uLine;
uniform vec4 uFront;
uniform vec4 uLook;
varying vec3 vWPos;
varying vec3 vNormal;
void main() {
  // height contours, AA'd in screen space with a minimum pixel width (as SONAR_OPAQUE)
  float hs = vWPos.y / uLine.x;
  float fw = max(fwidth(hs), 1e-5);
  float dl = abs(fract(hs + 0.5) - 0.5);
  float hw = max(0.5 * uLine.y / uLine.x, 0.5 * uLine.z * fw);
  float line = 1.0 - smoothstep(hw - 0.5 * fw, hw + 0.5 * fw, dl);
  line = mix(line, min(1.0, 2.0 * hw), smoothstep(0.12, 0.3, fw));
  vec3 toCam = cameraPosition - vWPos;
  float dist = length(toCam);
  float facing = abs(dot(normalize(vNormal), toCam / max(dist, 1e-3)));
  float rim = pow(1.0 - facing, 3.0);
  float echo = 0.25 + 0.75 * facing;
  float x = (uFront.w - distance(vWPos, uFront.xyz)) / uLook.w;
  float front = uFront.w > 0.0 ? exp(-x * x) : 0.0;
  vec3 col = uColor * (uLook.z * (0.07 * echo + 0.75 * line + 0.45 * rim) + front * (0.3 + 0.7 * echo));
  col *= 1.0 - smoothstep(uLook.x, uLook.y, dist);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
