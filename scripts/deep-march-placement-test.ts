/**
 * Conserve mode — base placement (plan M5):
 *   - 2D rules (conserve/base/placementRules.ts), a positive and a negative case
 *     each: core first / only one, wall clearance 600 m, protection radius,
 *     power grid 60 m (core or energy tower), overlap, 40 buildings, cost;
 *   - ground (terrain/groundProbe.ts) on synthetic fields, each rule both ways:
 *     aim ray, slope (22° core, 15° others), roughness, skirt depth, clearance,
 *     biome blend; then on the real terrain: reasons agree with independent scans;
 *   - energy (conserve/base/energy.ts): core output, lighthouse drain and fuel,
 *     brown-out order and restart hysteresis, capacity, tide stub;
 *   - the base's draw calls and triangles (lib/structureDrawChecks.ts).
 * Run: npm run test:placement
 */
import { createChecker } from "./lib/checks";
import { rulesChecks } from "./lib/placementRuleChecks";
import { groundChecks } from "./lib/groundChecks";
import { energyChecks } from "./lib/baseEnergyChecks";
import { drawChecks } from "./lib/structureDrawChecks";

const c = createChecker();
rulesChecks(c);
groundChecks(c);
energyChecks(c);
drawChecks(c);
c.finish();
