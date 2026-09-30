/**
 * Sonar scan record (scene/sonarScan): point packing, what a ping records and
 * clears, staleness after a tide (the record is never refreshed from the live
 * terrain — only a re-ping overwrites it, inside its sphere), the wavefront-paced
 * sweep, LRU memory bounds, the save codec and stores, and the mesh sources.
 * Run: npm run test:scan
 */
import * as THREE from "three";
import { SCAN_GRID, packPoint, unpackPoint } from "../src/games/deep-march/scene/sonarScan/scanGrid";
import { ScanRecord } from "../src/games/deep-march/scene/sonarScan/scanRecord";
import { ScanSweep } from "../src/games/deep-march/scene/sonarScan/scanSweep";
import { SCAN_CODEC_VERSION, decodeScan, encodeScan } from "../src/games/deep-march/scene/sonarScan/scanCodec";
import { resetSessionScans, saveScanKey, savedScanStore, sessionScanStore } from "../src/games/deep-march/scene/sonarScan/scanStore";
import { SCAN_TUNING, sourcesOf } from "../src/games/deep-march/scene/sonarScan/sonarScanner";
import { createChecker } from "./lib/checks";
import { fingerprint, pingAll, pointsOf, terrain } from "./lib/scanFixture";

const c = createChecker();
const pt = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };

c.section("point packing (52 bits in a double)");
{
  let worstXZ = 0, worstY = 0, worstN = 1, rnd = 7;
  const r = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 5000; i++) {
    const lx = r() * 31.99, lz = r() * 31.99, y = -2000 + r() * 4000;
    const n = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
    const p = packPoint(lx, y, lz, n.x, n.y, n.z);
    unpackPoint(p, -3, 5, pt);
    worstXZ = Math.max(worstXZ, Math.abs(pt.x - (-96 + lx)), Math.abs(pt.z - (160 + lz)));
    worstY = Math.max(worstY, Math.abs(pt.y - y));
    worstN = Math.min(worstN, pt.nx * n.x + pt.ny * n.y + pt.nz * n.z);
    if (!Number.isSafeInteger(p) || p >= 2 ** 52) worstN = -9;
  }
  c.check(worstXZ <= 1 / 256 + 1e-9 && worstY <= 1 / 32 + 1e-9, "position within half a step (1/128 m across, 1/16 m up)", `xz ${worstXZ.toFixed(4)} m, y ${worstY.toFixed(4)} m`);
  c.check(worstN >= 0.97, "normal (octahedral 6+6 bits) within ~14°", `min dot ${worstN.toFixed(3)}`);
}

const A = () => -50; // terrain before the tide
const B = (x: number) => (x >= 0 ? -45 : -58); // after: the east rose 5 m, the west fell 8 m
const world = (h: (x: number, z: number) => number) => terrain(h, -128, 128, -128, 128);
const diver = { x: 0, y: -40, z: 0 };

c.section("a ping records what its sphere reaches, nothing else");
const rec = new ScanRecord(1e6);
{
  c.check(rec.points === 0 && rec.tiles.size === 0, "never pinged: an empty record (observation mode shows nothing)");
  const sw = pingAll(rec, diver, 60, world(A));
  const pts = pointsOf(rec);
  c.check(pts.length > 2000 && pts.length === rec.points, "the seabed around the diver is recorded", `${pts.length} points in ${rec.tiles.size} tiles, ${sw.scanned} vertices scanned`);
  c.check(pts.every((p) => Math.hypot(p.x, p.y + 40, p.z) <= 60 + 0.01 && p.y === -50), "only points inside the ping sphere, on the terrain as it was");
  c.check(pts.every((p) => p.ny > 0.99), "skirts (vertices past the surface count) never recorded");
  c.check(rec.tile(3, 3, false) === null && !pts.some((p) => Math.abs(p.x) > 64), "places outside every ping hold nothing");
  const cells = new Set(pts.map((p) => `${Math.floor(p.x / 2)},${Math.floor(p.y / 2)},${Math.floor(p.z / 2)}`));
  c.check(cells.size === pts.length, "one point per 2 m cell", `${cells.size} cells`);
}

