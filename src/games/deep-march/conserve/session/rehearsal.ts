/**
 * The 结局演练 sandbox (staging debug panel): the real slot is read once and
 * a stage-5 copy of it (gaze/rehearsalSave.ts) lives in an in-memory backend
 * the dive's session writes to instead — every save of the rehearsal, the
 * annihilated one included, is gone when the dive ends. No slot: an empty
 * sandbox (a new world opens there, in memory too).
 */
import { SAVE } from "../config";
import type { GazePhase } from "../gaze/config";
import { rehearsalSave } from "../gaze/rehearsalSave";
import { createMemoryBackend, type SaveBackend } from "../save/saveBackend";
import { readSlot, slotKey } from "../save/saveRepository";

export function rehearsalBackend(real: SaveBackend, phase: GazePhase, slotId: string = SAVE.slotId): SaveBackend {
  const read = readSlot(real, slotId);
  return createMemoryBackend(read.status === "ok" ? { [slotKey(slotId)]: rehearsalSave(read.save, phase) } : {});
}
