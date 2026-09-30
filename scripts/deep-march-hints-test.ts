/**
 * Conserve mode — new-player hints and the tide advice (plan M9), pure:
 *   - the hint sequence 采集 → 建核心 → 存入 → 唤潮 → 放流 (after the first
 *     tide), each completed by doing it; a returning player (generation ≥ 2)
 *     starts at 放流; hidden while busy / off; dismiss, off, on again = from the
 *     start; no new object when nothing changed; stored progress validated;
 *   - telemetry → observation (deposit / release notices, recall, panel, tide, loading);
 *   - the base panel's tide advice (cap → energy tower, drain → lighthouse switch, charging, dive).
 * Run: npm run test:hints
 */
import type { BaseTelemetry } from "../src/games/deep-march/scene/base/telemetry";
import type { ExpeditionTelemetry } from "../src/games/deep-march/scene/expedition/telemetry";
import type { TideTelemetry } from "../src/games/deep-march/scene/tide/telemetry";
import { HINT_STEPS, NO_PROGRESS, currentHint, dismissHint, observe, parseProgress, setHintsOn, type HintObservation, type HintProgress } from "../src/games/deep-march/ui/hints/hintModel";
import { observationOf } from "../src/games/deep-march/ui/hints/hintObservation";
import { tideAdvice } from "../src/games/deep-march/ui/base/tideAdvice";
import { createChecker } from "./lib/checks";

const c = createChecker();
const idle: HintObservation = { tank: 0, founded: false, deposited: false, released: false, gen: 1, tideCalled: false, busy: false };
const at = (o: Partial<HintObservation>): HintObservation => ({ ...idle, ...o });

c.section("the sequence");
{
  let p: HintProgress = NO_PROGRESS;
  const seen: (string | null)[] = [];
  const steps: Partial<HintObservation>[] = [{}, { tank: 40 }, { tank: 40, founded: true }, { founded: true, deposited: true }, { founded: true, tideCalled: true }, { founded: true, gen: 2 }, { founded: true, gen: 2, released: true }];
  for (const o of steps) {
    p = observe(p, at(o));
    seen.push(currentHint(p, at(o)) ?? "null");
  }
  c.check(seen.join(",") === "absorb,core,deposit,tide,null,release,null", "absorb → core → deposit → 唤潮 → (nothing until the tide) → 放流 → done", seen.join(","));
  c.check(p.done.join(",") === HINT_STEPS.join(","), "every step done, in order");
}
{
  const p = observe(NO_PROGRESS, at({ founded: true }));
  c.check(currentHint(p, at({ founded: true })) === "absorb", "core founded from the lander cargo first: the absorb hint still comes first");
  c.check(currentHint(NO_PROGRESS, at({ tank: 0 })) === "absorb" && currentHint(observe(NO_PROGRESS, at({ tank: 5 })), at({ tank: 5 })) === "core", "deposit and 唤潮 wait for the core");
  const back = observe(NO_PROGRESS, at({ founded: true, gen: 3 }));
  c.check(currentHint(back, at({ founded: true, gen: 3 })) === "release" && back.done.length === 4, "a returning player (generation 3): straight to the 放流 hint");
}
c.section("showing and dismissing");
{
  c.check(currentHint(NO_PROGRESS, at({ busy: true })) === null, "hidden while busy (tide, recall, panel, loading)");
  const off = setHintsOn(NO_PROGRESS, false);
  c.check(off.off && currentHint(off, idle) === null && observe(off, at({ tank: 3 })).off, "「不再提示」: none shown, progress still recorded");
  const d = dismissHint(NO_PROGRESS, "absorb");
  c.check(currentHint(d, idle) === "core" && dismissHint(d, "absorb") === d, "「知道了」 / H: that step is done (again: no change)");
  const again = setHintsOn(observe(off, at({ founded: true, gen: 2 })), true);
  c.check(!again.off && again.done.length === 0, "switched on in the setup: from the start");
  const p = observe(NO_PROGRESS, at({ tank: 1 }));
  c.check(observe(p, at({ tank: 9 })) === p, "no new object when nothing changed (no store writes per poll)");
}
c.section("stored progress");
{
  const bad = [null, 3, "x", { done: "absorb" }, { done: [1, "nope"], off: "yes" }].map(parseProgress);
  c.check(bad.every((p) => p.done.length === 0 && !p.off), "anything odd → from the start, hints on");
  const p = parseProgress({ done: ["tide", "absorb", "absorb", "zzz"], off: true });
  c.check(p.done.join(",") === "absorb,tide" && p.off, "known steps only, in order, once; off kept", p.done.join(","));
}

