/** Fired-piece shelf for Pottery — IndexedDB via game-store. */

import { gameStoreGet, gameStoreSet } from "../../lib/game-store";
import {
  isValidProfile,
  normalizeClaySize,
  type Piece,
} from "./engine";

export const POTTERY_SLUG = "pottery";
export const COLLECTION_KEY = "collection";
export const MAX_PIECES = 50;

function parsePiece(raw: unknown): Piece | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id.length === 0) return null;
  if (typeof o.name !== "string") return null;
  if (typeof o.firedAt !== "number" || !Number.isFinite(o.firedAt)) return null;
  const claySize = normalizeClaySize(o.claySize);
  if (claySize == null) return null;
  if (o.version !== 1) return null;
  if (!isValidProfile(o.profile)) return null;
  const piece: Piece = {
    id: o.id,
    name: o.name,
    firedAt: o.firedAt,
    claySize,
    version: 1,
    profile: o.profile.slice(),
  };
  if (typeof o.thumbDataUrl === "string" && o.thumbDataUrl.startsWith("data:")) {
    piece.thumbDataUrl = o.thumbDataUrl;
  }
  return piece;
}

function coerceCollection(raw: unknown): Piece[] {
  if (!Array.isArray(raw)) return [];
  const out: Piece[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const piece = parsePiece(item);
    if (!piece || seen.has(piece.id)) continue;
    seen.add(piece.id);
    out.push(piece);
    if (out.length >= MAX_PIECES) break;
  }
  return out;
}

export function loadCollection(): Piece[] {
  try {
    return coerceCollection(gameStoreGet(POTTERY_SLUG, COLLECTION_KEY));
  } catch {
    return [];
  }
}

function writeCollection(pieces: Piece[]): Piece[] {
  const next = pieces.slice(0, MAX_PIECES);
  gameStoreSet(POTTERY_SLUG, COLLECTION_KEY, next);
  return next;
}

/** Newest first. Caps at MAX_PIECES. */
export function savePiece(piece: Piece): Piece[] {
  const prev = loadCollection().filter((p) => p.id !== piece.id);
  return writeCollection([piece, ...prev]);
}

export function deletePiece(id: string): Piece[] {
  return writeCollection(loadCollection().filter((p) => p.id !== id));
}

export function getPiece(id: string): Piece | undefined {
  return loadCollection().find((p) => p.id === id);
}
