/** Sea World shader colour ramp (SeaWorldColours gradient) as a linear-RGB LUT. */
import { SEA_COLORS } from "./config";

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const LUT_SIZE = 256;

function buildLut(): Float32Array {
  const keys = SEA_COLORS.keys;
  const lut = new Float32Array(LUT_SIZE * 3);
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = (i / (LUT_SIZE - 1)) * 65535;
    let k = 0;
    while (k < keys.length - 2 && keys[k + 1][3] < t) k++;
    const a = keys[k];
    const b = keys[k + 1];
    const f = Math.min(1, Math.max(0, (t - a[3]) / (b[3] - a[3])));
    for (let c = 0; c < 3; c++) {
      // Unity blends gradient keys in gamma space, then the colour is linearised.
      lut[i * 3 + c] = srgbToLinear(a[c] + (b[c] - a[c]) * f);
    }
  }
  return lut;
}

export const RAMP_LUT = buildLut();

/**
 * Sea World surf(): h = ((worldY + pow(ny*.5+.5, p.z) * p.x) / p.y) % 1
 * Writes linear RGB into out[o..o+2].
 */
export function seaWorldColor(y: number, ny: number, out: Float32Array, o: number): void {
  const [px, py, pz] = SEA_COLORS.params;
  let h = (y + Math.pow(Math.max(0, ny * 0.5 + 0.5), pz) * px) / py;
  h -= Math.floor(h); // texture wrap = repeat
  const idx = Math.min(LUT_SIZE - 1, Math.floor(h * LUT_SIZE)) * 3;
  out[o] = RAMP_LUT[idx];
  out[o + 1] = RAMP_LUT[idx + 1];
  out[o + 2] = RAMP_LUT[idx + 2];
}
