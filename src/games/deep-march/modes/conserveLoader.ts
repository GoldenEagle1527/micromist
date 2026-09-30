/**
 * The only door from the shared game code into conserve/: a dynamic import, so
 * the conserve modules form their own chunk and the free dive never loads them
 * (test:modes checks the bundle). Type-only imports are erased at build time.
 */
export type ConserveModule = typeof import("../conserve");

let pending: Promise<ConserveModule> | null = null;

export function loadConserve(): Promise<ConserveModule> {
  pending ??= import("../conserve").catch((err: unknown) => {
    pending = null; // allow a retry after a failed chunk download
    throw err;
  });
  return pending;
}
