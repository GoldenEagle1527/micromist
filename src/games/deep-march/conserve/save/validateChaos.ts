/**
 * Shape check of a save's chaos (v5): the generation's m, stage and wall
 * thickness as the tide set them, every crack placed so far (open or scar) and,
 * at stage 5 only, the gaze's sequence (optional field: no version bump).
 */
import { WALL } from "../config";
import { BREACH } from "../chaos/config";
import { isGazeState } from "../gaze/model";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isFinite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isInt = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isSafeInteger(v) && v >= lo && v <= hi;
const nonNegative = (v: unknown) => isFinite(v) && v >= 0;

function crackOk(c: unknown): boolean {
  if (!isRecord(c)) return false;
  const shape = isInt(c.j, 0, BREACH.j) && nonNegative(c.s) && isFinite(c.mOpen) && isInt(c.bornGen, 1, Number.MAX_SAFE_INTEGER) && nonNegative(c.width) && nonNegative(c.depth);
  return shape && isBool(c.open) && isBool(c.healed) && isBool(c.through) && !(c.open && c.healed) && (c.open || !c.through);
}

export function chaosProblem(v: unknown): string | null {
  if (!isRecord(v)) return "chaos";
  if (!isFinite(v.m) || v.m < 0 || v.m > 1) return "chaos.m";
  if (!isInt(v.stage, 0, 5)) return "chaos.stage";
  if (!isFinite(v.wallThickness) || v.wallThickness < WALL.minThickness - 1e-9 || v.wallThickness > WALL.fullThickness + 1e-9) return "chaos.wallThickness";
  if (v.gaze !== undefined && (v.stage !== 5 || !isGazeState(v.gaze))) return "chaos.gaze";
  const cracks = v.cracks;
  if (!Array.isArray(cracks) || cracks.length > BREACH.j + 1) return "chaos.cracks";
  const bad = cracks.findIndex((c, i) => !crackOk(c) || cracks.findIndex((d) => isRecord(d) && d.j === (c as { j: unknown }).j) !== i);
  return bad >= 0 ? `chaos.cracks[${bad}]` : null;
}
