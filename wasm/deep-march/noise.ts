// AssemblyScript source of the deep-march noise hot path (terrain/noiseWasm.ts).
// Build: scripts/deep-march-wasm.sh → src/games/deep-march/terrain/noiseWasmBytes.ts
//
// Bit-exact port of terrain/noise.ts createSimplex3 and the density.ts warp /
// erosion / ridged-octave code: same f64 operations in the same order (WebAssembly
// has no implicit fused multiply-add; f64.sqrt / floor are exact like JS Math).
//
// Memory is owned by the JS side (no AS runtime, no static data):
//   [0, 288)          GRAD3 as 36 f64
//   table block (per simplex seed): perm u8[512] at t, permMod12·3 u8[512] at t + 512
//   offsets block: f64 values (warp / erosion offsets, octave offsets)
//   out block: f64 results

const F3: f64 = 1.0 / 3.0;
const G3: f64 = 1.0 / 6.0;

// @ts-ignore: decorator
@inline function grad(g: i32, x: f64, y: f64, z: f64): f64 {
  return load<f64>(g << 3) * x + load<f64>((g + 1) << 3) * y + load<f64>((g + 2) << 3) * z;
}

// @ts-ignore: decorator
@inline function perm(t: i32, i: i32): i32 {
  return <i32>load<u8>(t + i);
}

export function snoise(t: i32, xin: f64, yin: f64, zin: f64): f64 {
  const s = (xin + yin + zin) * F3;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const k = Math.floor(zin + s);
  const tt = (i + j + k) * G3;
  const x0 = xin - (i - tt);
  const y0 = yin - (j - tt);
  const z0 = zin - (k - tt);

  let i1: f64, j1: f64, k1: f64, i2: f64, j2: f64, k2: f64;
  if (x0 >= y0) {
    if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
    else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
  } else {
    if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
    else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
    else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
  }

  const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2.0 * G3, y2 = y0 - j2 + 2.0 * G3, z2 = z0 - k2 + 2.0 * G3;
  const x3 = x0 - 1.0 + 3.0 * G3, y3 = y0 - 1.0 + 3.0 * G3, z3 = z0 - 1.0 + 3.0 * G3;

  const ii = <i32>i & 255, jj = <i32>j & 255, kk = <i32>k & 255;
  const I1 = <i32>i1, J1 = <i32>j1, K1 = <i32>k1, I2 = <i32>i2, J2 = <i32>j2, K2 = <i32>k2;
  const m = t + 512;
  let n: f64 = 0;

  let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
  if (t0 > 0) {
    const g = perm(m, ii + perm(t, jj + perm(t, kk)));
    t0 *= t0;
    n += t0 * t0 * grad(g, x0, y0, z0);
  }
  let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
  if (t1 > 0) {
    const g = perm(m, ii + I1 + perm(t, jj + J1 + perm(t, kk + K1)));
    t1 *= t1;
    n += t1 * t1 * grad(g, x1, y1, z1);
  }
  let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
  if (t2 > 0) {
    const g = perm(m, ii + I2 + perm(t, jj + J2 + perm(t, kk + K2)));
    t2 *= t2;
    n += t2 * t2 * grad(g, x2, y2, z2);
  }
  let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
  if (t3 > 0) {
    const g = perm(m, ii + 1 + perm(t, jj + 1 + perm(t, kk + 1)));
    t3 *= t3;
    n += t3 * t3 * grad(g, x3, y3, z3);
  }
  return 32 * n;
}

/**
 * Domain warp + erosion simplex (density.ts evalRaw): writes wx, wy, wz, en to out.
 * ex: the extra-offset array (f64), fw warp frequency, W warp strength, Wv vertical factor,
 * es erosion frequency.
 */
export function warpErosion(t: i32, ex: i32, x: f64, y: f64, z: f64, fw: f64, W: f64, Wv: f64, es: f64, out: i32): void {
  const wx = x + W * snoise(t, x * fw + load<f64>(ex), y * fw + load<f64>(ex + 8), z * fw + load<f64>(ex + 16));
  const wy = y + W * Wv * snoise(t, x * fw + load<f64>(ex + 24), y * fw + load<f64>(ex + 32), z * fw + load<f64>(ex + 40));
  const wz = z + W * snoise(t, x * fw + load<f64>(ex + 48), y * fw + load<f64>(ex + 56), z * fw + load<f64>(ex + 64));
  const en = snoise(t, wx * es + load<f64>(ex + 120), wy * es + load<f64>(ex + 128), wz * es + load<f64>(ex + 136));
  store<f64>(out, wx);
  store<f64>(out + 8, wy);
  store<f64>(out + 16, wz);
  store<f64>(out + 24, en);
}

/** Reference ridged noise (density.ts evalRaw octave loop); offs: octave offsets (f64 × 3 per octave). */
export function ridged(
  t: i32, offs: i32, octaves: i32, wx: f64, wy: f64, wz: f64, freq0: f64, rs2: f64, weightMultiplier: f64,
  fineOctaveFrom: i32, fineOctaveGain: f64, persistence: f64, lacunarity: f64, ox: f64, oy: f64, oz: f64,
): f64 {
  let noise: f64 = 0;
  let frequency = freq0;
  let amplitude: f64 = 1;
  let weight: f64 = 1;
  for (let j = 0; j < octaves; j++) {
    const o = offs + j * 24;
    const nn = snoise(t, wx * frequency + load<f64>(o) + ox, wy * frequency + load<f64>(o + 8) + oy, wz * frequency + load<f64>(o + 16) + oz);
    let v = Math.max(0, 1 - Math.sqrt(nn * nn + rs2));
    v = v * v * weight;
    weight = Math.max(Math.min(v * weightMultiplier, 1), 0);
    noise += j >= fineOctaveFrom ? v * amplitude * fineOctaveGain : v * amplitude;
    if (weight == 0) break;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return noise;
}
