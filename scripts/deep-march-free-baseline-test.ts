/**
 * Free-dive terrain baseline (bit-exact regression guard for the conserve mode work).
 *
 * The conserve mode will add terms to shared terrain code (site bias, ring wall,
 * chaos anomalies). In free-dive mode every one of them must be an identity, so the
 * free-dive world stays bit-for-bit what it was when this baseline was recorded
 * (staging e09f153). Hashes (SHA-256 over the raw float / int bytes) per seed and
 * terrain preset:
 *   - region field: weights, dominant id / weight, border distance on 2,000 points;
 *   - density: sample and sampleRaw on 10,000 points (surface band and deep rock);
 *   - column meshes: LOD 0 with terrain info, LOD 1 with skirts (every buffer);
 *   - spawn spot (position, yaw, region, clearance, exits).
 * Run: npm run test:free-baseline            (compare with the fixture)
 *      npm run test:free-baseline -- --record (rewrite the fixture: only on purpose)
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { TERRAIN, baseTerrain, terrainForDevice, type TerrainSettings } from "../src/games/deep-march/terrain/config";
import { createDensityField, type DensityField } from "../src/games/deep-march/terrain/density";
import { columnRows, generateColumnMesh, type ColumnMeshData } from "../src/games/deep-march/terrain/mesher";
import { mulberry32 } from "../src/games/deep-march/terrain/noise";
import { createRegionSample } from "../src/games/deep-march/terrain/regions";
import { findSpawn } from "../src/games/deep-march/terrain/spawn";
import type { ChunkTerrainInfo } from "../src/games/deep-march/terrain/terrainInfo";
import { createChecker } from "./lib/checks";

const FIXTURE = "scripts/fixtures/deep-march-free-baseline.json";
const SEEDS = [1, 42, 12345];
const PRESETS: Record<string, TerrainSettings> = {
  desktop: TERRAIN,
  phone: terrainForDevice(true),
  classification: baseTerrain(TERRAIN),
};
const DENSITY_POINTS = 10_000;
const REGION_POINTS = 2_000;
const MESH_PRESETS = new Set(["desktop"]);

type Baseline = Record<string, string>;

function digest(parts: ArrayLike<number>[] | ArrayBufferView[]): string {
  const h = createHash("sha256");
  for (const p of parts) {
    const view = ArrayBuffer.isView(p) ? p : Float64Array.from(p as ArrayLike<number>);
    h.update(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  }
  return h.digest("hex").slice(0, 32);
}

function regionHash(field: DensityField, seed: number): string {
  const rnd = mulberry32(seed ^ 0x5eed);
  const out = createRegionSample();
  const values: number[] = [];
  for (let i = 0; i < REGION_POINTS; i++) {
    const x = (rnd() - 0.5) * 8000, z = (rnd() - 0.5) * 8000;
    field.regions.sample(x, z, out);
    values.push(...out.w, out.id, out.dominant, out.edge);
  }
  return digest([values]);
}

function densityHash(field: DensityField, seed: number): string {
  const rnd = mulberry32(seed * 7 + 3);
  const values = new Float64Array(DENSITY_POINTS * 2);
  for (let i = 0; i < DENSITY_POINTS; i++) {
    const x = (rnd() - 0.5) * 6000, y = -120 + rnd() * 260, z = (rnd() - 0.5) * 6000;
    values[2 * i] = field.sample(x, y, z);
    values[2 * i + 1] = field.sampleRaw(x, y, z);
  }
  return digest([values]);
}

function infoBuffers(info: ChunkTerrainInfo): ArrayBufferView[] {
  const sp = info.spawn;
  const header = Float64Array.from([info.cx, info.cz, info.stride, info.spacing, info.ci0, info.cj0, info.ck0, info.nx, info.ny, info.nz, sp.count]);
  const grid = [info.env, info.up, info.down, info.side, info.sides, info.regionId, info.regionW, info.regionEdge];
  const spawn = [sp.pos, sp.nrm, sp.type, sp.env, sp.exposure, sp.flags, sp.curv, sp.region, sp.regionW, sp.regionEdge];
  return [header, ...grid, ...spawn];
}

function meshBuffers(m: ColumnMeshData): ArrayBufferView[] {
  const info = m.info ? infoBuffers(m.info) : [];
  return [m.positions, m.normals, m.ao, m.region, m.indices, m.bounds, m.removed, ...info];
}

function meshHash(field: DensityField, lod: number, cx: number, cz: number): string {
  const s = field.settings;
  const mesh = generateColumnMesh(field, cx, cz, columnRows(field, lod), s.floaterMargin << lod, undefined, lod === 0, undefined, lod);
  return digest(meshBuffers(mesh));
}

function spawnHash(field: DensityField): string {
  const p = findSpawn(field);
  return digest([[p.x, p.y, p.z, p.yaw, p.region, p.clearance, p.exits]]);
}

function computeBaseline(): Baseline {
  const out: Baseline = {};
  for (const seed of SEEDS) {
    for (const [name, preset] of Object.entries(PRESETS)) {
      const field = createDensityField(seed, preset);
      const key = `seed ${seed} · ${name}`;
      out[`${key} · regions`] = regionHash(field, seed);
      out[`${key} · density`] = densityHash(field, seed);
      if (!MESH_PRESETS.has(name)) continue;
      out[`${key} · mesh L0 (0,0)`] = meshHash(field, 0, 0, 0);
      out[`${key} · mesh L1 (2,-1)`] = meshHash(field, 1, 2, -1);
      out[`${key} · spawn`] = spawnHash(field);
    }
  }
  return out;
}

const t0 = performance.now();
const current = computeBaseline();
const ms = Math.round(performance.now() - t0);

if (process.argv.includes("--record")) {
  writeFileSync(FIXTURE, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`recorded ${Object.keys(current).length} hashes → ${FIXTURE} (${ms} ms)`);
} else {
  const c = createChecker();
  const expected = JSON.parse(readFileSync(FIXTURE, "utf8")) as Baseline;
  c.section(`free-dive terrain baseline (${ms} ms)`);
  c.check(Object.keys(expected).length === Object.keys(current).length, "same set of baseline entries", `${Object.keys(current).length}`);
  for (const [key, hash] of Object.entries(expected)) c.check(current[key] === hash, key, current[key] === hash ? hash.slice(0, 12) : `${current[key]} ≠ ${hash}`);
  c.finish();
}
