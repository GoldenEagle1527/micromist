/** Shared GLSL chunks for glyph plaque materials (instanced + atlas emboss). */

export const glyphVertexPars = /* glsl */ `
attribute float aGlyph;
attribute float aTint;
uniform float uAtlasCols;
uniform float uAtlasRows;
varying vec2 vGlyphUv;
varying float vTint;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
varying vec3 vLocalNormal;
`;

export const glyphVertexMain = /* glsl */ `
  float cols = max(uAtlasCols, 1.0);
  float rows = max(uAtlasRows, 1.0);
  float gi = floor(mod(aGlyph + 0.001, cols * rows));
  float col = mod(gi, cols);
  float row = floor(gi / cols);
  vec2 cell = vec2(1.0 / cols, 1.0 / rows);
  vec2 base = vec2(col * cell.x, 1.0 - (row + 1.0) * cell.y);
  vGlyphUv = base + uv * cell;
  vTint = aTint;
  vec4 worldPos = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  vWorldPos = worldPos.xyz;
  mat3 normalMat = mat3(modelMatrix * instanceMatrix);
  vWorldNormal = normalize(normalMat * normal);
  vLocalNormal = normalize(normal);
`;

export const glyphFragmentPars = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec2 uAtlasSize;
uniform float uLayerSign;
uniform float uTime;
uniform vec3 uAccent;
varying vec2 vGlyphUv;
varying float vTint;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
varying vec3 vLocalNormal;

float glyphLuma(vec2 uv) {
  vec3 rgb = texture2D(uAtlas, uv).rgb;
  return dot(rgb, vec3(0.299, 0.587, 0.114));
}

// Darker strokes = higher relief (height from atlas luma)
float glyphHeight(vec2 uv) {
  return clamp(1.0 - glyphLuma(uv), 0.0, 1.0);
}
`;

export const glyphFragmentColor = /* glsl */ `
  // Corridor-facing plaque face only
  float faceMask = smoothstep(0.35, 0.85, abs(vLocalNormal.y) * step(0.0, vLocalNormal.y * uLayerSign));

  vec4 atlas = texture2D(uAtlas, vGlyphUv);
  float h = glyphHeight(vGlyphUv);

  vec2 texel = 1.55 / max(uAtlasSize, vec2(1.0));
  float hx = glyphHeight(vGlyphUv + vec2(texel.x, 0.0)) - glyphHeight(vGlyphUv - vec2(texel.x, 0.0));
  float hy = glyphHeight(vGlyphUv + vec2(0.0, texel.y)) - glyphHeight(vGlyphUv - vec2(0.0, texel.y));
  // Strong slope lighting from upper-left key (sells 凸起)
  float slopeLit = clamp(0.5 - hx * 5.2 + hy * 5.2, 0.0, 1.0);
  float ridge = smoothstep(0.08, 0.5, h);

  vec3 plaster = mix(vec3(0.94, 0.93, 0.90), vec3(0.86, 0.85, 0.82), vTint * 0.4);
  float sideAmt = 1.0 - abs(vLocalNormal.y);
  // Thin plaque edges read as carved sides
  vec3 sideCol = mix(plaster, plaster * vec3(0.62, 0.63, 0.64), sideAmt);
  vec3 body = mix(sideCol, plaster, faceMask);

  // Raised glyph: bright NW ridges + deep SE valleys — matte, no emissive
  vec3 raisedLit = mix(vec3(0.48, 0.49, 0.51), vec3(0.97, 0.96, 0.92), slopeLit);
  vec3 raisedDark = vec3(0.14, 0.15, 0.17);
  vec3 relief = mix(raisedDark, raisedLit, slopeLit);
  relief = mix(relief, atlas.rgb, 0.18);
  relief += vec3(0.16) * ridge * slopeLit * faceMask;
  // Soft ambient occlusion in stroke valleys
  relief *= mix(0.72, 1.0, smoothstep(0.0, 0.55, slopeLit));

  float inkMask = faceMask * smoothstep(0.03, 0.22, h);
  vec3 color = mix(body, relief, inkMask);

  diffuseColor.rgb = color;
`;

export const glyphFragmentNormal = /* glsl */ `
  float faceMaskN = smoothstep(0.35, 0.85, abs(vLocalNormal.y) * step(0.0, vLocalNormal.y * uLayerSign));
  float hN = glyphHeight(vGlyphUv);
  vec2 texelN = vec2(1.85) / max(uAtlasSize, vec2(1.0));
  float hxN = glyphHeight(vGlyphUv + vec2(texelN.x, 0.0)) - glyphHeight(vGlyphUv - vec2(texelN.x, 0.0));
  float hyN = glyphHeight(vGlyphUv + vec2(0.0, texelN.y)) - glyphHeight(vGlyphUv - vec2(0.0, texelN.y));
  // High bump from height gradients so MeshStandard catches stroke edges
  vec3 embossN = normalize(vec3(-hxN * 9.5, -hyN * 9.5, 1.0));
  float embAmt = faceMaskN * smoothstep(0.015, 0.4, hN);
  normal = normalize(mix(normal, normalize(normal + embossN * embAmt * 1.75), embAmt));
`;
