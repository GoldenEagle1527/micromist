/** Every debug command, in the panel's order within each section (registry.ts). */
import { DIVE_COMMANDS } from "./diveCommands";
import { LIVE_COMMANDS } from "./liveCommands";
import type { DebugCommand } from "./registry";

export const DEBUG_COMMANDS: readonly DebugCommand[] = [...LIVE_COMMANDS, ...DIVE_COMMANDS];
