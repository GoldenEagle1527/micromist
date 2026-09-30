/** What the setup screen shows about the save slot, without opening it for a dive. */
import { SAVE } from "../config";
import type { SaveBackend } from "../save/saveBackend";
import { readSlot } from "../save/saveRepository";
import { isReadOnlySave } from "../save/schema";

export type SlotSummary =
  | { state: "empty" }
  | { state: "unreadable"; reason: string }
  | { state: "ended"; seedText: string; gen: number }
  | { state: "ready"; seedText: string; gen: number; divesStarted: number; savedAt: number };

export function peekWorldSlot(backend: SaveBackend, slotId: string = SAVE.slotId): SlotSummary {
  const read = readSlot(backend, slotId);
  if (read.status !== "ok") return read.status === "empty" ? { state: "empty" } : { state: "unreadable", reason: read.reason };
  const { save } = read;
  if (isReadOnlySave(save)) return { state: "ended", seedText: save.seedText, gen: save.gen };
  return { state: "ready", seedText: save.seedText, gen: save.gen, divesStarted: save.stats.divesStarted, savedAt: save.savedAt };
}
