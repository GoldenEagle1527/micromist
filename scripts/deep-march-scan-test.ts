/**
 * Sonar scan record (scene/sonarScan): recorded surfaces. The grid and the sphere
 * cut (lib/scanClipChecks.ts); what a ping records; overlapping pings meeting without
 * cracks or overlaps; staleness after a tide (never refreshed from the live terrain —
 * only a re-ping overwrites it, inside its sphere, clearing what fell away); the
 * wavefront-paced sweep; LRU memory bounds; the save codec and stores; mesh sources.
 * Run: npm run test:scan
 */
import * as THREE from "three";
import { ScanRecord } from "../src/games/deep-march/scene/sonarScan/scanRecord";
import { ScanSweep } from "../src/games/deep-march/scene/sonarScan/scanSweep";
import { SCAN_CODEC_VERSION, decodeScan, encodeScan } from "../src/games/deep-march/scene/sonarScan/scanCodec";
import { resetSessionScans, saveScanKey, savedScanStore, sessionScanStore } from "../src/games/deep-march/scene/sonarScan/scanStore";
import { SCAN_TUNING, sourcesOf } from "../src/games/deep-march/scene/sonarScan/sonarScanner";
import { createChecker } from "./lib/checks";
import { scanClipChecks } from "./lib/scanClipChecks";
import { edgeUse, fingerprint, footprintOf, lodTerrain, pingAll, terrain, trianglesOf, type V3 } from "./lib/scanFixture";

const c = createChecker();
scanClipChecks(c);

const A = () => -50; // the seabed before the tide
const B = (x: number) => (x >= 0 ? -45 : -58); // after: the east rose 5 m, the west fell 8 m
const world = (h: (x: number, z: number) => number) => terrain(h, -160, 160, -160, 160);
const diver = { x: 0, y: -40, z: 0 };
const dist = (p: V3, o: V3) => Math.hypot(p.x - o.x, p.y - o.y, p.z - o.z);
const corners = (rec: ScanRecord) => trianglesOf(rec).flatMap((t) => [t.a, t.b, t.c]);

c.section("a ping records the surfaces its sphere reaches, nothing else");
const rec = new ScanRecord(1e7);
{
  c.check(rec.verts === 0 && rec.tiles.size === 0, "never pinged: an empty record (observation mode is black)");
  pingAll(rec, diver, 60, world(A));
  const tris = trianglesOf(rec), disc = Math.PI * (60 * 60 - 10 * 10);
  c.check(tris.length > 5000 && Math.abs(rec.area - disc) < 0.01 * disc && Math.abs(footprintOf(tris) - rec.area) < 1, "the seabed inside the sphere, as a surface", `${tris.length} triangles, ${rec.area.toFixed(0)} m² of a ${disc.toFixed(0)} m² disc`);
  c.check(corners(rec).every((p) => dist(p, diver) <= 60 + 1e-3 && p.y === -50), "nothing outside the sphere, the terrain as it was, skirts never recorded");
  c.check(tris.every((t) => t.n.y > 0.99), "normals kept");
  c.check(![...rec.tiles.values()].some((t) => Math.abs(t.tx) > 3 || Math.abs(t.tz) > 3), "places outside every ping hold nothing");
}

c.section("overlapping pings meet exactly (no cracks, no overlaps)");
{
  const r2 = new ScanRecord(1e7), s1 = { ...diver, r: 50 }, s2 = { x: 55, y: -42, z: 20, r: 45 };
  pingAll(r2, s1, s1.r, world(A));
  pingAll(r2, s2, s2.r, world(A));
  const edges = [...edgeUse(trianglesOf(r2)).values()];
  const onRim = (p: V3) => [s1, s2].some((s) => Math.abs(dist(p, s) - s.r) < 1e-2) && [s1, s2].every((s) => dist(p, s) > s.r - 1e-2);
  const open = edges.filter((e) => e.n === 1), inner = open.filter((e) => !(onRim(e.a) && onRim(e.b)));
  // where the two rims cross, the old surface was already cut along the first rim: its cut along the
  // second can't share the new mesh's triangulation there, and the two chords of one sphere differ by mm
  const nearRim = (p: V3, tol: number) => [s1, s2].filter((s) => Math.abs(dist(p, s) - s.r) < tol).length;
  const junk = inner.filter((e) => ![e.a, e.b].every((p) => nearRim(p, 5e-3) >= 1 && nearRim(p, 1.5) === 2));
  c.check(open.length > 100 && junk.length === 0 && inner.length < 20, "open edges only on the outer rim (plus mm-wide slivers where two rims cross)", `${open.length} rim edges, ${inner.length} at the crossing, ${junk.length} elsewhere`);
  c.check(edges.every((e) => e.n <= 2), "no edge used more than twice (no doubled surface)");
}

