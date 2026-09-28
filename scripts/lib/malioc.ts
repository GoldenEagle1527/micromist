/**
 * Mali Offline Compiler (malioc) wrapper for shader cost budgets (test:shaders).
 *
 * malioc compiles a GLSL ES shader with Arm's real Mali driver compiler and reports
 * registers, stack (spilling / local arrays) and per-pipeline cycle estimates. It
 * ships with Arm Performance Studio (free, no account needed):
 *   curl -LO https://artifacts.tools.arm.com/arm-performance-studio/2026.3/Arm_Performance_Studio_2026.3_linux_x86-64.tgz
 *   tar xzf Arm_Performance_Studio_2026.3_linux_x86-64.tgz Arm_Performance_Studio_2026.3/mali_offline_compiler
 * (other versions / platforms: https://developer.arm.com/Tools%20and%20Software/Arm%20Performance%20Studio).
 * Found via $MALIOC, then `malioc` on PATH, then
 * /workspace/tools/Arm_Performance_Studio_x/mali_offline_compiler/malioc (newest).
 * Missing → callers skip the budget with a warning.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const MALIOC_INSTALL =
  "download Arm Performance Studio (https://artifacts.tools.arm.com/arm-performance-studio/2026.3/Arm_Performance_Studio_2026.3_linux_x86-64.tgz), extract mali_offline_compiler/ and set MALIOC=<dir>/malioc or put it on PATH (scripts/lib/malioc.ts)";

const TOOLS_DIR = "/workspace/tools";

export function findMalioc(): string | null {
  const works = (bin: string) => spawnSync(bin, ["--version"], { encoding: "utf8" }).status === 0;
  const env = process.env.MALIOC;
  if (env && works(env)) return env;
  if (works("malioc")) return "malioc";
  if (existsSync(TOOLS_DIR)) {
    const dirs = readdirSync(TOOLS_DIR).filter((d) => d.startsWith("Arm_Performance_Studio_")).sort().reverse();
    for (const d of dirs) {
      const bin = join(TOOLS_DIR, d, "mali_offline_compiler", "malioc");
      if (existsSync(bin) && works(bin)) return bin;
    }
  }
  return null;
}

export type MaliocStats = {
  /** Stack bytes per thread (register spills + local arrays kept in memory). */
  stack: number;
  workRegisters: number;
  occupancy: number;
  /** Cycles per pipeline on the longest / shortest path. */
  longest: { arith: number; ls: number; tex: number };
  shortest: { arith: number; ls: number; tex: number };
  bound: string[];
};

/** Compile one GLSL ES fragment shader (the exact string sent to WebGL) for `core`. */
export function maliocFragment(bin: string, source: string, core = "Mali-G57"): MaliocStats {
  const dir = mkdtempSync(join(tmpdir(), "dm-malioc-"));
  const file = join(dir, "s.frag");
  writeFileSync(file, source);
  const r = spawnSync(bin, ["-c", core, "--fragment", file, "--format", "json"], { encoding: "utf8", maxBuffer: 1 << 26 });
  rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) throw new Error(`malioc failed: ${(r.stderr || r.stdout).slice(0, 400)}`);
  const sh = JSON.parse(r.stdout).shaders[0];
  const v = sh.variants.find((x: { name: string }) => x.name === "Main") ?? sh.variants[0];
  const prop = (name: string) => Number(v.properties.find((p: { name: string }) => p.name === name)?.value ?? 0);
  const perf = v.performance;
  const pick = (path: { cycle_count: number[] }) => {
    const at = (name: string) => path.cycle_count[perf.pipelines.indexOf(name)] ?? 0;
    return { arith: at("arith_total"), ls: at("load_store"), tex: at("texture") };
  };
  return {
    stack: prop("stack_size"),
    workRegisters: prop("work_registers_used"),
    occupancy: prop("thread_occupancy"),
    longest: pick(perf.longest_path_cycles),
    shortest: pick(perf.shortest_path_cycles),
    bound: perf.longest_path_cycles.bound_pipelines,
  };
}

export const fmtMalioc = (s: MaliocStats) =>
  `stack ${s.stack} B, longest A/LS/T ${s.longest.arith}/${s.longest.ls}/${s.longest.tex}, shortest A/LS/T ${s.shortest.arith}/${s.shortest.ls}/${s.shortest.tex}, ${s.workRegisters} regs @ ${s.occupancy}%`;

export type MaliBudget = { stack: number; longestLS: number; longestTex: number };

/**
 * Seabed terrain fragment programs on Mali-G57 (the reference low-end phone GPU),
 * every variant (desktop / phone defines, highp / mediump, base / LOD fade).
 * Achieved at this commit: stack <= 48 B, longest load/store <= 97, texture 24.25.
 * 78b0952 (14-entry merge arrays): stack 416-432 B, load/store 1650-1750, texture 84.
 */
export const SEABED_MALI_BUDGET: MaliBudget = { stack: 96, longestLS: 150, longestTex: 40 };

export function budgetIssues(s: MaliocStats, b: MaliBudget): string[] {
  const out: string[] = [];
  if (s.stack > b.stack) out.push(`stack ${s.stack} B > ${b.stack} B (register spills / local arrays in memory)`);
  if (s.longest.ls > b.longestLS) out.push(`longest-path load/store ${s.longest.ls} cycles > ${b.longestLS}`);
  if (s.longest.tex > b.longestTex) out.push(`longest-path texture ${s.longest.tex} cycles > ${b.longestTex}`);
  return out;
}
