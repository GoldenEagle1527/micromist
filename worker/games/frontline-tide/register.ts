import { registerGameAdapter } from "../../multiplayer/registry";
import { createFrontlineTideAdapter } from "./adapter";

registerGameAdapter("frontline-tide", createFrontlineTideAdapter);
