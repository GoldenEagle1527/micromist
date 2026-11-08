/**
 * Frontline Tide agent surface: legalActions, night resolve, guide path.
 * Run: npm run test:frontline-agent
 */
import { readFileSync } from "node:fs";
import { applyAction } from "../shared/frontline-tide/actions";
import { matchFrontlineGuidePath } from "../shared/frontline-tide/agent-guide";
import { createGame, enterBuild } from "../shared/frontline-tide/engine";
import { legalActionsFor } from "../shared/frontline-tide/observe";
import { createChecker } from "./lib/checks";

const c = createChecker();

c.section("legal actions");
{
  const game = createGame(7);
  const actions = legalActionsFor(game, "player", "playing");
  c.check(actions.some((action) => action.type === "swap"), "day offers swaps");
  c.check(actions.some((action) => action.type === "end_phase"), "day can end early");
  c.check(legalActionsFor(game, "spectator", "playing").length === 0, "spectators have no actions");
  const swap = actions.find((action) => action.type === "swap");
  c.check(Boolean(swap), "a swap exists");
  if (swap && swap.type === "swap") {
    const applied = applyAction(game, swap);
    c.check(applied.ok && applied.state.swapsLeft === game.swapsLeft - 1, "a legal swap spends one");
    c.check(applied.ok && applied.effects.some((effect) => effect.type === "clear"), "swap effects list the clear");
  }
  const built = applyAction(enterBuild({ ...game, points: 9 }), { type: "place", row: 3, col: 2 });
  c.check(built.ok && built.state.points === 6, "place spends points");
  const night = applyAction(built.ok ? built.state : game, { type: "end_phase" });
  c.check(night.ok, "ending the build resolves the night");
  if (night.ok) {
    c.check(night.state.phase === "day_match" || night.state.phase === "gameover", "night does not stick", night.state.phase);
    c.check(night.effects.some((effect) => effect.type === "night"), "night effect is attached");
    if (night.state.phase === "day_match") c.check(night.state.day === game.day + 1, "the next turn is the next day");
  }
}

c.section("guide");
{
  c.check(matchFrontlineGuidePath("/agent-guide/frontline-tide") === "page", "guide page");
  c.check(matchFrontlineGuidePath("/agent-guide/frontline-tide/zh") === "page", "zh guide");
  c.check(matchFrontlineGuidePath("/agent-guide/frontline-tide/en.md") === "markdown", "en markdown");
  c.check(matchFrontlineGuidePath("/agent-guide/chroma-slide") === null, "other guides are left alone");
  const node = readFileSync("public/agent-clients/frontline-tide/server.mjs", "utf8");
  const py = readFileSync("public/agent-clients/frontline-tide/server.py", "utf8");
  c.check(node.includes("127.0.0.1") && node.includes("legalActions"), "node client is local curl");
  c.check(!node.includes("solver") || node.includes("no solver") || node.includes("No solver"), "node client is not a solver");
  c.check(py.includes("127.0.0.1") && py.includes("legalActions"), "python client is local curl");
  c.check(node.includes('game: "frontline-tide"') || node.includes("frontline-tide"), "node client names the game");
}

c.finish();
