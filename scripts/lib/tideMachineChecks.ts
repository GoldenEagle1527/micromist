/**
 * test:tide — the state machine, timeline, governor and dome rules (pure):
 * phases, save order (commit before the first show frame), extension, every
 * murk trigger, context loss, the particle-ization rule.
 */
import { TIDE, phaseStarts } from "../../src/games/deep-march/conserve/tide/config";
import { DiverFate, domeZone, tideTakes } from "../../src/games/deep-march/conserve/tide/dome";
import type { TideFrame, TideStepInput } from "../../src/games/deep-march/conserve/tide/frame";
import { FrameGovernor } from "../../src/games/deep-march/conserve/tide/governor";
import { SHOW_SECONDS, TideMachine, phaseAt, type TideStart } from "../../src/games/deep-march/conserve/tide/machine";
import type { Checker } from "./checks";

type Run = { frames: TideFrame[]; at: (e: string) => number };

/** Step a fresh machine at dt until done (or maxS); input may depend on the time. */
function run(start: TideStart, input: (t: number) => Partial<TideStepInput> = () => ({}), dt = 0.1, maxS = 200): Run {
  const m = new TideMachine();
  m.start(start);
  const frames: TideFrame[] = [];
  let t = 0;
  for (; t <= maxS; t += dt) {
    const f = m.step({ dt, nextReady: true, frameMs: 16, contextLost: false, ...input(t) });
    frames.push(f);
    if (f.events.includes("done")) break;
  }
  const at = (e: string) => frames.findIndex((f) => f.events.includes(e as never));
  return { frames, at };
}

const NORMAL: TideStart = { simple: false, lowMemory: false };
const near = (a: number, b: number, eps = 0.11) => Math.abs(a - b) <= eps;

