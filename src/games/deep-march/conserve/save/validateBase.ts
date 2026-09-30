/**
 * Shape check of a save's base (v4). Counts only need the right shape: the
 * storage is fitted to pool B by reconcileBase.ts.
 */
import { BASE } from "../config";
import { isStructureKind } from "../base/baseState";
import { isCountVector, isNumberVector } from "../particles/particleVector";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isFinite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isIndex = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isVec3 = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(isFinite);
const unit = (v: unknown) => isFinite(v) && v >= 0 && v < 1;
/** More than this is not a save this game wrote (it keeps BASE.maxStructures). */
const MAX_STORED = 256;

function frozenOk(v: unknown): boolean {
  return Array.isArray(v) && v.length <= 49 && v.every((f) => isRecord(f) && isIndex(f.i) && unit(f.jx) && unit(f.jz) && isIndex(f.region) && unit(f.hash) && isFinite(f.delta));
}

function structureOk(s: unknown): boolean {
  return isRecord(s) && isIndex(s.id) && s.id >= 1 && isStructureKind(s.kind) && isVec3(s.pos) && isFinite(s.yaw) && typeof s.on === "boolean" && isFinite(s.fuel) && s.fuel >= 0;
}

export function baseProblem(v: unknown): string | null {
  if (v === null) return null;
  if (!isRecord(v)) return "base";
  if (!isIndex(v.foundedGen) || v.foundedGen < 1 || !isVec3(v.center)) return "base.header";
  if (!frozenOk(v.frozen) || !isCountVector(v.frozenLocked)) return "base.frozen";
  const list = v.structures;
  if (!Array.isArray(list) || list.length > Math.max(MAX_STORED, BASE.maxStructures) || !list.every(structureOk)) return "base.structures";
  const ids = new Set(list.map((s) => (s as { id: number }).id));
  if (ids.size !== list.length || list.filter((s) => (s as { kind: string }).kind === "core").length !== 1) return "base.structures";
  if (!isNumberVector(v.storage) || !isFinite(v.energy) || v.energy < 0 || typeof v.brownout !== "boolean") return "base.storage";
  return null;
}
