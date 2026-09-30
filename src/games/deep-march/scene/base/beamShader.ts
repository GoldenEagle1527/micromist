/**
 * GLSL of the lighthouse beams (beamColumn.ts), free of three imports so
 * test:shaders can compile it. Additive, no textures: a vertical light column
 * from the lantern toward the surface (fades with height, a slow shimmer
 * running up it) and two sweeping horizontal cones. Softened at grazing
 * angles (|N·V|²) and near the eye; attenuated by distance much more gently
 * than the terrain (uBeamFog: e-fold metres, §6.2: seen ~400 m through the
 * murk) and faded out before the far plane.
 */
export const BEAM_COLUMN_VERT = /* glsl */ `
attribute vec2 aBeam;
varying vec3 vWPos;
varying vec3 vN;
varying vec2 vBeam;
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWPos = w.xyz;
  vN = mat3(modelMatrix) * mat3(instanceMatrix) * normal;
  vBeam = aBeam;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const BEAM_COLUMN_FRAG = /* glsl */ `
uniform vec3 uBeamTint;
uniform vec4 uBeamParams;
uniform float uTime;
varying vec3 vWPos;
varying vec3 vN;
varying vec2 vBeam;
void main() {
  vec3 dv = cameraPosition - vWPos;
  float dist = length(dv);
  float edge = abs(dot(normalize(vN), dv / max(dist, 1e-4)));
  edge *= edge;
  float t = vBeam.x;
  float along = vBeam.y < 0.5
    ? (1.0 - t) * (1.0 - t) * (0.8 + 0.2 * sin(t * 48.0 - uTime * 1.3))
    : (1.0 - t) * 0.55;
  float fade = exp(-dist / uBeamParams.y) * (1.0 - smoothstep(uBeamParams.z * 0.82, uBeamParams.z, dist)) * smoothstep(2.0, 14.0, dist);
  gl_FragColor = vec4(uBeamTint * (uBeamParams.x * edge * along * fade), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
