/** Tiny PASS/FAIL reporter shared by the deep-march node tests added with the conserve mode. */
export type Checker = {
  section: (title: string) => void;
  check: (ok: boolean, name: string, detail?: string) => void;
  /** Exit code 1 if any check failed (call last). */
  finish: () => void;
};

export function createChecker(): Checker {
  let failed = 0;
  let passed = 0;
  return {
    section(title) {
      console.log(title);
    },
    check(ok, name, detail) {
      if (ok) passed++;
      else failed++;
      console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
    },
    finish() {
      console.log(`${passed} passed, ${failed} failed`);
      if (failed) process.exit(1);
    },
  };
}