c.section("after a tide the record is stale until re-pinged");
{
  const before = fingerprint(rec);
  const tideWorld = world(B); // the tide rebuilds the terrain meshes; nothing touches the record
  c.check(fingerprint(rec) === before, "the tide leaves the record as it was (old terrain, stale by design)");
  const east = { x: 40, y: -40, z: 0 }, R = 22;
  pingAll(rec, east, R, tideWorld);
  const pts = pointsOf(rec);
  const inside = (p: typeof pt, o: typeof east, r: number) => Math.hypot(p.x - o.x, p.y - o.y, p.z - o.z) <= r;
  const inE = pts.filter((p) => inside(p, east, R));
  c.check(inE.length > 100 && inE.every((p) => p.y === -45), "terrain that rose: the re-ping's sphere holds only the new seabed", `${inE.length} points`);
  const old = pts.filter((p) => !inside(p, east, R));
  c.check(old.length > 1000 && old.every((p) => p.y === -50), "outside the re-ping the old (now wrong) terrain stays", `${old.length} stale points`);
  const west = { x: -40, y: -50, z: 0 };
  pingAll(rec, west, 20, tideWorld);
  const pw = pointsOf(rec).filter((p) => inside(p, west, 20));
  c.check(pw.length > 100 && pw.every((p) => p.y === -58), "terrain that fell away: the old points inside the sphere are cleared, the new floor recorded", `${pw.length} points`);
  c.check(!pointsOf(rec).some((p) => inside(p, west, 20) && p.y === -50), "no ghost of the old floor inside the re-pinged sphere");
  const gone = new ScanRecord(1e6);
  pingAll(gone, diver, 60, world(A));
  pingAll(gone, diver, 60, []); // rock became open water
  c.check(gone.points === 0 && gone.tiles.size === 0, "a re-ping that finds nothing clears the sphere (and drops its empty tiles)");
}

c.section("the sweep follows the wavefront");
{
  const r = new ScanRecord(1e6);
  pingAll(r, diver, 90, world(A));
  const stale = r.points;
  const s = new ScanSweep(r.begin(diver.x, diver.y, diver.z, 90), world(B));
  const total = s.pending;
  s.step(4, Infinity);
  c.check(s.scanned === 0 && r.points === stale, "front 4 m: nothing reached yet (the nearest floor is 5 m below)");
  s.step(12, 1);
  c.check(s.pending === total - 1 && s.scanned === 33 * 33, "a budget of 1: one column per step, never split", `${s.pending}/${total} left`);
  s.step(40, 8000);
  const mid = pointsOf(r);
  c.check(mid.some((p) => p.y === -50) && mid.some((p) => p.y !== -50) && !s.done, "mid-sweep: new echoes near, old record far");
  let steps = 0;
  for (let f = 40; !s.done && steps < 1000; f += 5, steps++) s.step(f, 8000);
  c.check(s.done && pointsOf(r).every((p) => p.y !== -50), "the sweep ends with the whole sphere rescanned", `${steps} more steps`);
}

c.section("memory bound (LRU)");
{
  const cap = 1500;
  const r = new ScanRecord(cap);
  const spots = [-96, 0, 96].map((x) => ({ x, y: -40, z: 0 }));
  const flat = terrain(A, -160, 160, -32, 32);
  const sizes: number[] = [];
  for (const o of spots) {
    pingAll(r, o, 30, flat);
    sizes.push(r.points);
  }
  const now = r.now;
  const cur = [...r.tiles.values()];
  c.check(r.points <= cap && sizes.every((n) => n <= cap), "never over the cap after a ping", sizes.join(" → "));
  const of = (u: number) => cur.filter((t) => t.used === u).length;
  c.check(of(now) === 4 && of(2) === 4 && of(1) < 4, "the oldest ping's tiles go first (just enough of them); newer pings stay whole", `tiles per ping ${of(1)} / ${of(2)} / ${of(now)}`);
  const big = new ScanRecord(500);
  pingAll(big, diver, 60, world(A));
  c.check(big.points > 500 && [...big.tiles.values()].every((t) => t.used === big.now), "a single ping bigger than the cap is kept whole (trimmed at the next ping)", `${big.points}`);
  c.check(SCAN_TUNING.cap.phone <= 100_000 && SCAN_TUNING.cap.phone * 7 <= 1 << 20, "phone: ≤ 100k points, ≤ 1 MB saved", `${SCAN_TUNING.cap.phone} points`);
}

