/**
 * Fixed top-2 layer selection for the seabed material shader (materialShader.ts),
 * in registers: no local arrays, no loops (Mali keeps dynamically indexed local
 * arrays in memory: the 14-entry merge list of 78b0952 cost 416 B of stack per
 * pixel and made the shader load/store bound).
 *
 * For a fixed candidate list of (id, weight) — the layers of one surface group
 * (floor, or wall + ceiling), or the 4 palettes of a region pair:
 *  1. duplicates merged exactly: later candidates of the same id add into the
 *     first one (pairwise, unrolled);
 *  2. the two heaviest kept, the third heaviest's weight subtracted from both, so an
 *     id enters / leaves the pair at weight 0 (no pop when ranks 2 and 3 swap);
 *  3. the pair rescaled to the group's total weight (the floor / wall balance of the
 *     projection stays exactly as before).
 * With at most two distinct ids this is exact. Where three or more overlap the
 * lightest is dropped continuously; only at the exact point where the top three are
 * equal is the pair ratio undefined (top-2 of three equal weights has no continuous
 * answer): there the pair turns quickly around a point, a speck in practice.
 *
 * `topTwoDecl` / `topTwoGlsl` emit the GLSL (needs dmTop3 from MAT_DECLS);
 * `topTwoJS` mirrors it for the unit test (scripts/deep-march-materials-test.ts).
 */

export type LayerCandidate = { layer: string; weight: string };

/** Below this pair sum the whole group weight goes to the heaviest layer. */
export const PAIR_EPS = 1e-4;

/** Running top-3 insert (GLSL, part of MAT_DECLS). */
export const TOP3_GLSL = /* glsl */ `
void dmTop3(int L, DM_M float w, inout int La, inout DM_M float Wa, inout int Lb, inout DM_M float Wb, inout DM_M float Wc) {
  if (w > Wa) { Wc = Wb; Lb = La; Wb = Wa; La = L; Wa = w; }
  else if (w > Wb) { Wc = Wb; Lb = L; Wb = w; }
  else Wc = max(Wc, w);
}
`;

/** GLSL declaring a group's kept pair: `int <p>La, <p>Lb` and `DM_M float <p>Wa, <p>Wb`. */
export function topTwoDecl(p: string): string {
  return `  int ${p}La = 0, ${p}Lb = 0;\n  DM_M float ${p}Wa = 0.0, ${p}Wb = 0.0;\n`;
}

/**
 * GLSL block that sets a group's kept pair (declared by topTwoDecl) from `cands`.
 * `distinct`: candidate pairs known to hold different layers (no merge test).
 */
export function topTwoGlsl(
  p: string,
  cands: readonly LayerCandidate[],
  distinct: readonly [number, number][] = [],
  names: { La: string; Wa: string; Lb: string; Wb: string } = { La: `${p}La`, Wa: `${p}Wa`, Lb: `${p}Lb`, Wb: `${p}Wb` },
): string {
  const n = cands.length;
  const { La, Wa, Lb, Wb } = names;
  const skip = new Set(distinct.map(([i, j]) => `${Math.min(i, j)}:${Math.max(i, j)}`));
  const out: string[] = ["  {"];
  out.push(`    int ${cands.map((c, i) => `l${i} = ${c.layer}`).join(", ")};`);
  out.push(`    DM_M float ${cands.map((c, i) => `w${i} = ${c.weight}`).join(", ")};`);
  out.push(`    DM_M float T = ${cands.map((_, i) => `w${i}`).join(" + ")};`);
  for (let j = 1; j < n; j++) {
    for (let i = 0; i < j; i++) if (!skip.has(`${i}:${j}`)) out.push(`    if (l${j} == l${i}) { w${i} += w${j}; w${j} = 0.0; }`);
  }
  out.push(`    DM_M float Wc = 0.0;`);
  out.push(`    ${La} = l0; ${Lb} = l0; ${Wa} = 0.0; ${Wb} = 0.0;`);
  for (let i = 0; i < n; i++) out.push(`    dmTop3(l${i}, w${i}, ${La}, ${Wa}, ${Lb}, ${Wb}, Wc);`);
  out.push(`    ${Wa} -= Wc; ${Wb} -= Wc;`);
  out.push(`    DM_M float s = ${Wa} + ${Wb};`);
  out.push(`    if (s > ${PAIR_EPS.toExponential()}) { ${Wa} *= T / s; ${Wb} *= T / s; } else { ${Wa} = T; ${Wb} = 0.0; }`);
  out.push("  }");
  return out.join("\n") + "\n";
}

/**
 * JS mirror of topTwoGlsl: the kept (layer, weight) pair. `stats.gain` (if given)
 * records the largest rescale T / s seen: high near the degenerate point where the
 * top three weights are equal.
 */
export function topTwoJS(cands: readonly [number, number][], stats?: { gain: number }): [number, number][] {
  const l = cands.map((c) => c[0]);
  const w = cands.map((c) => c[1]);
  const T = w.reduce((a, b) => a + b, 0);
  for (let j = 1; j < l.length; j++) {
    for (let i = 0; i < j; i++) {
      if (l[j] === l[i]) {
        w[i] += w[j];
        w[j] = 0;
      }
    }
  }
  let La = l[0], Lb = l[0], Wa = 0, Wb = 0, Wc = 0;
  for (let i = 0; i < l.length; i++) {
    if (w[i] > Wa) {
      Wc = Wb; Lb = La; Wb = Wa; La = l[i]; Wa = w[i];
    } else if (w[i] > Wb) {
      Wc = Wb; Lb = l[i]; Wb = w[i];
    } else Wc = Math.max(Wc, w[i]);
  }
  Wa -= Wc;
  Wb -= Wc;
  const s = Wa + Wb;
  if (stats && T > 0) stats.gain = Math.max(stats.gain, s > 0 ? T / s : Infinity);
  if (s > PAIR_EPS) return [[La, (Wa * T) / s], [Lb, (Wb * T) / s]];
  return [[La, T], [Lb, 0]];
}
