/** Text of registry labels (pure): option labels and teleport targets in the panel's language. */
import type { DebugDict } from "./i18n";
import type { OptionLabel } from "./registry";
import type { TeleportTarget } from "./types";

export function optionText(d: DebugDict, l: OptionLabel): string {
  return typeof l === "string" ? d.opt[l] : l.text;
}

export function targetText(d: DebugDict, t: TeleportTarget): string {
  if (t.kind === "crack") return d.target.crack(t.key);
  if (t.kind === "edge") return d.target.edge[t.key as keyof DebugDict["target"]["edge"]] ?? t.key;
  if (t.kind === "corner") return d.target.corner[t.key as keyof DebugDict["target"]["corner"]] ?? t.key;
  return t.kind === "base" ? d.target.base : d.target.spawn;
}
