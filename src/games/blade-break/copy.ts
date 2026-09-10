import type { BladeDict } from "./i18n";
import type { CardId, PassiveId } from "./types";

export type BladeCopy = BladeDict;

export function cardTitle(id: CardId, t: BladeCopy): string {
  return t.cards[id]?.name ?? id;
}

export function cardDesc(id: CardId, t: BladeCopy): string {
  return t.cards[id]?.desc ?? "";
}

export function passiveTitle(id: PassiveId, t: BladeCopy): string {
  return t.passives[id]?.name ?? id;
}

export function passiveDesc(id: PassiveId, t: BladeCopy): string {
  return t.passives[id]?.desc ?? "";
}

export function enemyName(id: string, t: BladeCopy): string {
  return t.enemies[id as keyof typeof t.enemies] ?? id;
}
