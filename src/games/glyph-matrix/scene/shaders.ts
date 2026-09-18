/** Shared GLSL chunks for glyph cube materials (instanced + atlas emboss). */

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

// Darker strokes = higher relief
float glyphHeight(vec2 uv) {
  return clamp(1.0 - glyphLuma(uv), 0.0, 1.0);
}
`;

export const glyphFragmentColor = /* glsl */ `
  float faceMask = smoothstep(0.55, 0.92, abs(vLocalNormal.y) * step(0.0, vLocalNormal.y * uLayerSign));

  vec4 atlas = texture2D(uAtlas, vGlyphUv);
  float h = glyphHeight(vGlyphUv);

  vec2 texel = 1.35 / max(uAtlasSize, vec2(1.0));
  float hx = glyphHeight(vGlyphUv + vec2(texel.x, 0.0)) - glyphHeight(vGlyphUv - vec2(texel.x, 0.0));
  float hy = glyphHeight(vGlyphUv + vec2(0.0, texel.y)) - glyphHeight(vGlyphUv - vec2(0.0, texel.y));
  // Fake slope lighting from upper-left key light
  float slopeLit = clamp(0.5 - hx * 3.4 + hy * 3.4, 0.0, 1.0);
  float ridge = smoothstep(0.12, 0.55, h);

  vec3 plaster = mix(vec3(0.93, 0.92, 0.89), vec3(0.84, 0.83, 0.80), vTint * 0.45);
  float sideAmt = 1.0 - abs(vLocalNormal.y);
  vec3 sideCol = mix(plaster, plaster * vec3(0.70, 0.71, 0.72), sideAmt * 0.9);
  vec3 body = mix(sideCol, plaster, faceMask);

  // Raised glyph: lit ridge + shaded valleys, not flat ink
  vec3 raisedLit = mix(vec3(0.55, 0.56, 0.58), vec3(0.95, 0.94, 0.90), slopeLit);
  vec3 raisedDark = vec3(0.18, 0.19, 0.21);
  vec3 relief = mix(raisedDark, raisedLit, slopeLit);
  relief = mix(relief, atlas.rgb, 0.25);
  // Top rim catch on high ridges
  relief += vec3(0.12) * ridge * slopeLit * faceMask;

  float inkMask = faceMask * smoothstep(0.04, 0.28, h);
  vec3 color = mix(body, relief, inkMask);

  diffuseColor.rgb = color;
`;

export const glyphFragmentNormal = /* glsl */ `
  float faceMaskN = smoothstep(0.55, 0.92, abs(vLocalNormal.y) * step(0.0, vLocalNormal.y * uLayerSign));
  float hN = glyphHeight(vGlyphUv);
  vec2 texelN = vec2(1.6) / max(uAtlasSize, vec2(1.0));
  float hxN = glyphHeight(vGlyphUv + vec2(texelN.x, 0.0)) - glyphHeight(vGlyphUv - vec2(texelN.x, 0.0));
  float hyN = glyphHeight(vGlyphUv + vec2(0.0, texelN.y)) - glyphHeight(vGlyphUv - vec2(0.0, texelN.y));
  // Stronger tangent-space bump so MeshStandard lighting catches stroke edges
  vec3 embossN = normalize(vec3(-hxN * 6.5, -hyN * 6.5, 1.0));
  float embAmt = faceMaskN * smoothstep(0.02, 0.45, hN);
  normal = normalize(mix(normal, normalize(normal + embossN * embAmt * 1.35), embAmt));
`;
