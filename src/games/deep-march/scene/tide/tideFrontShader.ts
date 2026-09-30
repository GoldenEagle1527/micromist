/**
 * The tide's dissolve front on the seabed (design doc §5.5, plan M7): the LOD
 * crossfade's screen door (same 2 × 2-quad cells and threshold hash as
 * LOD_FADE_FRAGMENT, seabedShader.ts), keyed by the distance to the front
 * instead of time. Inside r − w everything is kept, across the band [r − w, r]
 * a growing share of the cells is discarded, beyond r all; the kept edge glows.
 * Only the tide program (DM_TIDE_FRONT) carries it — the resting terrain's
 * program is unchanged (no discard, early depth test kept).
 * uTideFront = (centre x, centre z, radius, band width).
 */
export const TIDE_FRONT_DECLS = /* glsl */ `
uniform vec4 uTideFront;
uniform vec3 uTideGlow;
`;

/** Prefix of MAP_FRAGMENT: discard before any shading (malioc: shortest path = the discard). */
export const TIDE_FRONT_FRAGMENT = /* glsl */ `
  float dmTideEdge = 0.0;
  {
    vec2 dmCell = floor(gl_FragCoord.xy * 0.5);
    float d = fract(52.9829189 * fract(dot(dmCell, vec2(0.06711056, 0.00583715))));
    float dmTideR = length(vWPos.xz - uTideFront.xy);
    if (dmTideR > uTideFront.z - uTideFront.w * d) discard;
    dmTideEdge = clamp(1.0 - (uTideFront.z - dmTideR) / max(uTideFront.w, 0.001), 0.0, 1.0);
  }
`;

/** Appended to EMISSIVE_FRAGMENT: the front's glowing edge. */
export const TIDE_FRONT_EMISSIVE = /* glsl */ `
  totalEmissiveRadiance += uTideGlow * (dmTideEdge * dmTideEdge);
`;
