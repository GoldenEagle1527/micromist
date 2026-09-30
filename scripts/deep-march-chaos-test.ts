/**
 * Conserve mode — chaos core (plan M6, design doc §4.1–4.3):
 *   - model: the ring outline matches the terrain's; M counts W, S, L (not P, B);
 *     base fuel raises the next m; stage / thickness monotone in m; χ_g; stage 5;
 *   - cracks: size and through flag; spots deterministic, ≥ 600 m from the base,
 *     ≥ 500 m apart, biased to the harvested wall and the base; open / heal with
 *     the +0.01 hysteresis, scars, reopening in place; fixed across tides;
 *   - the forecast equals the tide bit for bit; a generation's chaos is fixed and
 *     forecasting moves no particle; save v5; SiteLayout.wall crack data; a
 *     through crack's notch passes the outer face.
 * Run: npm run test:chaos
 */
import { createChecker } from "./lib/checks";
import { chaosModelChecks } from "./lib/chaosModelChecks";
import { chaosCrackChecks } from "./lib/chaosCrackChecks";
import { chaosTideChecks } from "./lib/chaosTideChecks";

const c = createChecker();
chaosModelChecks(c);
chaosCrackChecks(c);
chaosTideChecks(c);
c.finish();
