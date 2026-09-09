import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "../../i18n";
import { CARDS, FUSION_RECIPES } from "./cards";
import { FIGHT_COUNT, ENEMIES } from "./enemies";
import {
  advanceAfterCombatLoss,
  advanceAfterCombatWin,
  canPlayCard,
  createRun,
  endTurn,
  intentLabelKey,
  pickReward,
  playCard,
  restFuse,
  restHeal,
  restRemoveCard,
  skipRest,
} from "./engine";
import type { CardId, CardInstance, Intent, PassiveId, RunState } from "./types";

type Screen = "setup" | "run";
type RestMode = "menu" | "remove" | "fuse";

const STORAGE_KEY = "micromist.blade-break.run";
const FIGHT_TOTAL = FIGHT_COUNT;

function saveRun(run: RunState | null) {
  try {
    if (!run) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(run));
  } catch {
    /* ignore */
  }
}

function loadRun(): RunState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RunState;
    // Migrate older saves missing attacksPlayedThisTurn
    if (parsed.combat && parsed.combat.attacksPlayedThisTurn == null) {
      parsed.combat.attacksPlayedThisTurn = 0;
    }
    return parsed;
  } catch {
    return null;
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

export function BladeBreakGame() {
  const { t } = useLocale();
  const bl = t.blade;

  const [screen, setScreen] = useState<Screen>("setup");
  const [run, setRun] = useState<RunState | null>(null);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [restMode, setRestMode] = useState<RestMode>("menu");
  const [fusePick, setFusePick] = useState<string[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [juice, setJuice] = useState<"hit" | "break" | null>(null);

  useEffect(() => {
    const saved = loadRun();
    if (saved && saved.phase !== "runWon" && saved.phase !== "runLost") {
      setRun(saved);
      setScreen("run");
    }
  }, []);

  useEffect(() => {
    if (screen === "run" && run) saveRun(run);
  }, [run, screen]);

  useEffect(() => {
    if (!juice) return;
    const id = window.setTimeout(() => setJuice(null), 420);
    return () => window.clearTimeout(id);
  }, [juice]);

  const setRunAndClearSel = useCallback((r: RunState | null) => {
    setRun(r);
    setSelectedUid(null);
    setRestMode("menu");
    setFusePick([]);
  }, []);

  const startRun = useCallback(() => {
    const r = createRun();
    setRunAndClearSel(r);
    setScreen("run");
    setFlash(null);
    setJuice(null);
    saveRun(r);
  }, [setRunAndClearSel]);

  const backToSetup = useCallback(() => {
    setScreen("setup");
    setRunAndClearSel(null);
    saveRun(null);
    setFlash(null);
    setJuice(null);
  }, [setRunAndClearSel]);

  const applyCombatResult = useCallback(
    (nextCombat: NonNullable<RunState["combat"]>, base: RunState) => {
      let nextRun: RunState = { ...base, combat: nextCombat };
      const log = nextCombat.log;
      if (log.includes("poise_break")) {
        setJuice("break");
        setFlash(bl.staggerFlash);
      } else if (log.includes("hit")) {
        setJuice("hit");
      }
      if (nextCombat.phase === "won") {
        nextRun = advanceAfterCombatWin(nextRun);
        setFlash(bl.fightWon);
      } else if (nextCombat.phase === "lost") {
        nextRun = advanceAfterCombatLoss(nextRun);
        setFlash(bl.fightLost);
      } else if (log.includes("enemy_stunned")) {
        setFlash(bl.staggerFlash);
      }
      setRunAndClearSel(nextRun);
    },
    [bl, setRunAndClearSel],
  );

  const combat = run?.combat ?? null;

  const onSelectCard = useCallback(
    (uid: string) => {
      if (!combat || combat.phase !== "player" || !run) return;
      if (selectedUid === uid) {
        const result = playCard(combat, uid, Math.random, run.passives);
        if (!result.ok) {
          setFlash(bl.playFail[result.reason] ?? bl.playFail.wrong_phase);
          return;
        }
        applyCombatResult(result.state, run);
        return;
      }
      setSelectedUid(uid);
      setFlash(null);
    },
    [combat, selectedUid, run, bl, applyCombatResult],
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
      setFlash(bl.fuseSuccess(cardTitle(result.resultId, bl)));
    },
    [run, bl, fusePick, setRunAndClearSel],
  );

  const selectedCard = useMemo(() => {
    if (!combat || !selectedUid) return null;
    return combat.player.hand.find((c) => c.uid === selectedUid) ?? null;
  }, [combat, selectedUid]);

  const selectedPlayable = useMemo(() => {
    if (!combat || !selectedUid) return false;
    return canPlayCard(combat, selectedUid).ok;
  }, [combat, selectedUid]);

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

  // ——— Reward ———
  if (run.phase === "reward") {
    return (
      <div className="blade-break blade-reward">
        <div className="panel">
          <h2>{bl.rewardTitle}</h2>
          <p className="hint">{bl.rewardHint}</p>
          <div className="blade-reward-grid">
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
                    <strong>{cardTitle(opt.cardId, bl)}</strong>
                    <span className="blade-reward-meta">
                      {bl.costSpend(CARDS[opt.cardId].cost)}
                    </span>
                    <p>{cardDesc(opt.cardId, bl)}</p>
                  </>
                ) : (
                  <>
                    <span className="blade-reward-kind">{bl.rewardPassive}</span>
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
    return (
      <div className="blade-break blade-rest">
        <div className="panel">
          <h2>{bl.restTitle}</h2>
          <p className="hint">{bl.restHint}</p>
          <p className="blade-hp-line">
            HP {run.hp}/{run.maxHp}
          </p>
          {flash ? <p className="blade-flash">{flash}</p> : null}
          {restMode === "menu" ? (
            <>
              <div className="row blade-rest-actions">
                <button type="button" className="primary" onClick={onRestHeal}>
                  {bl.restHeal(Math.max(1, Math.floor(run.maxHp * 0.3)))}
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
                  disabled={run.deck.length < 2}
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
              <p className="hint">
                {bl.fusePicked(fusePick.length)}
              </p>
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

  return (
    <div className="blade-break blade-duel">
      <div className="blade-duel-layout">
        <section
          className={[
            "blade-enemy glass",
            juice === "hit" ? "blade-juice-hit" : "",
            juice === "break" ? "blade-juice-break" : "",
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
          </div>
          <p className="hint blade-enemy-blurb">
            {bl.enemyBlurb[enemy.id as keyof typeof bl.enemyBlurb] ?? ""}
          </p>
          <span className="visually-hidden">
            maxPoise {enemyDef.maxPoise}
          </span>
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

          <div className="blade-hand" role="list">
            {player.hand.map((c) => {
              const def = CARDS[c.cardId];
              const selected = selectedUid === c.uid;
              const check = canPlayCard(combat, c.uid);
              const disabled = combat.phase !== "player";
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
                  disabled={disabled}
                  onClick={() => onSelectCard(c.uid)}
                  aria-pressed={selected}
                >
                  <span
                    className="blade-card-cost"
                    title={bl.costSpend(def.cost)}
                    aria-label={bl.costSpend(def.cost)}
                  >
                    {def.cost}
                  </span>
                  <strong className="blade-card-name">
                    {cardTitle(c.cardId, bl)}
                  </strong>
                  <span className="blade-card-desc">{cardDesc(c.cardId, bl)}</span>
                </button>
              );
            })}
          </div>

          {selectedCard ? (
            <div className="blade-selected-hint hint">
              {cardTitle(selectedCard.cardId, bl)} — {cardDesc(selectedCard.cardId, bl)}
              {selectedPlayable
                ? ` · ${bl.tapAgain}`
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
        </section>
      </div>
    </div>
  );
}
