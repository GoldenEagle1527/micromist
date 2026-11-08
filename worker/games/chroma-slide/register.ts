import { registerGameAdapter } from "../../multiplayer/registry";
import { createChromaSlideAdapter } from "./adapter";

registerGameAdapter("chroma-slide", createChromaSlideAdapter);
