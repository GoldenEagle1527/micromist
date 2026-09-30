/**
 * Largest-remainder allocation (§3.3): split an integer total over weighted slots
 * so the parts are integers summing to the total exactly. Quotas total · w_i / Σw
 * are floored; the leftover units go to the largest fractional parts, ties to the
 * larger tie hash, then the lower index. Zero-weight slots never get anything.
 */

export class AllocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllocationError";
  }
}

export function largestRemainder(total: number, weights: readonly number[], tie: readonly number[]): number[] {
  if (!Number.isSafeInteger(total) || total < 0) throw new AllocationError(`total must be a non-negative integer, got ${total}`);
  const sum = weights.reduce((a, w) => a + (w > 0 ? w : 0), 0);
  const parts = weights.map(() => 0);
  if (total === 0) return parts;
  if (!(sum > 0)) throw new AllocationError("no slot can take particles (all weights are 0)");
  const rem = weights.map(() => -1);
  let given = 0;
  weights.forEach((w, i) => {
    if (!(w > 0)) return;
    const quota = (total * w) / sum;
    parts[i] = Math.floor(quota);
    rem[i] = quota - parts[i];
    given += parts[i];
  });
  const order = weights.map((_, i) => i).filter((i) => rem[i] >= 0);
  order.sort((a, b) => rem[b] - rem[a] || tie[b] - tie[a] || a - b);
  // floating-point quotas can overshoot by a unit: take it back from the smallest remainders
  for (let j = order.length - 1; given > total && j >= 0; j--) {
    if (parts[order[j]] === 0) continue;
    parts[order[j]]--;
    given--;
  }
  for (let j = 0; given < total; j = (j + 1) % order.length) {
    parts[order[j]]++;
    given++;
  }
  return parts;
}
