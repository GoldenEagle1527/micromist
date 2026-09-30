/**
 * Conserve mode — the tide (plan M7; conserve/tide/, design doc §5.5, §5.6):
 *   - timeline, state machine (save order, extension, every murk trigger,
 *     context loss), frame-time governor, dome rules;
 *   - through the session: plan = forecast, lock, ledger across the tide,
 *     save order and cold starts, particle-ization, determinism;
 *   - the frozen 3 × 3's terrain bit-exact across a real tide;
 *   - the double-buffered terrain: requests, release, draws / triangles / memory.
 * Run: npm run test:tide
 */
import { createChecker } from "./lib/checks";
import { tideMachineChecks } from "./lib/tideMachineChecks";
import { tideSessionChecks } from "./lib/tideSessionChecks";
import { tideStreamingChecks } from "./lib/tideStreamingChecks";
import { tideTerrainChecks } from "./lib/tideTerrainChecks";

const c = createChecker();
tideMachineChecks(c);
tideSessionChecks(c);
tideTerrainChecks(c);
tideStreamingChecks(c);
c.finish();
