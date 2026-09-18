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

float glyphSample(vec2 uv) {
  return texture2D(uAtlas, uv).a;
}
`;

export const glyphFragmentColor = /* glsl */ `
  vec3 wn = normalize(vWorldNormal);
  // Inner corridor face: floor uses +Y local, ceiling uses -Y local
  float faceMask = smoothstep(0.55, 0.92, abs(vLocalNormal.y) * step(0.0, vLocalNormal.y * uLayerSign));

  vec4 atlas = texture2D(uAtlas, vGlyphUv);
  float h = atlas.a;

  // Fake emboss / parallax-ish via finite differences on alpha height
  vec2 texel = vec2(1.5) / max(uAtlasSize, vec2(1.0));
  float hx = glyphSample(vGlyphUv + vec2(texel.x, 0.0)) - glyphSample(vGlyphUv - vec2(texel.x, 0.0));
  float hy = glyphSample(vGlyphUv + vec2(0.0, texel.y)) - glyphSample(vGlyphUv - vec2(0.0, texel.y));
  vec3 embossN = normalize(vec3(-hx * 3.2, -hy * 3.2, 0.35));

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 litN = normalize(mix(wn, normalize(wn + embossN * 0.65 * faceMask), faceMask * h));
  float ndl = clamp(dot(litN, normalize(vec3(0.25, uLayerSign * 0.85, 0.35))), 0.0, 1.0);
  float rim = pow(1.0 - clamp(dot(wn, viewDir), 0.0, 1.0), 2.4);

  vec3 baseCol = mix(vec3(0.035, 0.05, 0.08), vec3(0.06, 0.09, 0.12), vTint);
  vec3 metal = baseCol * (0.35 + 0.65 * ndl) + rim * uAccent * 0.12;

  vec3 glyphCol = atlas.rgb * uAccent * (0.55 + 0.45 * vTint);
  float pulse = 0.85 + 0.15 * sin(uTime * 1.4 + vWorldPos.x * 0.35 + vWorldPos.z * 0.2);
  vec3 embEmissive = glyphCol * h * faceMask * (1.15 + 0.55 * ndl) * pulse;
  embEmissive += glyphCol * h * faceMask * rim * 0.85;

  float shade = mix(0.55, 1.15, 0.5 + 0.5 * embossN.x + 0.25 * embossN.y);
  embEmissive *= mix(1.0, shade, faceMask * h);

  vec3 color = mix(metal, metal * 0.35 + embEmissive, faceMask * smoothstep(0.05, 0.45, h));
  float spark = step(0.985, fract(vWorldPos.x * 2.1 + vWorldPos.z * 1.7 + uTime * 0.08));
  color += uAccent * spark * (1.0 - faceMask) * 0.08;

  diffuseColor.rgb = color;
`;

export const glyphFragmentEmissive = /* glsl */ `
  // Recompute a light emissive add for bloom (matches color path)
  float faceMaskE = smoothstep(0.55, 0.92, abs(vLocalNormal.y) * step(0.0, vLocalNormal.y * uLayerSign));
  vec4 atlasE = texture2D(uAtlas, vGlyphUv);
  float hE = atlasE.a;
  vec3 glyphColE = atlasE.rgb * uAccent * (0.55 + 0.45 * vTint);
  float pulseE = 0.85 + 0.15 * sin(uTime * 1.4 + vWorldPos.x * 0.35 + vWorldPos.z * 0.2);
  totalEmissiveRadiance += glyphColE * hE * faceMaskE * 1.35 * pulseE;
`;
