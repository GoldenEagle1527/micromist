/**
 * GLSL of the omen silhouette (omenMesh.ts), free of three imports so test:shaders
 * compiles it and runs the Mali budget. Only the long sonar pulses (sonarLong.ts)
 * draw it — the same front / trail as the far wall ring (wallRingShader.ts) —
 * additive and not depth-tested (a sonar return through the rock), scaled by uOmen = presence ×
 * sonar strength (0: the mesh is not drawn at all). Limbs sway slowly in the
 * vertex shader; vertices past the far plane are pinned just inside it. Instanced
 * (USE_INSTANCING, scene/gaze/berserk.ts): one draw for a whole swarm of them.
 */
export const OMEN_VERT = /* glsl */ `
attribute float aSway;
attribute float aPhase;
uniform float uTime;
uniform vec2 uOmenSway;     // x amplitude (m), y frequency (Hz)
varying vec3 vWPos;
varying vec3 vWNrm;
void main() {
  float w = 6.2831853 * uOmenSway.y * uTime + aPhase;
  vec3 p = position + aSway * uOmenSway.x * vec3(sin(w + position.z * 0.12), 0.6 * cos(w * 0.8 + position.z * 0.1), 0.0);
  vec4 lp = vec4(p, 1.0);
  vec3 ln = normal;
  #ifdef USE_INSTANCING
  lp = instanceMatrix * lp;
  ln = mat3(instanceMatrix) * ln;
  #endif
  vec4 wp = modelMatrix * lp;
  vWPos = wp.xyz;
  vWNrm = mat3(modelMatrix) * ln;
  gl_Position = projectionMatrix * viewMatrix * wp;
  if (gl_Position.w > 0.0 && gl_Position.z > gl_Position.w) gl_Position.z = gl_Position.w * 0.999999;
}
`;

export const OMEN_FRAG = /* glsl */ `
#ifndef DM_P
#define DM_P highp
#endif
#ifndef DM_LONG_N
#define DM_LONG_N 3
#endif
uniform float uOmen;
uniform vec3 uSonarColor;
uniform DM_P vec4 uLongPulse[DM_LONG_N];
uniform DM_P float uLongAmp[DM_LONG_N];
uniform vec4 uLongWave;     // x speed, y trail, z front width, w range
uniform vec3 uOmenLook;     // x trail gain, y front gain, z rim share
varying vec3 vWPos;
varying vec3 vWNrm;
void main() {
  vec3 dir = normalize(vWPos - cameraPosition);
  float facing = abs(dot(normalize(vWNrm), dir));
  float rim = 1.0 - facing;
  float shade = mix(1.0, rim * rim, uOmenLook.z);
  float trail = 0.0, front = 0.0;
  for (int i = 0; i < DM_LONG_N; i++) {
    vec4 p = uLongPulse[i];
    float behind = p.w - distance(vWPos, p.xyz);
    float x = behind / uLongWave.z;
    front = max(front, exp(-x * x) * uLongAmp[i]);
    trail = max(trail, behind >= 0.0 ? exp(-behind / (uLongWave.x * uLongWave.y)) * uLongAmp[i] : 0.0);
  }
  vec3 col = uSonarColor * shade * (trail * uOmenLook.x + front * uOmenLook.y) * uOmen;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
