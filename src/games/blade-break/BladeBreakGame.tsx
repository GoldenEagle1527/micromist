import { useCallback, useEffect, useMemo, useState } from "react";
import "./blade-break.css";
import { useLocale } from "../../i18n";
import {
  loadLocalProgress,
  saveLocalProgress,
  useLocalGamePersist,
} from "../local-persist";
import { CARDS, FUSION_RECIPES, SECRET_FUSION_RECIPES, getSecretRecipe } from "./cards";
import { FIGHT_COUNT, ENEMIES } from "./enemies";
import {
  advanceAfterCombatLoss,
  advanceAfterCombatWin,
  canPlayCard,
  choosePath,
  createRun,
  currentPathOptions,
  endTurn,
  intentLabelKey,
  pickReward,
  playCard,
  resolveEvent,
  restFuse,
  restHeal,
  restHealAmount,
  restRemoveCard,
  skipRest,
} from "./engine";
import type {
  CardId,
  CardInstance,
  Intent,
  PassiveId,
  RunState,
} from "./types";

type Screen = "setup" | "run";
type RestMode = "menu" | "remove" | "fuse";

const OLD_SESSION_KEY = "micromist.blade-break.run";
const SLUG = "blade-break";
const FIGHT_TOTAL = FIGHT_COUNT;

function normalizeRun(parsed: RunState): RunState {
  if (parsed.combat) {
    if (parsed.combat.attacksPlayedThisTurn == null) {
      parsed.combat.attacksPlayedThisTurn = 0;
    }
    if (parsed.combat.breakChain == null) parsed.combat.breakChain = 0;
    if (parsed.combat.brokeThisTurn == null) parsed.combat.brokeThisTurn = false;
    if (parsed.combat.breakEchoGranted == null) {
      parsed.combat.breakEchoGranted = false;
    }
    if (parsed.combat.ruleId == null) {
      parsed.combat.ruleId = parsed.ruleId ?? "breakSurge";
    }
    if (parsed.combat.enemy && parsed.combat.enemy.variant == null) {
      parsed.combat.enemy.variant = "normal";
    }
    if (parsed.combat.enemy && parsed.combat.enemy.elite == null) {
      parsed.combat.enemy.elite = false;
    }
    if (!parsed.combat.highlightLog) parsed.combat.highlightLog = [];
    if (
      parsed.combat.enemy &&
      (parsed.combat.enemy.id == null || !(parsed.combat.enemy.id in ENEMIES))
    ) {
      parsed.combat = null;
      parsed.phase = "runLost";
    }
  }
  if (parsed.ruleId == null) parsed.ruleId = "breakSurge";
  {
    const h = parsed.highlights ?? ({} as RunState["highlights"]);
    parsed.highlights = {
      maxHit: h.maxHit ?? 0,
      breakInterrupts: h.breakInterrupts ?? 0,
      minHpSeen: h.minHpSeen ?? parsed.maxHp ?? 40,
      poisonKills: h.poisonKills ?? 0,
      maxAttacksInTurn: h.maxAttacksInTurn ?? 0,
    };
  }
  if (parsed.secretRecipeId == null) {
    parsed.secretRecipeId = "secret_overbreak";
  }
  if (parsed.secretRevealed == null) parsed.secretRevealed = false;
  if (!parsed.discoveredRecipes) parsed.discoveredRecipes = [];
  // Soft-recover corrupt mid-run phases so hydrate can clear to setup
  if (parsed.phase === "event" && !parsed.eventId) {
    parsed.phase = "runLost";
    parsed.combat = null;
  }
  if (parsed.phase === "combat" && !parsed.combat) {
    parsed.phase = "runLost";
  }
  return parsed;
}

let bladeBreakMigrated = false;

function migrateBladeBreakSessionOnce(): void {
  if (bladeBreakMigrated) return;
  bladeBreakMigrated = true;
  try {
    if (loadLocalProgress<RunState>(SLUG) != null) {
      sessionStorage.removeItem(OLD_SESSION_KEY);
      return;
    }
    const raw = sessionStorage.getItem(OLD_SESSION_KEY);
    if (!raw) return;
    sessionStorage.removeItem(OLD_SESSION_KEY);
    const parsed = normalizeRun(JSON.parse(raw) as RunState);
    if (parsed.phase !== "runWon" && parsed.phase !== "runLost") {
      saveLocalProgress(SLUG, parsed);
    }
  } catch {
    /* ignore */
  }
}