c.section("after a tide the record is stale until re-pinged");
{
  const before = fingerprint(rec);
  const tideWorld = world(B); // the tide rebuilds the terrain meshes; nothing touches the record
  c.check(fingerprint(rec) === before, "the tide leaves the record as it was (old terrain, stale by design)");
  const east = { x: 40, y: -40, z: 0 }, R = 22;
  pingAll(rec, east, R, tideWorld);
  const pts = corners(rec);
  const inE = pts.filter((p) => dist(p, east) < R - 1e-3), outE = pts.filter((p) => dist(p, east) > R + 1e-3);
  c.check(inE.length > 100 && inE.every((p) => p.y === -45), "terrain that rose: inside the re-ping only the new seabed", `${inE.length} vertices`);
  c.check(outE.length > 1000 && outE.every((p) => p.y === -50), "outside the re-ping the old (now wrong) terrain stays", `${outE.length} stale vertices`);
  const west = { x: -40, y: -50, z: 0 };
  pingAll(rec, west, 20, tideWorld);
  const inW = corners(rec).filter((p) => dist(p, west) < 20 - 1e-3);
  c.check(inW.length > 100 && inW.every((p) => p.y === -58), "terrain that fell away: the old floor inside the sphere is cut out, the new one recorded", `${inW.length} vertices`);
  const gone = new ScanRecord(1e7);
  pingAll(gone, diver, 60, world(A));
  const hole = { x: 20, y: -45, z: 0 };
  pingAll(gone, hole, 15, []); // rock became open water
  const left = corners(gone);
  c.check(left.length > 0 && left.every((p) => dist(p, hole) >= 15 - 1e-3), "a re-ping that finds nothing clears its sphere (a hole), the rest stays", `${gone.area.toFixed(0)} m² left`);
  pingAll(gone, diver, 100, []);
  c.check(gone.verts === 0 && gone.tiles.size === 0 && Math.abs(gone.area) < 1e-6, "…and a big enough one clears it all (empty tiles dropped)");
}

c.section("the sweep follows the wavefront");
{
  const r = new ScanRecord(1e7);
  pingAll(r, diver, 90, world(A));
  const stale = fingerprint(r);
  const s = new ScanSweep(r.begin(diver.x, diver.y, diver.z, 90), world(B));
  const total = s.pending;
  s.step(4, Infinity);
  c.check(s.pending === total && fingerprint(r) === stale, "front 4 m: nothing reached yet (the nearest floor is 5 m below)");
  s.step(12, 1);
  c.check(s.pending === total - 1 && fingerprint(r) === stale, "a budget of 1: one column read per step, nothing committed ahead of the front", `${s.pending}/${total} left`);
  s.step(60, Infinity);
  const mid = corners(r);
  c.check(mid.some((p) => p.y === -50) && mid.some((p) => p.y !== -50) && !s.done, "mid-sweep: new surfaces behind the front, the old record beyond it");
  let steps = 0;
  for (let f = 60; !s.done && steps < 1000; f += 5, steps++) s.step(f, 20000);
  c.check(s.done && corners(r).every((p) => p.y !== -50 || Math.abs(dist(p, diver) - 90) < 1e-3), "the sweep ends with the whole sphere rescanned", `${steps} more steps, ${s.work} triangles of work`);
}

c.section("memory bound (LRU)");
{
  const flat = terrain(A, -192, 192, -32, 32);
  const one = new ScanRecord(1e7);
  pingAll(one, { x: 0, y: -40, z: 0 }, 30, flat);
  const cap = Math.round(one.verts * 2.5), r = new ScanRecord(cap), sizes: number[] = [];
  for (const x of [-120, 0, 120]) {
    pingAll(r, { x, y: -40, z: 0 }, 30, flat);
    sizes.push(r.verts);
  }
  const of = (u: number) => [...r.tiles.values()].filter((t) => t.used === u).length;
  const whole = [-120, 0, 120].map((x) => {
    const solo = new ScanRecord(1e7);
    pingAll(solo, { x, y: -40, z: 0 }, 30, flat);
    return solo.tiles.size;
  });
  c.check(sizes.every((n) => n <= cap), "never over the cap after a ping", `${sizes.join(" → ")} ≤ ${cap}`);
  c.check(of(3) === whole[2] && of(2) === whole[1] && of(1) < whole[0], "the oldest ping's tiles go first; newer pings stay whole", `tiles per ping ${of(1)}/${whole[0]} · ${of(2)}/${whole[1]} · ${of(3)}/${whole[2]}`);
  const big = new ScanRecord(500);
  pingAll(big, diver, 60, world(A));
  c.check(big.verts > 500 && [...big.tiles.values()].every((t) => t.used === big.now), "a single ping bigger than the cap is kept whole (trimmed at the next ping)", `${big.verts}`);
  const phone = new ScanRecord(1e7), wavy = (x: number, z: number) => -50 + 6 * Math.sin(x / 23) * Math.cos(z / 17);
  pingAll(phone, diver, 206, lodTerrain(wavy, 0, 0));
  c.check(SCAN_TUNING.cap.phone * 20 <= 3 * 1048576 && phone.verts * 3 <= SCAN_TUNING.cap.phone, "phone: ≤ 3 MB of record (≈ 20 B per vertex with its triangles), ≥ 3 full pings of new seabed kept", `cap ${SCAN_TUNING.cap.phone} vertices; one 206 m ping over LOD columns: ${phone.verts} vertices, ${(phone.area / 1e6).toFixed(3)} km²`);
}

