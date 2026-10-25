/**
 * Explosive-chess agent observation: legal placements match the engine,
 * and the structured board is the same information as fullState.
 * Run: npm run test:explosive-agent
 */
import { COLOR_BLUE, COLOR_RED, WIN_MODE_ANNIHILATION, createGame } from "../shared/explosive-chess/engine";
import {
  buildExplosiveObservation,
  legalMoveActions,
  winnerColorName,
  type ExplosivePublicConfig,
  type ExplosiveYou,
} from "../shared/explosive-chess/observe";
import { createChecker } from "./lib/checks";

const c = createChecker();
const config: ExplosivePublicConfig = {
  boardSize: 9,
  winMode: WIN_MODE_ANNIHILATION,
  winParam: 50,
  hostColor: "red",
};
const redYou: ExplosiveYou = {
  playerId: "red-agent",
  name: "Agent A",
  seat: "red",
  role: "host",
  kind: "agent",
  color: "red",
};

c.section("legal placements");
{
  const game = createGame({ boardSize: 9, winMode: WIN_MODE_ANNIHILATION });
  const opening = legalMoveActions(game, "red", "playing");
  c.check(opening.length === 81, "red can play any cell on an empty 9×9");
  c.check(legalMoveActions(game, "blue", "playing").length === 0, "blue has no action before red moves");
  c.check(legalMoveActions(game, "red", "lobby").length === 0, "lobby lists no placements");
  c.check(opening.every((a) => a.type === "move"), "every action is a move");

  const played = game.makeMove(0, 0, COLOR_RED);
  c.check(played !== null && !played.gameOver, "corner placement is legal");
  const blue = legalMoveActions(game, "blue", "playing");
  c.check(blue.length === 80, "blue cannot place on red's cell", String(blue.length));
  c.check(!blue.some((a) => a.row === 0 && a.col === 0), "occupied corner is absent");
  c.check(legalMoveActions(game, "red", "playing").length === 0, "red waits while blue is to move");

  let brute = 0;
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      if (game.isValidMove(row, col, COLOR_BLUE)) brute++;
    }
  }
  c.check(blue.length === brute, "listed actions match isValidMove");

  game.forceGameOver(COLOR_BLUE, "surrender");
  c.check(legalMoveActions(game, "blue", "playing").length === 0, "game over lists no placements");
}

c.section("observation");
{
  const game = createGame({ boardSize: 9, winMode: WIN_MODE_ANNIHILATION });
  game.makeMove(0, 0, COLOR_RED);
  const obs = buildExplosiveObservation({
    phase: "playing",
    you: { ...redYou, seat: "blue", role: "guest", color: "blue" },
    config,
    game,
  });
  c.check(obs.game === "explosive-chess", "game slug");
  c.check(obs.publicState.turn === "blue", "turn string");
  c.check(obs.publicState.fullState?.currentTurn === COLOR_BLUE, "fullState turn number");
  c.check(obs.publicState.fullState?.colors[0] === COLOR_RED, "flat colors match the corner");
  c.check(obs.publicState.fullState?.counts[0] === 1, "flat counts match the corner");
  c.check(obs.publicState.board.length === 9 && obs.publicState.board[0]?.length === 9, "9×9 grid");
  c.check(obs.publicState.board[0]?.[0]?.color === "red", "corner color name");
  c.check(obs.publicState.board[0]?.[0]?.capacity === 2, "corner capacity");
  c.check(obs.publicState.board[0]?.[1]?.capacity === 3, "edge capacity");
  c.check(obs.publicState.board[4]?.[4]?.capacity === 4, "center capacity");
  c.check(obs.legalActions.length === 80, "blue observation lists 80 moves");

  const lobby = buildExplosiveObservation({
    phase: "lobby",
    you: redYou,
    config,
    game: null,
  });
  c.check(lobby.publicState.fullState === null && lobby.publicState.board.length === 0, "no board before start");
  c.check(lobby.legalActions.length === 0, "no actions before start");
  c.check(winnerColorName(COLOR_RED) === "red" && winnerColorName("draw") === "draw", "winner color names");
  c.check(winnerColorName(null) === null, "missing winner");
}

c.finish();
