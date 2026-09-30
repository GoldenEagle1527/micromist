/**
 * WebAssembly noise hot path (source: wasm/deep-march/noise.ts, AssemblyScript;
 * bytes: noiseWasmBytes.ts, rebuilt by scripts/deep-march-wasm.sh).
 *
 * A bit-exact port of the seeded simplex and of density.ts's warp / erosion /
 * ridged-octave code (scripts/deep-march-wasm-test.ts compares them). The module
 * is ~1.7 KB, so it compiles synchronously everywhere (main thread, workers, node);
 * any failure → null and density.ts keeps its JS path. Used when
 * TerrainSettings.wasm is true (debug panel: WASM); default = JS.
 *
 * Memory: one fixed block (no growth, so typed-array views stay valid); GRAD3 at 0,
 * then per-field blocks handed out by `alloc` (a field that doesn't fit uses JS).
 */
import { NOISE_WASM_BASE64 } from "./noiseWasmBytes";
import { GRAD3 } from "./noise";

export interface WasmNoise {
  f64: Float64Array;
  u8: Uint8Array;
  /** Byte offset of a new 8-aligned block, or −1 when memory is full. */
  alloc(bytes: number): number;
  snoise(t: number, x: number, y: number, z: number): number;
  warpErosion(t: number, ex: number, x: number, y: number, z: number, fw: number, W: number, Wv: number, es: number, out: number): void;
  ridged(
    t: number, offs: number, octaves: number, wx: number, wy: number, wz: number, freq0: number, rs2: number, weightMultiplier: number,
    fineOctaveFrom: number, fineOctaveGain: number, persistence: number, lacunarity: number, ox: number, oy: number, oz: number,
  ): number;
}

/** Pages (64 KiB) of the fixed memory block: ~2 KiB per density field → ~500 fields. */
const PAGES = 16;

let instance: WasmNoise | null | undefined;

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The WASM noise module (instantiated on first use), or null if WebAssembly is unavailable. */
export function getWasmNoise(): WasmNoise | null {
  if (instance !== undefined) return instance;
  try {
    const mod = new WebAssembly.Module(decode(NOISE_WASM_BASE64) as BufferSource);
    const inst = new WebAssembly.Instance(mod, {});
    const e = inst.exports as unknown as {
      memory: WebAssembly.Memory;
      snoise: WasmNoise["snoise"];
      warpErosion: WasmNoise["warpErosion"];
      ridged: WasmNoise["ridged"];
    };
    const have = e.memory.buffer.byteLength / 65536;
    if (have < PAGES) e.memory.grow(PAGES - have);
    const buf = e.memory.buffer;
    const f64 = new Float64Array(buf);
    f64.set(GRAD3, 0);
    let top = 512; // after GRAD3 (288 bytes)
    instance = {
      f64,
      u8: new Uint8Array(buf),
      alloc(bytes: number) {
        const at = top;
        const end = at + Math.ceil(bytes / 8) * 8;
        if (end > buf.byteLength) return -1;
        top = end;
        return at;
      },
      snoise: e.snoise,
      warpErosion: e.warpErosion,
      ridged: e.ridged,
    };
  } catch {
    instance = null;
  }
  return instance;
}
