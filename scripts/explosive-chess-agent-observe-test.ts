/**
 * Explosive-chess agent observation: legal placements match the engine,
 * and the structured board is the same information as fullState.
 * Run: npm run test:explosive-agent
 */
import { COLOR_BLUE, COLOR_RED, WIN_MODE_ANNIHILATION, createGame } from "../shared/explosive-chess/engine";
import {
  buildExplosiveObservation,
  effectsFromAnimationFrames,
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
  c.check(lobby.effects.length === 0, "no explosions before start");
}

c.section("corner explosion");
{
  const game = createGame({ boardSize: 9, winMode: WIN_MODE_ANNIHILATION });
  const opened = game.makeMove(0, 0, COLOR_RED);
  c.check(opened !== null && opened.animationFrames.length === 0, "opening placement does not explode");
  const stacked = game.makeMove(8, 0, COLOR_BLUE);
  c.check(stacked !== null && stacked.animationFrames.length === 0, "first corner orb does not explode");
  game.makeMove(0, 1, COLOR_RED);
  const boom = game.makeMove(8, 0, COLOR_BLUE);
  c.check(boom !== null && boom.animationFrames.length === 1, "second orb on the corner explodes");
  const effects = effectsFromAnimationFrames(boom?.animationFrames, 9);
  c.check(effects.length === 1 && effects[0]?.exploded.row === 8 && effects[0]?.exploded.col === 0, "effect names 8,0");
  const spread = effects[0]?.spread ?? [];
  c.check(
    spread.some((cell) => cell.row === 7 && cell.col === 0) && spread.some((cell) => cell.row === 8 && cell.col === 1),
    "orbs spread to 7,0 and 8,1",
  );
  const corner = game.getCell(8, 0);
  c.check(corner.count === 0 && corner.color === COLOR_BLUE, "exploded corner keeps blue at count 0");
  c.check(game.getCell(7, 0).count === 1 && game.getCell(7, 0).color === COLOR_BLUE, "7,0 received a blue orb");
  c.check(game.getCell(8, 1).count === 1 && game.getCell(8, 1).color === COLOR_BLUE, "8,1 received a blue orb");

  const obs = buildExplosiveObservation({
    phase: "playing",
    you: redYou,
    config,
    game,
    effects,
  });
  c.check(obs.publicState.turn === "red", "red is to move after the explosion");
  c.check(obs.publicState.board[8]?.[0]?.count === 0 && obs.publicState.board[8]?.[0]?.color === "blue", "board shows the emptied corner");
  c.check(obs.publicState.board[7]?.[0]?.count === 1 && obs.publicState.board[7]?.[0]?.color === "blue", "board shows 7,0");
  c.check(obs.publicState.board[8]?.[1]?.count === 1 && obs.publicState.board[8]?.[1]?.color === "blue", "board shows 8,1");
  c.check(obs.effects[0]?.exploded.row === 8 && obs.effects[0]?.exploded.col === 0, "observation carries the explosion");
  c.check(!obs.legalActions.some((action) => action.row === 8 && action.col === 0), "red cannot place on the still-blue corner");
  c.check(!obs.legalActions.some((action) => action.row === 7 && action.col === 0), "red cannot place on 7,0");
  c.check(!obs.legalActions.some((action) => action.row === 8 && action.col === 1), "red cannot place on 8,1");
  const missed = 81 - obs.legalActions.length;
  c.check(missed === 3, "only the exploded corner and its two neighbors are closed", String(missed));
}

c.finish();