export function tideMachineChecks(c: Checker): void {
  c.section("timeline (conserve/tide/config.ts)");
  {
    const { starts, total } = phaseStarts();
    c.check(total === 35 && SHOW_SECONDS === 35, "show ≈ 35 s", `${total} s`);
    c.check(starts.inhale === 0 && starts.strip === 5 && starts.currents === 13 && starts.gather === 21 && starts.settle === 30, "P1 0 · P2 5 · P3 13 · P4 21 · P5 30", JSON.stringify(starts));
    c.check(phaseAt(0) === "inhale" && phaseAt(4.99) === "inhale" && phaseAt(5) === "strip" && phaseAt(20.9) === "currents" && phaseAt(21) === "gather" && phaseAt(34) === "settle", "phaseAt boundaries");
  }

  c.section("state machine: the normal tide");
  {
    const r = run(NORMAL);
    const f = r.frames;
    const commit = r.at("commit"), swap = r.at("swap"), done = r.at("done");
    const firstShow = f.findIndex((x) => x.state === "show");
    c.check(f[0].events.includes("precompute") && f[0].state === "warning", "the first frame asks for the precompute");
    c.check(near(commit * 0.1, 60), "warning 60 s, then the commit", `commit at ${(commit * 0.1).toFixed(1)} s`);
    c.check(commit === firstShow && f.slice(0, commit).every((x) => x.state === "warning" && !x.committed), "save order: gen + 1 is committed in the step that ends the warning — before any show frame");
    c.check(near((swap - commit) * 0.1, 21) && f[swap].phase === "gather", "terrain switch at P4 (21 s into the show)", `${((swap - commit) * 0.1).toFixed(1)} s`);
    c.check(near((done - commit) * 0.1, 35) && f[done].state === "done", "done after the 35 s show", `${((done - commit) * 0.1).toFixed(1)} s`);
    const evs = f.flatMap((x) => x.events);
    c.check(["precompute", "commit", "swap", "done"].every((e) => evs.filter((x) => x === e).length === 1) && evs.join() === "precompute,commit,swap,done", "each event exactly once, in order", evs.join(" → "));
    c.check(f.every((x) => x.fallback === null) && f.filter((x) => x.state === "show").every((x) => x.phase !== null && x.u >= 0 && x.u <= 1), "no fallback; phase progress in [0, 1]");
    c.check(near(f[10].left, 59, 0.2) && !f[10].extended, "countdown", `${f[10].left.toFixed(1)} s left at 1 s`);
    const m = new TideMachine();
    c.check(m.start(NORMAL) && !m.start(NORMAL), "a second call while running is refused");
  }

  c.section("state machine: extension and the murk (浊潮)");
  {
    const late = run(NORMAL, (t) => ({ nextReady: t >= 75 }));
    const commit = late.at("commit");
    c.check(near(commit * 0.1, 75, 0.2) && late.frames[commit].state === "show" && late.frames[700].extended && late.frames[700].left > 10, "not precomputed at 60 s: the warning waits (「潮在积蓄」) and the show starts when it is", `commit at ${(commit * 0.1).toFixed(1)} s`);
    const never = run(NORMAL, (t) => ({ nextReady: t >= 100 }));
    const nc = never.at("commit");
    c.check(near(nc * 0.1, 90, 0.2) && never.frames[nc].state === "murk" && never.frames[nc].fallback === "timeout", "still not done at +30 s: commit and the murk (timeout)", `commit at ${(nc * 0.1).toFixed(1)} s`);
    const ns = never.at("swap");
    c.check(near(ns * 0.1, 100, 0.2) && never.frames[ns - 1].dark === 1, "the murk holds in the dark until the new terrain is ready, then switches", `swap at ${(ns * 0.1).toFixed(1)} s`);
    const simple = run({ simple: true, lowMemory: false });
    const sc = simple.at("commit"), sd = simple.at("done");
    c.check(simple.frames[sc].fallback === "simple" && near(sc * 0.1, 60), "?tide=simple: the murk right after the warning");
    c.check(near((sd - sc) * 0.1, 12, 0.3), "the murk takes ≈ 12 s (3 s to black, 3 s held, 6 s clearing)", `${((sd - sc) * 0.1).toFixed(1)} s`);
    const darks = simple.frames.slice(sc, sd).map((f) => f.dark);
    c.check(darks[0] < 0.1 && near(darks[30], 1, 0.05) && darks[darks.length - 1] < 0.05 && darks.every((d) => d >= 0 && d <= 1), "darkness 0 → 1 → 0");
    const mem = run({ simple: false, lowMemory: true });
    c.check(mem.frames[mem.at("commit")].fallback === "memory", "low-memory device → the murk");
    const hold = run({ simple: true, lowMemory: false }, () => ({ nextReady: false }));
    const hc = hold.at("commit"), hs = hold.at("swap");
    c.check(near((hs - hc) * 0.1, TIDE.murk.darkS + TIDE.murk.holdMaxS, 0.2), "the dark hold ends after at most 20 s even if never ready", `${((hs - hc) * 0.1).toFixed(1)} s`);
  }

  c.section("state machine: the frame-time governor and a lost context");
  {
    const slow = run(NORMAL, () => ({ frameMs: 50 }));
    c.check(slow.frames[slow.at("commit")].fallback === "perf", "mean frame > 40 ms over the warning's last 8 s → the murk (perf)");
    const ok = run(NORMAL, () => ({ frameMs: 38 }));
    c.check(ok.frames[ok.at("commit")].state === "show", "38 ms frames (26 fps): the full show");
    const dips = run(NORMAL, (t) => ({ frameMs: t > 64 && t < 67 ? 90 : 16 }));
    const dc = dips.at("commit");
    const dm = dips.frames.findIndex((f, i) => i > dc && f.state === "murk");
    c.check(dm > dc && dips.frames[dm].fallback === "perf" && !dips.frames[dm - 1].swapped, "< 15 fps for 2 s in the show before the switch → the murk", `at ${((dm - dc) * 0.1).toFixed(1)} s into the show`);
    const lateDip = run(NORMAL, (t) => ({ frameMs: t > 83 && t < 90 ? 90 : 16 }));
    c.check(lateDip.frames.every((f) => f.state !== "murk"), "after the switch the show goes on (P4 / P5 are light)");
    const lostW = run(NORMAL, (t) => ({ contextLost: t > 30 && t < 31 }));
    c.check(lostW.frames[lostW.at("commit")].fallback === "gpu" && lostW.frames[lostW.at("commit")].state === "murk", "context lost during the warning → the murk (gpu)");
    const lostS = run(NORMAL, (t) => ({ contextLost: t > 70 }));
    const ls = lostS.at("swap");
    c.check(ls === lostS.at("done") && lostS.frames[ls].state === "done", "context lost in the show: switch and end at once");
  }

  c.section("governor (conserve/tide/governor.ts)");
  {
    const g = new FrameGovernor(10);
    for (let i = 0; i < 100; i++) g.push(20);
    c.check(g.mean(8) === 0 && !g.slow(8, 10), "window not full → 0 (never slow)");
    for (let i = 0; i < 400; i++) g.push(i < 200 ? 16 : 50);
    c.check(near(g.mean(8), 50, 0.01) && g.slow(8, 40) && near(g.mean(1), 50, 0.01), "mean over the last seconds", `${g.mean(8).toFixed(1)} ms`);
    g.push(NaN);
    g.push(-5);
    c.check(near(g.mean(8), 50, 0.01), "non-finite / negative frame times ignored");
  }

  c.section("dome rules (conserve/tide/dome.ts, design doc §5.6)");
  {
    c.check(domeZone(10, 48) === "inside" && domeZone(43.5, 48) === "edge" && domeZone(48, 48) === "edge" && domeZone(48.01, 48) === "outside", "inside · within 5 m of the edge · outside");
    c.check(!tideTakes({ state: "warning" }, "outside") && tideTakes({ state: "show" }, "outside") && tideTakes({ state: "murk" }, "outside") && !tideTakes({ state: "show" }, "edge"), "only once the tide has begun, only outside");
    const fate = new DiverFate();
    const frame = (state: TideFrame["state"], events: string[] = []) => ({ state, events: events as TideFrame["events"] });
    const seq = [fate.step(0.1, frame("warning"), "outside"), fate.step(0.1, frame("show", ["commit"]), "outside")];
    c.check(seq[0] === null && seq[1] === "dissolve" && fate.state === "dissolving", "outside when P1 begins → dissolving");
    for (let i = 0; i < 19; i++) fate.step(0.1, frame("show"), "inside");
    c.check(fate.state === "dissolving" && fate.progress > 0.9, "swimming back does not undo it; 2 s to dissolve", `${fate.progress.toFixed(2)}`);
    fate.step(0.2, frame("show"), "inside");
    c.check(fate.state === "gone" && fate.progress === 1, "then gone (black)");
    const w = fate.step(0.1, frame("done", ["done"]), "inside");
    c.check(w === "wake" && fate.state === "free", "wakes when the tide is over");
    const safe = new DiverFate();
    const never = [safe.step(0.1, frame("show"), "inside"), safe.step(0.1, frame("show"), "edge"), safe.step(0.1, frame("done", ["done"]), "inside")];
    c.check(never.every((x) => x === null) && safe.state === "free", "inside the whole time: nothing happens");
  }
}