c.section("save codec and stores");
{
  const bytes = encodeScan(rec);
  const back = decodeScan(bytes, 1e7);
  c.check(!!back && fingerprint(back) === fingerprint(rec) && back.verts === rec.verts && Math.abs(back.area - rec.area) < 1, "encode → decode: the same surfaces", `${(bytes.length / 1024).toFixed(0)} KB for ${rec.verts} vertices (${(bytes.length / rec.verts).toFixed(1)} B each)`);
  const order = (x: ScanRecord) => [...x.tiles.values()].sort((a, b) => a.used - b.used).map((t) => t.key).join();
  c.check(!!back && order(back) === order(rec) && [...back.tiles.values()].every((t) => t.used < 0), "LRU order survives, older than any new ping");
  const bad = (f: (b: Uint8Array) => Uint8Array) => decodeScan(f(bytes.slice()), 1e7) === null;
  c.check(bad((b) => ((b[0] = 0x58), b)) && bad((b) => ((b[4] = SCAN_CODEC_VERSION + 1), b)) && bad((b) => ((b[4] = 1), b)) && bad((b) => b.slice(0, b.length - 3)) && bad((b) => Uint8Array.from([...b, 0])) && bad(() => new Uint8Array(4)), "bad magic, other versions (the old point format too), truncated, trailing bytes → null");
  const bi = bytes.slice(), last = bi.length - 2;
  bi[last] = 0xff;
  bi[last + 1] = 0xff;
  c.check(decodeScan(bi, 1e7) === null, "an index past its tile's vertices → null");
  const small = decodeScan(bytes, Math.round(rec.verts / 2));
  c.check(!!small && small.verts <= rec.verts / 2 && small.verts > 0, "decoded over a smaller cap: oldest tiles dropped", `${small?.verts}`);
  const kv = new Map<string, unknown>();
  const io = { read: (k: string) => kv.get(k), write: (k: string, v: unknown) => void kv.set(k, v) };
  const { key, tag } = saveScanKey({ id: "slot-1", createdAt: 1700, seed: 42 });
  const st = savedScanStore(io, key, tag);
  c.check(key === "scan/slot-1" && tag === "1700:42" && st.persistent && st.open(1e7).verts === 0, "one key per save, tagged with the world; opens empty");
  st.save(rec);
  c.check(fingerprint(savedScanStore(io, key, tag).open(1e7)) === fingerprint(rec), "saved → reopened (next session): the same (stale) record");
  c.check(savedScanStore(io, key, "1800:42").open(1e7).verts === 0, "a new world in the slot never inherits the old scans");
  kv.set(key, { v: 1, tag, bytes: new Uint8Array([1, 2, 3]) });
  c.check(savedScanStore(io, key, tag).open(1e7).verts === 0, "garbage in the store → empty record, no throw");
  resetSessionScans();
  const a = sessionScanStore(5).open(SCAN_TUNING.cap.phone);
  pingAll(a, diver, 30, world(A));
  c.check(!sessionScanStore(5).persistent && sessionScanStore(5).open(SCAN_TUNING.cap.phone) === a, "free dive: the same seed again this session keeps its record");
  c.check(sessionScanStore(6).open(SCAN_TUNING.cap.phone).verts === 0 && sessionScanStore(5).open(SCAN_TUNING.cap.phone).verts === 0, "another seed replaces it (one record in memory)");
}

c.section("scan sources from the column meshes");
{
  const g = new THREE.Group();
  const mesh = (surface?: number, fadeDir?: number, visible = true) => {
    const b = new THREE.BufferGeometry();
    b.setAttribute("position", new THREE.BufferAttribute(new Float32Array(30), 3));
    b.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(30), 3));
    b.setIndex([0, 1, 2]);
    b.computeBoundingBox();
    if (surface !== undefined) b.userData.surfaceVerts = surface;
    const m = new THREE.Mesh(b);
    if (fadeDir !== undefined) m.userData.fadeDir = fadeDir;
    m.visible = visible;
    return m;
  };
  g.add(mesh(6), mesh(6, 1), mesh(6, -1), mesh(6, undefined, false), mesh(), new THREE.Object3D());
  const s = sourcesOf(g);
  c.check(s.length === 2 && s.every((q) => q.surface === 6 && q.index?.length === 3), "drawn column meshes with their index; not hidden ones, not ones dissolving away, not untagged", `${s.length}`);
}
c.finish();
