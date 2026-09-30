/**
 * test:placement — building ground (terrain/groundProbe.ts): every rule both
 * ways on synthetic fields, then the real terrain: a scan of core footprints
 * whose "ok" / "clearance" / "slope" verdicts are re-checked by independent,
 * finer scans; the share of valid core spots (ground + frozen-zone check).
 */
import { BASE, STRUCTURES } from "../../src/games/deep-march/conserve/config";
import { TERRAIN } from "../../src/games/deep-march/terrain/config";
import { createDensityField } from "../../src/games/deep-march/terrain/density";
import { checkFrozenZone, frozenCellsAt } from "../../src/games/deep-march/terrain/frozenZone";
import { GroundProbe, type GroundSpec } from "../../src/games/deep-march/terrain/groundProbe";
import { PLACEMENT } from "../../src/games/deep-march/scene/base/config";
import type { Checker } from "./checks";
import { fakeField } from "./groundFixture";
import { genesisLayout } from "./worldFixture";

const CORE: GroundSpec = { radius: STRUCTURES.core.radius, height: STRUCTURES.core.height, slopeMax: PLACEMENT.slopeMaxCore };
const TOWER: GroundSpec = { radius: STRUCTURES.lighthouse.radius, height: STRUCTURES.lighthouse.height, slopeMax: PLACEMENT.slopeMaxOther };
const STORE: GroundSpec = { radius: STRUCTURES.storage.radius, height: STRUCTURES.storage.height, slopeMax: PLACEMENT.slopeMaxOther };

function synthetic(c: Checker): void {
  c.section("ground rules (synthetic fields)");
  const flat = new GroundProbe(fakeField({}));
  const hit = flat.pick({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 });
  c.check(!!hit && Math.abs(hit.y) < 0.01, "aim ray down onto a flat floor hits it", hit ? hit.y.toFixed(4) : "none");
  c.check(flat.pick({ x: 0, y: 10, z: 0 }, { x: 0, y: 1, z: 0 }) === null, "aim ray into open water → nothing (no-ground)");
  const ok = flat.footprint(0, 0, 0, CORE);
  c.check(ok.reason === "ok" && Math.abs(ok.y) < 0.01 && ok.slopeDeg < 0.01, "flat floor → ok, y = floor");
  c.check(new GroundProbe(fakeField({ ceiling: -2 })).footprint(0, 0, 0, CORE).reason === "no-ground", "point inside rock (no water above) → no-ground");
  const s20 = new GroundProbe(fakeField({ slopeDeg: 20 }));
  const r20 = s20.footprint(0, 0, 0, CORE);
  c.check(r20.reason === "ok" && Math.abs(r20.slopeDeg - 20) < 0.5, "core on 20° → ok (limit 22°)", `${r20.slopeDeg.toFixed(2)}°`);
  c.check(new GroundProbe(fakeField({ slopeDeg: 24 })).footprint(0, 0, 0, CORE).reason === "slope", "core on 24° → slope");
  c.check(s20.footprint(0, 0, 0, TOWER).reason === "slope" && new GroundProbe(fakeField({ slopeDeg: 13 })).footprint(0, 0, 0, TOWER).reason === "ok", "lighthouse: 20° → slope, 13° → ok (limit 15°)");
  const bump = new GroundProbe(fakeField({ bumps: [{ x: 10, z: 0, half: 1.5, h: 4 }] }));
  c.check(bump.footprint(0, 0, 0, CORE).reason === "rough" && new GroundProbe(fakeField({ bumps: [{ x: 10, z: 0, half: 1.5, h: 0.8 }] })).footprint(0, 0, 0, CORE).reason === "ok", "a 4 m boulder under the rim → rough; 0.8 m → ok");
  c.check(new GroundProbe(fakeField({ pit: { r: 3, depth: 8 } })).footprint(0.01, 0, 0.01, STORE).reason !== "ok", "a pit deeper than the skirt under the centre → refused");
  const cave = new GroundProbe(fakeField({ ceiling: 20 }));
  c.check(cave.footprint(0, 0, 0, TOWER).reason === "clearance" && cave.footprint(0, 0, 0, STORE).reason === "ok", "20 m ceiling: 46 m lighthouse → clearance; 13 m storage → ok");
  c.check(new GroundProbe(fakeField({ dominant: 0.55 })).footprint(0, 0, 0, CORE).reason === "blend" && new GroundProbe(fakeField({ dominant: 0.65 })).footprint(0, 0, 0, CORE).reason === "ok", "region weight 0.55 → blend; 0.65 → ok");
}

function realTerrain(c: Checker): void {
  c.section("ground on the real terrain (seed 42)");
  const layout = genesisLayout(42);
  const field = createDensityField(42, TERRAIN, undefined, layout);
  const probe = new GroundProbe(field);
  const iso = field.settings.isoLevel;
  const counts: Record<string, number> = {};
  let agree = 0, checked = 0, frozenOk = 0, valid = 0;
  const t0 = Date.now();
  let calls = 0;
  for (let x = -1400; x <= 1400; x += 200) {
    for (let z = -1400; z <= 1400; z += 200) {
      const hit = probe.pick({ x, y: 60, z }, { x: 0, y: -1, z: 0 }, 260);
      if (!hit) continue;
      const r = probe.footprint(hit.x, hit.y, hit.z, CORE);
      calls++;
      counts[r.reason] = (counts[r.reason] ?? 0) + 1;
      if (r.reason === "ok" || r.reason === "clearance") {
        // independent: the same 5 columns at 0.5 m (the probe steps 2 m)
        const d = CORE.radius * 0.7, lift = CORE.radius * Math.tan((CORE.slopeMax * Math.PI) / 180) + 1;
        let rock = false;
        for (const [dx, dz] of [[0, 0], [d, 0], [-d, 0], [0, d], [0, -d]]) {
          for (let h = dx || dz ? lift : 1; h <= CORE.height && !rock; h += 0.5) rock = field.sample(r.x + dx, r.y + h, r.z + dz) >= iso;
        }
        checked++;
        if ((r.reason === "ok") === !rock) agree++;
      }
      if (r.reason === "ok") {
        const fr = frozenCellsAt(field.regions, r.x, r.z, TERRAIN.worldScale);
        if (checkFrozenZone(field.regions, { x: r.x, z: r.z, radius: BASE.radiusMax, frozen: fr, worldScale: TERRAIN.worldScale }).ok) frozenOk++;
        valid++;
      }
    }
  }
  const ms = (Date.now() - t0) / Math.max(1, calls);
  c.check(checked > 0 && agree === checked, "ok / clearance verdicts agree with a finer independent column scan", `${agree}/${checked}`);
  c.check((counts.ok ?? 0) > 0 && Object.keys(counts).length >= 3, "the scan meets several verdicts, ok among them", JSON.stringify(counts));
  c.check(frozenOk > 0, "some ground-ok spots also pass the frozen-zone check (valid core spots)", `${frozenOk}/${valid}`);
  c.check(ms < 40, "one footprint check is cheap enough to run a few times a second", `${ms.toFixed(1)} ms per pick + footprint (node)`);
}

export function groundChecks(c: Checker): void {
  synthetic(c);
  realTerrain(c);
}
