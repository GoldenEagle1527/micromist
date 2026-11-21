import { registerGameAdapter } from "../../multiplayer/registry";
import { createGomokuAdapter } from "./adapter";

registerGameAdapter("gomoku", createGomokuAdapter);
