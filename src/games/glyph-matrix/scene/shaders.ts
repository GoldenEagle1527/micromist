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
  // Canvas row0 = top; flip V like atlas builder
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

float glyphHeight(vec2 uv) {
  return clamp(1.0 - glyphLuma(uv), 0.0, 1.0);
}
`;

/** Albedo only — real MeshStandardMaterial lights shade the cubes. */
export const glyphFragmentColor = /* glsl */ `
  // Inner corridor face: floor uses +Y local, ceiling uses -Y local
  float faceMask = smoothstep(0.55, 0.92, abs(vLocalNormal.y) * step(0.0, vLocalNormal.y * uLayerSign));

  vec4 atlas = texture2D(uAtlas, vGlyphUv);
  float h = glyphHeight(vGlyphUv);

  // Matte plaster / plastic body — light gray, slight tint variation
  vec3 plaster = mix(vec3(0.90, 0.89, 0.86), vec3(0.82, 0.82, 0.80), vTint * 0.4);
  // Side faces slightly cooler/darker so boxes read with thickness
  float sideAmt = 1.0 - abs(vLocalNormal.y);
  vec3 sideCol = mix(plaster, plaster * vec3(0.72, 0.73, 0.74), sideAmt * 0.85);
  vec3 body = mix(sideCol, plaster, faceMask);

  // Dark ink glyph on the inner face (atlas RGB already dark-on-light)
  float inkMask = faceMask * smoothstep(0.06, 0.38, h);
  vec3 ink = mix(atlas.rgb, mix(vec3(0.16, 0.17, 0.19), uAccent, 0.12), 0.35);
  vec3 color = mix(body, ink, inkMask);

  diffuseColor.rgb = color;
`;

/** Mild fake emboss via normal perturbation — no emissive / bloom path. */
export const glyphFragmentNormal = /* glsl */ `
  float faceMaskN = smoothstep(0.55, 0.92, abs(vLocalNormal.y) * step(0.0, vLocalNormal.y * uLayerSign));
  float hN = glyphHeight(vGlyphUv);
  vec2 texelN = vec2(1.25) / max(uAtlasSize, vec2(1.0));
  float hxN = glyphHeight(vGlyphUv + vec2(texelN.x, 0.0)) - glyphHeight(vGlyphUv - vec2(texelN.x, 0.0));
  float hyN = glyphHeight(vGlyphUv + vec2(0.0, texelN.y)) - glyphHeight(vGlyphUv - vec2(0.0, texelN.y));
  vec3 embossN = normalize(vec3(-hxN * 2.2, -hyN * 2.2, 1.0));
  float embAmt = faceMaskN * hN * 0.55;
  normal = normalize(mix(normal, normalize(normal + embossN * embAmt), embAmt));
`;
