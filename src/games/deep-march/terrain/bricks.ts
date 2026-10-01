/**
 * Sparse 8³ bricks for the column mesher (mesher.ts, mesh-only jobs).
 *
 * A level-0 column is 35 × 243 × 35 padded lattice points but the surface passes
 * through ~1.4 % of its cells; the dense passes (sample bookkeeping, density
 * assembly, the anchored flood, the marching-cubes scan) touched every point.
 * Here the padded grid is split into 8³ bricks and each pass works per brick:
 *  - resolveCoarse: coarse pre-pass 4 → 2 → 1: step-4 cells whose 8 corner nodes
 *    are all beyond REFINE_MARGIN4 of iso are certain (water / rock) as a whole;
 *    the rest go to step-2 cells (REFINE_MARGIN), the rest stay for exact
 *    evaluation (margins: 2× the largest gap that still missed a sign,
 *    measured by scripts/deep-march-bricks-test.ts);
 *  - resolveNeed: final-point status (certain water / rock / uncertain) with a
 *    sliding window over the raw taps, seeds (uncertain or bordering the opposite
 *    status) only in bricks that are not uniform with uniform face neighbours,
 *    the 2-point dilation only over active bricks (26-neighbourhood of seed
 *    bricks), exact samples only there;
 *  - assemble: density sums only where the mesh can read them (need points);
 *    uniform bricks are filled with their status;
 *  - floodKeep: the anchored flood (26-connectivity) marks whole all-rock bricks
 *    at once and walks points only inside mixed bricks;
 *  - cellMask: marching-cubes cells in bricks whose corners all share a sign are
 *    skipped (same scan order → same vertex order).
 * The output is bit-identical to the dense mesher (bricks off) as long as the
 * margins hold: every value the mesh reads (sign-change corners and their
 * gradient neighbours) is still an exact evaluation, every sign is unchanged.
 */
export { BRICK, KEEP, REFINE_MARGIN4, REMOVED, SOLID, WATER, brickGrid, scratchF32, scratchI32, scratchU8, type BrickGrid, type RawGrid } from "./brickBase";
export { resolveCoarse } from "./brickCoarse";
export { resolveNeed, type NeedResult } from "./brickNeed";
export { assemble, cellMask, floodKeep } from "./brickFlood";
