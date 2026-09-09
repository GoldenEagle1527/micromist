import { registerGameAdapter } from "../../multiplayer/registry";
import { createExplosiveChessAdapter } from "./adapter";

registerGameAdapter("explosive-chess", createExplosiveChessAdapter);
