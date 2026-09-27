/**
 * Loading-screen region map (pure, node-tested): the seed's macro region field
 * rasterized around the spawn, row by row so it can be computed in time slices and
 * drawn top to bottom as it goes. Deterministic: same seed + spawn → same pixels,
 * however the rows are sliced.
 *
 * Map axes: +x to the right, +z downward; the spawn is the centre pixel.
 */
import { REGION_COUNT, createRegionSample, type RegionField } from "../../terrain/regions";

export const REGION_MAP = {
  /** World units across the map. */
  span: 3600,
  /** Pixels across (square). */
  size: 320,
  /** Faint grid every this many world units. */
  grid: 400,
};

export type RegionMapSpec = { cx: number; cz: number; span: number; size: number };

export function mapSpec(cx: number, cz: number, size = REGION_MAP.size, span = REGION_MAP.span): RegionMapSpec {
  return { cx, cz, span, size };
}

/** World XZ of the centre of pixel (px, py). */
export function pixelToWorld(s: RegionMapSpec, px: number, py: number): [number, number] {
  const u = s.span / s.size;
  return [s.cx + (px + 0.5 - s.size / 2) * u, s.cz + (py + 0.5 - s.size / 2) * u];
}

/** Pixel coordinates (fractional) of world XZ. */
export function worldToPixel(s: RegionMapSpec, x: number, z: number): [number, number] {
  const u = s.span / s.size;
  return [(x - s.cx) / u + s.size / 2, (z - s.cz) / u + s.size / 2];
}

export type RGB = readonly [number, number, number];

export function hexToRgb(hex: string): RGB {
  const v = parseInt(hex.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const LINE: RGB = [98, 243, 255];

export class RegionMapRaster {
  readonly spec: RegionMapSpec;
  /** Dominant region id per pixel. */
  readonly ids: Uint8Array;
  /** Dominant weight per pixel (0…255; 128 ≈ on a border, 255 = core). */
  readonly dom: Uint8Array;
  /** Rows computed so far (top to bottom). */
  rows = 0;
  private readonly regions: RegionField;
  private readonly sample = createRegionSample();

  constructor(regions: RegionField, spec: RegionMapSpec) {
    this.regions = regions;
    this.spec = spec;
    this.ids = new Uint8Array(spec.size * spec.size);
    this.dom = new Uint8Array(spec.size * spec.size);
  }

  get done(): boolean {
    return this.rows >= this.spec.size;
  }

  /** Compute up to n more rows; returns how many were computed. */
  computeRows(n: number): number {
    const S = this.spec.size;
    const end = Math.min(S, this.rows + n);
    const from = this.rows;
    for (let y = this.rows; y < end; y++) {
      for (let x = 0; x < S; x++) {
        const [wx, wz] = pixelToWorld(this.spec, x, y);
        const r = this.regions.sample(wx, wz, this.sample);
        this.ids[y * S + x] = r.id < REGION_COUNT ? r.id : 0;
        this.dom[y * S + x] = Math.round(Math.max(0, Math.min(1, r.dominant)) * 255);
      }
    }
    this.rows = end;
    return end - from;
  }

  /**
   * Paint computed rows [y0, y1) into an RGBA buffer (size² × 4): region colour
   * dimmed toward borders, thin cyan border lines where the dominant region
   * changes (left / up neighbour), faint grid lines.
   */
  paintRows(rgba: Uint8ClampedArray | Uint8Array, y0: number, y1: number, colors: readonly RGB[]) {
    const S = this.spec.size;
    const last = Math.min(y1, this.rows);
    const u = this.spec.span / S;
    const g = REGION_MAP.grid;
    for (let y = y0; y < last; y++) {
      const wz0 = pixelToWorld(this.spec, 0, y)[1];
      const gridRow = Math.floor((wz0 - u / 2) / g) !== Math.floor((wz0 + u / 2) / g);
      for (let x = 0; x < S; x++) {
        const k = y * S + x;
        const id = this.ids[k];
        const c = colors[id] ?? LINE;
        const d = this.dom[k] / 255;
        const t = Math.max(0, Math.min(1, (d - 0.5) / 0.4));
        let m = 0.22 + 0.38 * t * t * (3 - 2 * t);
        let r = c[0] * m, gg = c[1] * m, b = c[2] * m;
        const border = (x > 0 && this.ids[k - 1] !== id) || (y > 0 && this.ids[k - S] !== id);
        const wx = pixelToWorld(this.spec, x, y)[0];
        const gridCol = Math.floor((wx - u / 2) / g) !== Math.floor((wx + u / 2) / g);
        if (border) m = 0.75;
        else if (gridRow || gridCol) m = 0.12;
        else m = 0;
        r += (LINE[0] - r) * m;
        gg += (LINE[1] - gg) * m;
        b += (LINE[2] - b) * m;
        rgba[k * 4] = Math.round(r);
        rgba[k * 4 + 1] = Math.round(gg);
        rgba[k * 4 + 2] = Math.round(b);
        rgba[k * 4 + 3] = 255;
      }
    }
  }
}