function ApPips({ ap, max }: { ap: number; max: number }) {
  return (
    <span className="blade-ap" aria-label={`AP ${ap}/${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={`blade-ap-pip${i < ap ? " blade-ap-pip-on" : ""}`}
        />
      ))}
    </span>
  );
}

function Bar({
  value,
  max,
  className,
  label,
}: {
  value: number;
  max: number;
  className: string;
  label: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={`blade-bar ${className}`} title={label}>
      <div className="blade-bar-fill" style={{ width: `${pct}%` }} />
      <span className="blade-bar-text">
        {label} {value}/{max}
      </span>
    </div>
  );
}

function intentText(
  intent: Intent | null,
  t: ReturnType<typeof useLocale>["t"]["blade"],
): string {
  if (!intent) return t.intentNone;
  const key = intentLabelKey(intent) as keyof typeof t;
  const tpl = t[key];
  if (typeof tpl === "function") {
    const v =
      intent.kind === "windup"
        ? (intent.windupDamage ?? intent.value)
        : intent.value;
    return (tpl as (n: number) => string)(v);
  }
  return String(tpl ?? t.intentNone);
}

type IntentVisual = {
  tone: string;
  value: number | null;
  windup?: number;
};

function intentVisual(intent: Intent | null): IntentVisual | null {
  if (!intent) return null;
  const v = intent.value;
  switch (intent.kind) {
    case "attack":
      return { tone: "attack", value: v };
    case "heavyAttack":
      return { tone: "heavy", value: v };
    case "defend":
      return { tone: "defend", value: v };
    case "windup":
      return {
        tone: "windup",
        value: intent.windupDamage ?? v,
        windup: intent.windupLeft ?? 0,
      };
    case "thorns":
      return { tone: "thorns", value: v };
    case "armorUp":
      return { tone: "armor", value: v };
    case "hex":
      return { tone: "hex", value: v };
    case "heal":
      return { tone: "heal", value: v };
    case "discard":
      return { tone: "discard", value: v };
    case "shatterBlock":
      return { tone: "shatter", value: v };
    default:
      return { tone: "attack", value: v };
  }
}

function IntentIcon({ tone }: { tone: string }) {
  const common = {
    viewBox: "0 0 24 24",
    "aria-hidden": true as const,
    className: "blade-intent-svg",
  };
  switch (tone) {
    case "defend":
    case "armor":
      return (
        <svg {...common}>
          <path d="M12 2 4 5v6c0 5.25 3.4 9.74 8 11 4.6-1.26 8-5.75 8-11V5l-8-3z" />
        </svg>
      );
    case "shatter":
      return (
        <svg {...common}>
          <path d="M12 2 4 5v6c0 5.25 3.4 9.74 8 11 4.6-1.26 8-5.75 8-11V5l-8-3zm0 4 2 4h-4l2-4zm-1 6h2v5h-2v-5z" />
        </svg>
      );
    case "heal":
      return (
        <svg {...common}>
          <path d="M12 21s-7-4.35-7-10a4 4 0 0 1 7-2.65A4 4 0 0 1 19 11c0 5.65-7 10-7 10z" />
        </svg>
      );
    case "hex":
      return (
        <svg {...common}>
          <path d="M12 2c2.5 3 4 5.5 4 8a4 4 0 1 1-8 0c0-2.5 1.5-5 4-8zm-3 14h6l1 6H8l1-6z" />
        </svg>
      );
    case "thorns":
      return (
        <svg {...common}>
          <path d="M12 2 9 9H2l6 4-2 9 6-5 6 5-2-9 6-4h-7L12 2z" />
        </svg>
      );
    case "discard":
      return (
        <svg {...common}>
          <path d="M7 4h12v14H7V4zm-3 3h2v14h10v2H4V7z" />
        </svg>
      );
    case "windup":
      return (
        <svg {...common}>
          <path d="M4 19 14 4l2 1-3 5h7L9 22l-1-1 4-6H5l-1 4z" />
        </svg>
      );
    case "heavy":
      return (
        <svg {...common}>
          <path d="M3 20 13 3l2.2 1.2-3.5 6.3H21L8.5 22 7 20.8 11 13H4.8L3 20z" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M6.5 19.5 16 3.5l1.8 1-3.2 5.8H20L8.2 21.2 6.8 20 11 13H5.2L6.5 19.5z" />
        </svg>
      );
  }
}

function IntentBadge({
  intent,
  broken,
  brokenLabel,
  label,
  intentKicker,
  windupSub,
}: {
  intent: Intent | null;
  broken: boolean;
  brokenLabel: string;
  label: string;
  intentKicker: string;
  windupSub: (n: number) => string;
}) {
  if (broken) {
    return (
      <div className="blade-intent blade-intent-broken" role="status">
        <span className="blade-intent-icon-wrap" aria-hidden="true">
          <IntentIcon tone="shatter" />
        </span>
        <div className="blade-intent-copy">
          <strong className="blade-intent-label">{brokenLabel}</strong>
        </div>
      </div>
    );
  }
  const vis = intentVisual(intent);
  if (!vis) {
    return (
      <div className="blade-intent blade-intent-none" role="status">
        <strong>{label}</strong>
      </div>
    );
  }
  return (
    <div
      className={`blade-intent blade-intent-${vis.tone}`}
      role="status"
      aria-label={label}
    >
      <span className="blade-intent-icon-wrap" aria-hidden="true">
        <IntentIcon tone={vis.tone} />
      </span>
      {vis.value != null ? (
        <span className="blade-intent-value">{vis.value}</span>
      ) : null}
      <div className="blade-intent-copy">
        <span className="blade-intent-kicker">{intentKicker}</span>
        <strong className="blade-intent-label">{label}</strong>
        {vis.windup != null && vis.windup > 0 ? (
          <span className="blade-intent-sub">{windupSub(vis.windup)}</span>
        ) : null}
      </div>
    </div>
  );
}

function cardTitle(id: CardId, t: ReturnType<typeof useLocale>["t"]["blade"]): string {
  return t.cards[id]?.name ?? id;
}

function cardDesc(id: CardId, t: ReturnType<typeof useLocale>["t"]["blade"]): string {
  return t.cards[id]?.desc ?? "";
}

function passiveTitle(
  id: PassiveId,
  t: ReturnType<typeof useLocale>["t"]["blade"],
): string {
  return t.passives[id]?.name ?? id;
}

function passiveDesc(
  id: PassiveId,
  t: ReturnType<typeof useLocale>["t"]["blade"],
): string {
  return t.passives[id]?.desc ?? "";
}

function enemyName(
  id: string,
  t: ReturnType<typeof useLocale>["t"]["blade"],
): string {
  return t.enemies[id as keyof typeof t.enemies] ?? id;
}

function RuleBanner({
  ruleId,
  bl,
}: {
  ruleId: RunState["ruleId"];
  bl: ReturnType<typeof useLocale>["t"]["blade"];
}) {
  const rule = bl.rules[ruleId];
  if (!rule) return null;
  return (
    <div className="blade-rule-banner" title={rule.desc}>
      <strong>{bl.ruleBanner(rule.name)}</strong>
      <span className="hint">{rule.desc}</span>
    </div>
  );
}

function HighlightsPanel({
  run,
  bl,
}: {
  run: RunState;
  bl: ReturnType<typeof useLocale>["t"]["blade"];
}) {
  const h = run.highlights;
  return (
    <div className="blade-highlights">
      <h3>{bl.highlightsTitle}</h3>
      <ul>
        <li>{bl.highlightMaxHit(h.maxHit)}</li>
        <li>{bl.highlightBreaks(h.breakInterrupts)}</li>
        <li>{bl.highlightMinHp(h.minHpSeen)}</li>
        {h.poisonKills > 0 ? (
          <li>{bl.highlightPoisonKills(h.poisonKills)}</li>
        ) : null}
        <li>{bl.highlightMaxAttacks(h.maxAttacksInTurn)}</li>
      </ul>
      {run.discoveredRecipes.length > 0 ? (
        <p className="hint">
          {bl.secretRecipesTitle}:{" "}
          {run.discoveredRecipes.map((id) => cardTitle(id, bl)).join(", ")}
        </p>
      ) : null}
    </div>
  );
}

export function BladeBreakGame() {
  const { t } = useLocale();
  const bl = t.blade;

  const [screen, setScreen] = useState<Screen>("setup");
  const [run, setRun] = useState<RunState | null>(null);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [restMode, setRestMode] = useState<RestMode>("menu");
  const [fusePick, setFusePick] = useState<string[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [juice, setJuice] = useState<"hit" | "break" | "chain" | null>(null);

  migrateBladeBreakSessionOnce();

  const persistState = screen === "run" ? run : null;
  const { clear: clearProgress } = useLocalGamePersist<RunState>(
    SLUG,
    persistState,
    {
      shouldSave: (r) => r.phase !== "runWon" && r.phase !== "runLost",
      onHydrate: (saved) => {
        const fixed = normalizeRun(saved);
        if (fixed.phase === "runWon" || fixed.phase === "runLost") return;
        setRun(fixed);
        setScreen("run");
      },
    },
  );

  useEffect(() => {
    if (!juice) return;
    const id = window.setTimeout(() => setJuice(null), juice === "chain" ? 560 : 420);
    return () => window.clearTimeout(id);
  }, [juice]);

  const setRunAndClearSel = useCallback((r: RunState | null) => {
    setRun(r);
    setSelectedUid(null);
    setRestMode("menu");
    setFusePick([]);
  }, []);

  const startRun = useCallback(() => {
    clearProgress();
    const r = createRun();
    setRunAndClearSel(r);
    setScreen("run");
    setFlash(null);
    setJuice(null);
  }, [setRunAndClearSel, clearProgress]);

  const backToSetup = useCallback(() => {
    setScreen("setup");
    setRunAndClearSel(null);
    clearProgress();
    setFlash(null);
    setJuice(null);
  }, [setRunAndClearSel, clearProgress]);

  const applyCombatResult = useCallback(
    (nextCombat: NonNullable<RunState["combat"]>, base: RunState) => {
      const log = nextCombat.log;
      if (log.includes("break_chain_ap") || log.includes("break_chain_draw")) {
        setJuice("chain");
        if (log.includes("break_chain_ap")) setFlash(bl.breakChainAp);
        else setFlash(bl.breakChainDraw);
      } else if (log.includes("poise_break")) {
        setJuice("break");
        setFlash(
          log.includes("break_echo") ? bl.breakEchoFlash : bl.staggerFlash,
        );
      } else if (log.includes("flurry_law")) {
        setFlash(bl.flurryLawFlash);
        setJuice("hit");
      } else if (log.includes("hit") || log.some((l) => l.startsWith("hit:"))) {
        setJuice("hit");
      }

      let nextRun: RunState;
      if (nextCombat.phase === "won") {
        // advanceAfterCombatWin merges highlights once
        nextRun = advanceAfterCombatWin({ ...base, combat: nextCombat });
        setFlash(bl.fightWon);
      } else if (nextCombat.phase === "lost") {
        nextRun = advanceAfterCombatLoss({ ...base, combat: nextCombat });
        setFlash(bl.fightLost);
      } else {
        // Keep highlight *events* in combat.log across actions; only refresh live stats here.
        // Full log merge happens once in advanceAfterCombatWin/Loss.
        const h = base.highlights;
        nextRun = {
          ...base,
          combat: nextCombat,
          highlights: {
            ...h,
            minHpSeen: Math.min(h.minHpSeen, nextCombat.player.hp),
            maxAttacksInTurn: Math.max(
              h.maxAttacksInTurn,
              nextCombat.attacksPlayedThisTurn,
            ),
          },
        };
        if (log.includes("enemy_stunned")) {
          setFlash(bl.staggerFlash);
        }
      }
      setRunAndClearSel(nextRun);
    },
    [bl, setRunAndClearSel],
  );

  const combat = run?.combat ?? null;

  const onSelectCard = useCallback(
    (uid: string) => {
      if (!combat || combat.phase !== "player") return;
      // Cards only toggle selection; play happens via the Play button.
      setSelectedUid((prev) => (prev === uid ? null : uid));
      setFlash(null);
    },
    [combat],
  );

  const onPlaySelected = useCallback(() => {
    if (!combat || !selectedUid || !run) return;
    const result = playCard(combat, selectedUid, Math.random, run.passives);
    if (!result.ok) {
      setFlash(bl.playFail[result.reason] ?? bl.playFail.wrong_phase);
      return;
    }
    applyCombatResult(result.state, run);
  }, [combat, selectedUid, run, bl, applyCombatResult]);

  const onEndTurn = useCallback(() => {
    if (!combat || !run || combat.phase !== "player") return;
    const nextCombat = endTurn(combat, Math.random, run.passives);
    applyCombatResult(nextCombat, run);
  }, [combat, run, applyCombatResult]);

  const onPickReward = useCallback(
    (index: number) => {
      if (!run) return;
      const next = pickReward(run, index);
      setRunAndClearSel(next);
      setFlash(null);
    },
    [run, setRunAndClearSel],
  );

  const onRestHeal = useCallback(() => {
    if (!run) return;
    if ((run.restVariant ?? "standard") === "forge") {
      setFlash(bl.restForgeNoHeal);
      return;
    }
    setRunAndClearSel(restHeal(run));
    setFlash(bl.restHealed);
  }, [run, bl, setRunAndClearSel]);

  const onRestRemove = useCallback(
    (uid: string) => {
      if (!run) return;
      setRunAndClearSel(restRemoveCard(run, uid));
      setFlash(bl.restRemoved);
    },
    [run, bl, setRunAndClearSel],
  );

  const onFusePick = useCallback(
    (uid: string) => {
      if (!run) return;
      let nextPick: string[];
      if (fusePick.includes(uid)) {
        nextPick = fusePick.filter((x) => x !== uid);
        setFusePick(nextPick);
        setFlash(null);
        return;
      }
      if (fusePick.length >= 2) {
        nextPick = [fusePick[1]!, uid];
      } else {
        nextPick = [...fusePick, uid];
      }
      if (nextPick.length < 2) {
        setFusePick(nextPick);
        setFlash(null);
        return;
      }
      const [a, b] = nextPick;
      const result = restFuse(run, a!, b!);
      if (!result.ok) {
        setFusePick([]);
        setFlash(bl.fuseFail[result.reason] ?? bl.fuseFail.no_recipe);
        return;
      }
      setRunAndClearSel(result.state);
      if (result.secret) {
        setFlash(bl.secretRevealed(cardTitle(result.resultId, bl)));
      } else {
        setFlash(bl.fuseSuccess(cardTitle(result.resultId, bl)));
      }
    },
    [run, bl, fusePick, setRunAndClearSel],
  );

  const onChoosePath = useCallback(
    (optionId: string) => {
      if (!run) return;
      const result = choosePath(run, optionId);
      if (!result?.ok) return;
      setRunAndClearSel(result.state);
      setFlash(null);
    },
    [run, setRunAndClearSel],
  );

  const onEventChoice = useCallback(
    (choice: number) => {
      if (!run) return;
      const result = resolveEvent(run, choice);
      if (!result?.ok) return;
      setRunAndClearSel(result.state);
      if (result.toast) {
        const msg = bl.eventToasts[result.toast] ?? result.toast;
        setFlash(msg);
      } else {
        setFlash(null);
      }
    },
    [run, bl, setRunAndClearSel],
  );

  const selectedCard = useMemo(() => {
    if (!combat || !selectedUid) return null;
    return combat.player.hand.find((c) => c.uid === selectedUid) ?? null;
  }, [combat, selectedUid]);

  const selectedPlayable = useMemo(() => {
    if (!combat || !selectedUid) return false;
    return canPlayCard(combat, selectedUid).ok;
  }, [combat, selectedUid]);

  const secretRecipe = useMemo(() => {
    if (!run) return null;
    try {
      return getSecretRecipe(run.secretRecipeId);
    } catch {
      return null;
    }
  }, [run]);

  // ——— Setup ———
  if (screen === "setup") {
    return (
      <div className="blade-break blade-setup">
        <div className="panel">
          <h2>{bl.setupTitle}</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            {bl.setupHint(FIGHT_TOTAL)}
          </p>
          <ul className="blade-rules">
            <li>{bl.ruleAp}</li>
            <li>{bl.rulePoise}</li>
            <li>{bl.ruleRun(FIGHT_TOTAL)}</li>
            <li>{bl.ruleFusion}</li>
          </ul>
          <div className="row">
            <button type="button" className="primary" onClick={startRun}>
              {bl.start}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!run) return null;

  // ——— Run won / lost ———
  if (run.phase === "runWon" || run.phase === "runLost") {
    return (
      <div className="blade-break blade-end">
        <div className="panel">
          <h2>{run.phase === "runWon" ? bl.runWonTitle : bl.runLostTitle}</h2>
          <p className="hint">
            {run.phase === "runWon"
              ? bl.runWonBody(FIGHT_TOTAL)
              : bl.runLostBody}
          </p>
          <RuleBanner ruleId={run.ruleId} bl={bl} />
          <HighlightsPanel run={run} bl={bl} />
          <div className="row">
            <button type="button" className="primary" onClick={startRun}>
              {bl.playAgain}
            </button>
            <button type="button" className="ghost" onClick={backToSetup}>
              {bl.backSetup}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ——— Path choice ———
  if (run.phase === "pathChoice") {
    const opts = currentPathOptions(run);
    return (
      <div className="blade-break blade-path">
        <div className="panel">
          <RuleBanner ruleId={run.ruleId} bl={bl} />
          <h2>{bl.pathTitle}</h2>
          <p className="hint">{bl.pathHint}</p>
          <p className="hint blade-progress">
            {bl.progress(run.fightIndex, FIGHT_TOTAL)}
          </p>
          {flash ? <p className="blade-flash">{flash}</p> : null}
          <div className="blade-path-grid">
            {opts.map((o) => {
              const meta = bl.pathOptions[o.kind];
              return (
                <button
                  key={o.id}
                  type="button"
                  className="blade-path-card glass"
                  onClick={() => onChoosePath(o.id)}
                >
                  <strong>{meta?.title ?? o.kind}</strong>
                  <p>{meta?.desc ?? ""}</p>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ——— Event ———
  if (run.phase === "event" && run.eventId) {
    const eid = run.eventId;
    const choices = bl.eventChoices[eid] ?? [];
    return (
      <div className="blade-break blade-event">
        <div className="panel">
          <RuleBanner ruleId={run.ruleId} bl={bl} />
          <h2>{bl.eventTitle[eid] ?? eid}</h2>
          <p className="hint">{bl.eventBody[eid] ?? ""}</p>
          {flash ? <p className="blade-flash">{flash}</p> : null}
          <div className="blade-event-choices">
            {choices.map((label, i) => (
              <button
                key={i}
                type="button"
                className="blade-path-card glass"
                onClick={() => onEventChoice(i)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ——— Reward ———
  if (run.phase === "reward") {
    return (
      <div className="blade-break blade-reward">
        <div className="panel">
          <RuleBanner ruleId={run.ruleId} bl={bl} />
          <h2>{bl.rewardTitle}</h2>
          <p className="hint">
            {run.ruleId === "bloodFeud" ? bl.rewardHintBlood : bl.rewardHint}
          </p>
          {flash ? <p className="blade-flash">{flash}</p> : null}
          <div
            className={`blade-reward-grid${run.rewards.length >= 4 ? " blade-reward-grid-4" : ""}`}
          >
            {run.rewards.map((opt, i) => (
              <button
                key={i}
                type="button"
                className="blade-reward-card glass"
                onClick={() => onPickReward(i)}
              >
                {opt.kind === "card" ? (
                  <>
                    <span className="blade-reward-kind">{bl.rewardCard}</span>
                    {opt.rarity ? (
                      <span className={`blade-rarity blade-rarity-${opt.rarity}`}>
                        {bl.rarity[opt.rarity]}
                      </span>
                    ) : null}
                    <strong>{cardTitle(opt.cardId, bl)}</strong>
                    <span className="blade-reward-meta">
                      {bl.costSpend(CARDS[opt.cardId]?.cost ?? 0)}
                    </span>
                    <p>{cardDesc(opt.cardId, bl)}</p>
                  </>
                ) : (
                  <>
                    <span className="blade-reward-kind">{bl.rewardPassive}</span>
                    {opt.rarity ? (
                      <span className={`blade-rarity blade-rarity-${opt.rarity}`}>
                        {bl.rarity[opt.rarity]}
                      </span>
                    ) : null}
                    <strong>{passiveTitle(opt.passiveId, bl)}</strong>
                    <p>{passiveDesc(opt.passiveId, bl)}</p>
                  </>
                )}
              </button>
            ))}
          </div>
          <p className="hint blade-progress">
            {bl.progress(run.fightIndex, FIGHT_TOTAL)}
          </p>
        </div>
      </div>
    );
  }

  // ——— Rest ———
  if (run.phase === "rest") {
    const rv = run.restVariant ?? "standard";
    const forgeLocked = rv === "forge";
    return (
      <div className="blade-break blade-rest">
        <div className="panel">
          <RuleBanner ruleId={run.ruleId} bl={bl} />
          <h2>
            {bl.restVariants[rv] ?? bl.restTitle}
          </h2>
          <p className="hint">
            {rv === "forge"
              ? bl.restForgeNoHeal
              : rv === "medic"
                ? bl.restMedicHint
                : bl.restHint}
          </p>
          <p className="blade-hp-line">
            HP {run.hp}/{run.maxHp}
          </p>
          {run.secretRevealed && secretRecipe ? (
            <details className="blade-fuse-help">
              <summary>{bl.secretRecipesTitle}</summary>
              <p className="hint">{bl.secretClue}</p>
              <ul>
                <li>
                  {cardTitle(secretRecipe.a, bl)} + {cardTitle(secretRecipe.b, bl)} →{" "}
                  {cardTitle(secretRecipe.result, bl)}
                </li>
              </ul>
            </details>
          ) : null}
          {flash ? <p className="blade-flash">{flash}</p> : null}
          {restMode === "menu" ? (
            <>
              <div className="row blade-rest-actions">
                <button
                  type="button"
                  className="primary"
                  onClick={onRestHeal}
                  disabled={forgeLocked}
                >
                  {bl.restHeal(restHealAmount(run))}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setRestMode("remove");
                    setFlash(null);
                  }}
                  disabled={run.deck.length <= 5}
                >
                  {bl.restRemove}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setRestMode("fuse");
                    setFusePick([]);
                    setFlash(null);
                  }}
                  disabled={run.deck.length <= 5}
                >
                  {bl.restFuse}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setRunAndClearSel(skipRest(run))}
                >
                  {bl.restSkip}
                </button>
              </div>
              <details className="blade-fuse-help">
                <summary>{bl.fuseRecipesTitle}</summary>
                <ul>
                  {FUSION_RECIPES.map((r) => (
                    <li key={r.result}>
                      {cardTitle(r.a, bl)} + {cardTitle(r.b, bl)} →{" "}
                      {cardTitle(r.result, bl)}
                    </li>
                  ))}
                  {run.secretRevealed
                    ? SECRET_FUSION_RECIPES.filter(
                        (r) => r.id === run.secretRecipeId,
                      ).map((r) => (
                        <li key={r.result}>
                          {cardTitle(r.a, bl)} + {cardTitle(r.b, bl)} →{" "}
                          {cardTitle(r.result, bl)} ★
                        </li>
                      ))
                    : null}
                </ul>
              </details>
            </>
          ) : restMode === "remove" ? (
            <>
              <p className="hint">{bl.restRemoveHint}</p>
              <div className="blade-deck-list">
                {run.deck.map((c: CardInstance) => (
                  <button
                    key={c.uid}
                    type="button"
                    className="blade-mini-card"
                    onClick={() => onRestRemove(c.uid)}
                  >
                    <strong>{cardTitle(c.cardId, bl)}</strong>
                    <span>{cardDesc(c.cardId, bl)}</span>
                  </button>
                ))}
              </div>
              <div className="row">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setRestMode("menu")}
                >
                  {bl.confirmCancel}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="hint">{bl.restFuseHint}</p>
              <div className="blade-deck-list">
                {run.deck.map((c: CardInstance) => {
                  const picked = fusePick.includes(c.uid);
                  return (
                    <button
                      key={c.uid}
                      type="button"
                      className={`blade-mini-card${picked ? " blade-mini-card-selected" : ""}`}
                      onClick={() => onFusePick(c.uid)}
                      aria-pressed={picked}
                    >
                      <strong>{cardTitle(c.cardId, bl)}</strong>
                      <span>{cardDesc(c.cardId, bl)}</span>
                    </button>
                  );
                })}
              </div>
              <p className="hint">{bl.fusePicked(fusePick.length)}</p>
              <div className="row">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setRestMode("menu");
                    setFusePick([]);
                    setFlash(null);
                  }}
                >
                  {bl.confirmCancel}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ——— Combat ———
  if (!combat) return null;
  const enemy = combat.enemy;
  const player = combat.player;
  const broken = Boolean(enemy.statuses.broken);
  const enemyDef = ENEMIES[enemy.id];
  const isNemesis = enemy.variant === "revenge";
  const maxPoiseLabel = enemy.maxPoise ?? enemyDef?.maxPoise ?? 0;

  return (
    <div className="blade-break blade-duel">
      <RuleBanner ruleId={run.ruleId} bl={bl} />
      <div className="blade-duel-layout">
        <section
          className={[
            "blade-enemy glass",
            juice === "hit" ? "blade-juice-hit" : "",
            juice === "break" ? "blade-juice-break" : "",
            juice === "chain" ? "blade-juice-chain" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-label={bl.enemyAria}
        >
          <div className="blade-enemy-head">
            <h2>{enemyName(enemy.id, bl)}</h2>
            <span className="blade-fight-tag">
              {bl.progress(run.fightIndex + 1, FIGHT_TOTAL)}
            </span>
          </div>
          <div className="blade-tag-row">
            {enemy.variant && enemy.variant !== "normal" ? (
              <span className={`blade-chip blade-variant-${enemy.variant}`}>
                {bl.variants[enemy.variant] ?? enemy.variant}
              </span>
            ) : null}
            {enemy.elite ? (
              <span className="blade-chip blade-chip-elite">{bl.eliteTag}</span>
            ) : null}
            {isNemesis ? (
              <span className="blade-chip blade-chip-warn">{bl.nemesisTag}</span>
            ) : null}
          </div>
          <IntentBadge
            intent={enemy.intent}
            broken={broken}
            brokenLabel={bl.brokenBanner}
            label={intentText(enemy.intent, bl)}
            intentKicker={bl.intentKicker}
            windupSub={bl.intentWindupSub}
          />
          <Bar
            value={enemy.hp}
            max={enemy.maxHp}
            className="blade-bar-hp"
            label="HP"
          />
          <Bar
            value={enemy.poise}
            max={enemy.maxPoise}
            className={`blade-bar-poise${broken ? " blade-bar-poise-broken" : ""}`}
            label={bl.poise}
          />
          <div className="blade-status-row">
            {enemy.statuses.thorns ? (
              <span className="blade-chip">{bl.statusThorns(enemy.statuses.thorns)}</span>
            ) : null}
            {enemy.statuses.armor ? (
              <span className="blade-chip">{bl.statusArmor(enemy.statuses.armor)}</span>
            ) : null}
            {enemy.statuses.poison ? (
              <span className="blade-chip blade-chip-warn">{bl.statusPoison(enemy.statuses.poison)}</span>
            ) : null}
            {broken ? <span className="blade-chip blade-chip-warn">{bl.broken}</span> : null}
            {combat.breakChain > 0 ? (
              <span className="blade-chip blade-chip-chain">
                {bl.breakChain(combat.breakChain)}
              </span>
            ) : null}
          </div>
          <p className="hint blade-enemy-blurb">
            {bl.enemyBlurb[enemy.id as keyof typeof bl.enemyBlurb] ?? ""}
          </p>
          <span className="visually-hidden">maxPoise {maxPoiseLabel}</span>
        </section>

        <section className="blade-player glass" aria-label={bl.playerAria}>
          <div className="blade-player-hud">
            <Bar
              value={player.hp}
              max={player.maxHp}
              className="blade-bar-hp"
              label="HP"
            />
            <div className="blade-player-meta">
              <span>
                {bl.block} <strong>{player.block}</strong>
              </span>
              <span className="blade-ap-wrap">
                <span className="blade-ap-label">{bl.ap}</span>
                <ApPips ap={player.ap} max={player.maxAp} />
                <span className="blade-ap-count">
                  {player.ap}/{player.maxAp}
                </span>
              </span>
              <span className="blade-turn">
                {bl.turn} {combat.turn}
              </span>
            </div>
            {combat.attacksPlayedThisTurn > 0 ? (
              <span className="blade-chip">
                {bl.attacksThisTurn(combat.attacksPlayedThisTurn)}
              </span>
            ) : null}
            {player.statuses.poison ? (
              <span className="blade-chip blade-chip-warn">
                {bl.statusPoison(player.statuses.poison)}
              </span>
            ) : null}
            {run.passives.length > 0 ? (
              <div className="blade-passives">
                {run.passives.map((p) => (
                  <span key={p} className="blade-chip" title={passiveDesc(p, bl)}>
                    {passiveTitle(p, bl)}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {flash ? <p className="blade-flash">{flash}</p> : null}

          <div className="blade-hand-tray">
            <div className="blade-hand blade-hand-fan" role="list">
              <div className="blade-hand-stage">
                {player.hand.map((c, i) => {
                  const n = player.hand.length;
                  const mid = (n - 1) / 2;
                  const angleStep = n <= 5 ? 6.5 : n <= 8 ? 5 : 3.8;
                  const xStep = n <= 5 ? 40 : n <= 8 ? 30 : 24;
                  let angleDeg = (i - mid) * angleStep;
                  const x = (i - mid) * xStep;
                  let y = Math.abs(i - mid) * Math.abs(i - mid) * 2.8;
                  const def = CARDS[c.cardId];
                  const cost = def?.cost ?? 0;
                  const selected = selectedUid === c.uid;
                  const check = canPlayCard(combat, c.uid);
                  const disabled = combat.phase !== "player";
                  if (selected) {
                    y -= 32;
                    angleDeg *= 0.25;
                  }
                  return (
                    <button
                      key={c.uid}
                      type="button"
                      role="listitem"
                      className={[
                        "blade-card",
                        selected ? "blade-card-selected" : "",
                        !check.ok ? "blade-card-disabled" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={{
                        left: "50%",
                        zIndex: selected ? 20 : i + 1,
                        opacity: selected ? 1 : undefined,
                        transform: selected
                          ? `translate(calc(-50% + ${x}px), ${y}px) rotate(${angleDeg}deg) scale(1.08)`
                          : `translate(calc(-50% + ${x}px), ${y}px) rotate(${angleDeg}deg)`,
                      }}
                      disabled={disabled}
                      onClick={() => onSelectCard(c.uid)}
                      aria-pressed={selected}
                    >
                      <span
                        className="blade-card-cost"
                        title={bl.costSpend(cost)}
                        aria-label={bl.costSpend(cost)}
                      >
                        {cost}
                      </span>
                      <strong className="blade-card-name">
                        {cardTitle(c.cardId, bl)}
                      </strong>
                      <span className="blade-card-desc">{cardDesc(c.cardId, bl)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedCard ? (
              <div className="blade-selected-hint hint">
                {cardTitle(selectedCard.cardId, bl)} — {cardDesc(selectedCard.cardId, bl)}
                {selectedPlayable
                  ? ` · ${bl.pressPlay}`
                  : ` (${(() => {
                      const r = canPlayCard(combat, selectedCard.uid);
                      return r.ok ? "" : bl.playFail[r.reason];
                    })()})`}
              </div>
            ) : (
              <p className="hint blade-selected-hint">{bl.handHint}</p>
            )}

            <div className="blade-actions">
              <button
                type="button"
                className="primary"
                disabled={!selectedCard || !selectedPlayable || combat.phase !== "player"}
                onClick={onPlaySelected}
              >
                {bl.playCard}
              </button>
              <button
                type="button"
                className="primary blade-end-turn"
                disabled={combat.phase !== "player"}
                onClick={onEndTurn}
              >
                {bl.endTurn}
              </button>
              <button type="button" className="ghost" onClick={backToSetup}>
                {bl.abandon}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