c.section("telemetry → observation");
{
  const exp = (o: Partial<ExpeditionTelemetry> = {}) => ({ tank: { value: 0, capacity: 200, ratio: 0 }, notice: null, recall: { phase: "idle", progress: 0 }, ...o }) as ExpeditionTelemetry;
  const base = (o: Partial<BaseTelemetry> = {}) => ({ view: { founded: true }, notice: null, panel: false, ...o }) as unknown as BaseTelemetry;
  const tide = (state: TideTelemetry["state"], gen = 1) => ({ state, gen }) as TideTelemetry;
  const o1 = observationOf(exp({ tank: { value: 12, capacity: 200, ratio: 0.06 } }), base(), tide("idle"), true);
  c.check(o1.tank === 12 && o1.founded && !o1.busy && o1.gen === 1, "tank, core, generation; not busy");
  c.check(observationOf(exp(), base({ notice: { kind: "moved", action: "deposit", total: 30 } }), null, true).deposited, "a deposit notice (panel) → deposited");
  c.check(observationOf(exp({ notice: { kind: "deposited", total: 30 } }), base(), null, true).deposited, "recalled inside the base → deposited");
  c.check(!observationOf(exp(), base({ notice: { kind: "moved", action: "deposit", total: 0 } }), null, true).deposited, "an empty deposit does not count");
  c.check(observationOf(exp(), base({ notice: { kind: "moved", action: "release", total: 10 } }), null, true).released, "a release notice → released");
  const busy = [
    observationOf(exp({ recall: { phase: "holding", progress: 0.2 } }), base(), null, true),
    observationOf(exp(), base({ panel: true }), null, true),
    observationOf(exp(), base(), tide("warning"), true),
    observationOf(exp(), base(), tide("show"), true),
    observationOf(exp(), base(), null, false),
  ];
  c.check(busy.every((o) => o.busy), "busy: recall, base panel, the tide's warning / show, the loading screen");
  const called = observationOf(exp(), base(), tide("done", 2), true);
  c.check(called.tideCalled && !called.busy && called.gen === 2, "after the tide: called, not busy, generation 2");
}

c.section("tide advice (base panel)");
{
  const view = (o: object) => ({ founded: true, energy: 80, energyCap: 300, energyRate: 0.25, brownout: false, ...o }) as Parameters<typeof tideAdvice>[0];
  const need = (o: object = {}) => ({ energy: 80, energyNeeded: 150, dives: 1, divesNeeded: 1, ready: false, ...o });
  c.check(tideAdvice(view({ founded: false }), need(), false) === null, "no base: nothing");
  c.check(tideAdvice(view({ energyCap: 100 }), need(), false)?.kind === "cap", "capacity 100 < 150: build an energy tower");
  c.check(tideAdvice(view({ energyRate: -0.05 }), need(), false)?.kind === "drain", "energy falling (a lit lighthouse): switch it off");
  c.check(tideAdvice(view({ energyRate: 0.25, brownout: true }), need(), false)?.kind === "drain", "brown-out: switch the lighthouses off");
  const ch = tideAdvice(view({}), need(), false);
  c.check(ch?.kind === "charging" && ch.minutes === 5, "rising: (150 − 80) / 0.25 = 280 s → about 5 min", JSON.stringify(ch));
  c.check(tideAdvice(view({ energy: 160 }), need({ energy: 160, dives: 0 }), false)?.kind === "dive", "energy there, no departure yet: make a dive");
  c.check(tideAdvice(view({ energy: 160 }), need({ energy: 160, ready: true }), false) === null && tideAdvice(view({}), need(), true) === null, "ready, or a tide running: nothing");
}
c.finish();
