/**
 * GLSL of the far proxy ring (wallRing.ts), kept free of three / asset imports so
 * test:shaders compiles it and runs the Mali budget on it.
 *
 * Only drawn while a long sonar pulse is alive, added on top of the background:
 * beyond the terrain's view distance it shows the long
 * pulses' echo (sonarLong.ts) — the same look as the terrain's sonar (contours with
 * screen-space AA and a minimum pixel width, blended to their mean coverage when
 * denser than a few pixels; facing / rim from the flat facet normal; bright front,
 * fading trail) — fading in from `uRing.x` to `uRing.y` (beyond the columns' reach,
 * so it never overlaps a terrain column) and out at the band's bottom / top.
 * Depth: vertices past the far plane are pinned just inside it, so the ring sits
 * behind every terrain pixel and is never clipped (from inside, a view ray meets
 * the convex ring once: no self-overlap to sort). No texture fetches: at this range
 * a normal map would be sub-pixel.
 */
import { WATER_GLSL } from "./seabedShader";
import { FOG_GLSL } from "./fog";

export const RING_VERT = /* glsl */ `
varying vec3 vWPos;
void main() {
  vWPos = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  if (gl_Position.w > 0.0 && gl_Position.z > gl_Position.w) gl_Position.z = gl_Position.w * 0.999999;
}
`;

export const RING_FRAG = /* glsl */ `
#ifndef DM_P
#define DM_P highp
#endif
#ifndef DM_LONG_N
#define DM_LONG_N 3
#endif
${WATER_GLSL}${FOG_GLSL}
uniform float uSonar;
uniform vec3 uSonarColor;
uniform DM_P vec4 uLongPulse[DM_LONG_N];
uniform DM_P float uLongAmp[DM_LONG_N];
uniform vec4 uLongWave;     // x speed, y trail, z front width, w range
uniform vec3 uRingLine;     // x contour spacing, y world line width, z min px
uniform vec4 uRing;         // x fade-in start, y fade-in end (distance), z band bottom, w band top
uniform vec2 uRingEdge;     // bottom / top fade heights
varying vec3 vWPos;
void main() {
  // derivatives first (uniform control flow), then the near cut
  vec3 dpx = dFdx(vWPos), dpy = dFdy(vWPos);
  float hs = vWPos.y / uRingLine.x;
  float fw = max(fwidth(hs), 1e-5);
  vec3 dv = vWPos - cameraPosition;
  float dist = length(dv);
  if (dist < uRing.x) discard;
  vec3 dir = dv / max(dist, 1e-4);
  vec3 n = normalize(cross(dpx, dpy));
  float facing = abs(dot(n, dir));
  float rim = pow(1.0 - facing, 3.0);
  float dl = abs(fract(hs + 0.5) - 0.5);
  float hw = max(0.5 * uRingLine.y / uRingLine.x, 0.5 * uRingLine.z * fw);
  float line = 1.0 - smoothstep(hw - 0.5 * fw, hw + 0.5 * fw, dl);
  line = mix(line, min(1.0, 2.0 * hw), smoothstep(0.12, 0.3, fw));
  float trail = 0.0, front = 0.0;
  for (int i = 0; i < DM_LONG_N; i++) {
    vec4 p = uLongPulse[i];
    float r = distance(vWPos, p.xyz);
    float behind = p.w - r;
    float rf = uLongAmp[i] * (1.0 - smoothstep(0.85 * uLongWave.w, uLongWave.w, r));
    float x = behind / uLongWave.z;
    front = max(front, exp(-x * x) * rf);
    trail = max(trail, behind >= 0.0 ? exp(-behind / (uLongWave.x * uLongWave.y)) * rf : 0.0);
  }
  float echo = 0.25 + 0.75 * facing;
  vec3 sonarCol = uSonarColor * (trail * (0.07 * echo + 0.75 * line + 0.45 * rim) + front * (0.3 + 0.7 * echo));
  float k = smoothstep(uRing.x, uRing.y, dist)
          * smoothstep(uRing.z, uRing.z + uRingEdge.x, vWPos.y)
          * (1.0 - smoothstep(uRing.w - uRingEdge.y, uRing.w, vWPos.y));
  gl_FragColor = vec4(sonarCol * (uSonar * k), 1.0); // additive over the background dome
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
