/**
 * Palette / layer selection of the multi-material seabed (materialShader.ts):
 * fixed top-2 selections in registers (materialSelect.ts) — where 3-4 palettes
 * overlap the two heaviest palettes, then per surface group (floor; wall +
 * ceiling) the two heaviest layers of those palettes, duplicates merged; one
 * palette at full weight takes a short path with the identical result. SELECT is
 * the GLSL, selectLayersJS its JS mirror (test:materials).
 */
import { paletteOf } from "./materialCatalog";
import { topTwoDecl, topTwoGlsl, topTwoJS, type LayerCandidate } from "./materialSelect";

// Candidates per surface group: palettes x the group's slots (uPal xyzw = floor A,
// floor B, wall A, wall B; uPalC.x = ceiling).
const FLOOR_SLOTS: readonly [string, string][] = [[".x", "slotW0"], [".y", "slotW1"]];
const WALL_SLOTS: readonly [string, string][] = [[".z", "slotW2"], [".w", "slotW3"], ["C.x", "slotW4"]];
const cands = (pals: readonly (readonly [string, string])[], slots: readonly [string, string][]): LayerCandidate[] =>
  pals.flatMap(([P, pw]) => slots.map(([comp, sw]) => ({ layer: `dmLayer(${P}${comp})`, weight: pw ? `${pw} * ${sw}` : sw })));
// floor A != floor B within a palette (materialCatalog, test:materials)
const floorDistinct = (pals: number): [number, number][] => Array.from({ length: pals }, (_, i) => [2 * i, 2 * i + 1]);
// one palette at full weight (most pixels): 3 wall candidates
const ONE = [["P1", ""]] as const;
// otherwise the two heaviest palettes (materialSelect.ts on the 4 palette weights)
const TWO = [["P1", "u1"], ["P2", "u2"]] as const;
export const SELECT = /* glsl */ `${topTwoDecl("dmF")}${topTwoDecl("dmK")}
  bool oneA = palMix <= 0.0 && (vA <= 0.0 || vA >= 1.0);
  bool oneB = palMix >= 1.0 && (vB <= 0.0 || vB >= 1.0);
  if (oneA || oneB) {
    int p1 = oneA ? 2 * regA + (vA > 0.5 ? 1 : 0) : 2 * regB + (vB > 0.5 ? 1 : 0);
    vec4 P1 = uPal[p1], P1C = uPalC[p1];
    dmFLa = dmLayer(P1.x); dmFWa = slotW0; dmFLb = dmLayer(P1.y); dmFWb = slotW1;
${topTwoGlsl("dmK", cands(ONE, WALL_SLOTS))}  } else {
    // palettes: region A main / alt, region B main / alt
    int p1 = 0, p2 = 0;
    DM_M float u1 = 0.0, u2 = 0.0;
${topTwoGlsl("dmP", [
  { layer: "2 * regA", weight: "(1.0 - palMix) * (1.0 - vA)" },
  { layer: "2 * regA + 1", weight: "(1.0 - palMix) * vA" },
  { layer: "2 * regB", weight: "palMix * (1.0 - vB)" },
  { layer: "2 * regB + 1", weight: "palMix * vB" },
], [[0, 1], [2, 3]], { La: "p1", Wa: "u1", Lb: "p2", Wb: "u2" })}    vec4 P1 = uPal[p1], P1C = uPalC[p1], P2 = uPal[p2], P2C = uPalC[p2];
${topTwoGlsl("dmF", cands(TWO, FLOOR_SLOTS), floorDistinct(2))}${topTwoGlsl("dmK", cands(TWO, WALL_SLOTS))}  }
`;

/** Kept layers of one surface group: [layer, weight] x 2. */
export type LayerPair = [number, number][];

/**
 * JS mirror of SELECT (test:materials): the floor and wall / ceiling pairs for the
 * region pair (regA, regB), palette blend palMix, alt shares vA / vB and the slot
 * weights slotW0..4.
 */
export function selectLayersJS(
  regA: number,
  regB: number,
  palMix: number,
  vA: number,
  vB: number,
  slotW: readonly number[],
  stats?: { gain: number },
): { floor: LayerPair; wall: LayerPair } {
  const wallOf = (pals: [number, number][]) => topTwoJS(pals.flatMap(([p, u]) => paletteOf(p).slice(2).map((l, i): [number, number] => [l, u * slotW[2 + i]])), stats);
  const oneA = palMix <= 0 && (vA <= 0 || vA >= 1);
  const oneB = palMix >= 1 && (vB <= 0 || vB >= 1);
  if (oneA || oneB) {
    const p1 = oneA ? 2 * regA + (vA > 0.5 ? 1 : 0) : 2 * regB + (vB > 0.5 ? 1 : 0);
    const P = paletteOf(p1);
    return { floor: [[P[0], slotW[0]], [P[1], slotW[1]]], wall: wallOf([[p1, 1]]) };
  }
  const pals = topTwoJS([
    [2 * regA, (1 - palMix) * (1 - vA)],
    [2 * regA + 1, (1 - palMix) * vA],
    [2 * regB, palMix * (1 - vB)],
    [2 * regB + 1, palMix * vB],
  ], stats);
  const floor = topTwoJS(pals.flatMap(([p, u]) => paletteOf(p).slice(0, 2).map((l, i): [number, number] => [l, u * slotW[i]])), stats);
  return { floor, wall: wallOf(pals) };
}