c.section("save codec and stores");
{
  const bytes = encodeScan(rec);
  const back = decodeScan(bytes, 1e6);
  c.check(!!back && fingerprint(back) === fingerprint(rec) && back.points === rec.points, "encode → decode: same tiles and points", `${bytes.length} B for ${rec.points} points`);
  const order = (x: ScanRecord) => [...x.tiles.values()].sort((a, b) => a.used - b.used).map((t) => t.key).join();
  c.check(!!back && order(back) === order(rec) && [...back.tiles.values()].every((t) => t.used < 0), "LRU order survives, older than any new ping");
  c.check(bytes.length === 12 + rec.tiles.size * 8 + rec.points * 7, "7 bytes per point + 8 per tile + 12");
  const bad = (f: (b: Uint8Array) => Uint8Array) => decodeScan(f(bytes.slice()), 1e6) === null;
  c.check(bad((b) => ((b[0] = 0x58), b)) && bad((b) => ((b[4] = SCAN_CODEC_VERSION + 1), b)) && bad((b) => b.slice(0, b.length - 3)) && bad((b) => Uint8Array.from([...b, 0])) && bad(() => new Uint8Array(4)), "bad magic, version, truncated, trailing bytes, too short → null");
  const small = decodeScan(bytes, 1500);
  c.check(!!small && small.points <= 1500 && small.points > 0, "decoded over a smaller cap: oldest tiles dropped", `${small?.points}`);
  const kv = new Map<string, unknown>();
  const io = { read: (k: string) => kv.get(k), write: (k: string, v: unknown) => void kv.set(k, v) };
  const { key, tag } = saveScanKey({ id: "slot-1", createdAt: 1700, seed: 42 });
  c.check(key === "scan/slot-1" && tag === "1700:42", "one key per save, tagged with the world", `${key} ${tag}`);
  const st = savedScanStore(io, key, tag);
  c.check(st.persistent && st.open(1e6).points === 0, "a save without scans opens empty");
  st.save(rec);
  c.check(fingerprint(savedScanStore(io, key, tag).open(1e6)) === fingerprint(rec), "saved → reopened (next session): the same (stale) record");
  c.check(savedScanStore(io, key, "1800:42").open(1e6).points === 0, "a new world in the slot never inherits the old scans");
  kv.set(key, { v: 1, tag, bytes: new Uint8Array([1, 2, 3]) });
  c.check(savedScanStore(io, key, tag).open(1e6).points === 0, "garbage in the store → empty record, no throw");
}

c.section("free dive: session only");
{
  resetSessionScans();
  const a = sessionScanStore(5).open(SCAN_TUNING.cap.phone);
  pingAll(a, diver, 30, world(A));
  c.check(!sessionScanStore(5).persistent && sessionScanStore(5).open(SCAN_TUNING.cap.phone) === a, "same seed again this session: the same record");
  c.check(sessionScanStore(6).open(SCAN_TUNING.cap.phone).points === 0 && sessionScanStore(5).open(SCAN_TUNING.cap.phone).points === 0, "another seed replaces it (one record in memory)");
}

c.section("scan sources from the column meshes");
{
  const g = new THREE.Group();
  const geo = (surface?: number) => {
    const b = new THREE.BufferGeometry();
    b.setAttribute("position", new THREE.BufferAttribute(new Float32Array(30), 3));
    b.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(30), 3));
    b.computeBoundingBox();
    if (surface !== undefined) b.userData.surfaceVerts = surface;
    return b;
  };
  g.add(new THREE.Mesh(geo(6)), new THREE.Mesh(geo()), new THREE.Object3D());
  const s = sourcesOf(g);
  c.check(s.length === 1 && s[0].count === 6, "only tagged column meshes, surface vertices only (skirts after them)", `${s.length}`);
}
c.check(SCAN_GRID.tile === 32 && SCAN_GRID.cell === 2, "grid: 32 m tiles, 2 m cells");
c.finish();
