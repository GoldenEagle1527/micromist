import { useCallback, useEffect, useMemo, useState } from "react";
import "./blade-break.css";
import { useLocale } from "../../i18n";
import { useLocalGamePersist } from "../local-persist";
import { getSecretRecipe } from "./cards";
import { FIGHT_COUNT } from "./enemies";
import { cardTitle } from "./copy";
import {
  CombatScreen,
  EndScreen,
  EventScreen,
  PathScreen,
  RestScreen,
  RewardScreen,
  SetupScreen,
  type RestMode,
} from "./panels";
import {
  SLUG,
  migrateBladeBreakSessionOnce,
  normalizeRun,
} from "./persist";
import {
  advanceAfterCombatLoss,
  advanceAfterCombatWin,
  canPlayCard,
  choosePath,
  createRun,
  endTurn,
  pickReward,
  playCard,
  resolveEvent,
  restFuse,
  restHeal,
  restRemoveCard,
  skipRest,
} from "./engine";
import type { RunState } from "./types";

type Screen = "setup" | "run";

const FIGHT_TOTAL = FIGHT_COUNT;

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
        nextRun = advanceAfterCombatWin({ ...base, combat: nextCombat });
        setFlash(bl.fightWon);
      } else if (nextCombat.phase === "lost") {
        nextRun = advanceAfterCombatLoss({ ...base, combat: nextCombat });
        setFlash(bl.fightLost);
      } else {
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

  if (screen === "setup") {
    return (
      <SetupScreen bl={bl} fightTotal={FIGHT_TOTAL} onStart={startRun} />
    );
  }

  if (!run) return null;

  if (run.phase === "runWon" || run.phase === "runLost") {
    return (
      <EndScreen
        run={run}
        bl={bl}
        fightTotal={FIGHT_TOTAL}
        onPlayAgain={startRun}
        onBack={backToSetup}
      />
    );
  }

  if (run.phase === "pathChoice") {
    return (
      <PathScreen
        run={run}
        bl={bl}
        fightTotal={FIGHT_TOTAL}
        flash={flash}
        onChoosePath={onChoosePath}
      />
    );
  }

  if (run.phase === "event" && run.eventId) {
    return (
      <EventScreen
        run={run}
        bl={bl}
        flash={flash}
        onEventChoice={onEventChoice}
      />
    );
  }

  if (run.phase === "reward") {
    return (
      <RewardScreen
        run={run}
        bl={bl}
        fightTotal={FIGHT_TOTAL}
        flash={flash}
        onPickReward={onPickReward}
      />
    );
  }

  if (run.phase === "rest") {
    return (
      <RestScreen
        run={run}
        bl={bl}
        flash={flash}
        restMode={restMode}
        fusePick={fusePick}
        secretRecipe={secretRecipe}
        onHeal={onRestHeal}
        onRemove={onRestRemove}
        onFuse={onFusePick}
        onSkip={() => setRunAndClearSel(skipRest(run))}
        onRestMode={(mode) => {
          setRestMode(mode);
          if (mode !== "menu") setFlash(null);
        }}
        onFuseMode={() => {
          setRestMode("fuse");
          setFusePick([]);
          setFlash(null);
        }}
        onRestMenu={() => {
          setRestMode("menu");
          setFusePick([]);
          setFlash(null);
        }}
      />
    );
  }

  if (!combat) return null;

  return (
    <CombatScreen
      run={run}
      combat={combat}
      bl={bl}
      fightTotal={FIGHT_TOTAL}
      flash={flash}
      juice={juice}
      selectedUid={selectedUid}
      selectedCard={selectedCard}
      selectedPlayable={selectedPlayable}
      onSelectCard={onSelectCard}
      onPlaySelected={onPlaySelected}
      onEndTurn={onEndTurn}
      onAbandon={backToSetup}
    />
  );
}
