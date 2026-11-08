/**
 * Durable Object export for wrangler (`class_name: GameRoom`).
 * Register all game adapters here before the class is used.
 */
import "./games/explosive-chess/register";
import "./games/chroma-slide/register";
import "./games/frontline-tide/register";
export { GameRoom } from "./multiplayer/base-room";
