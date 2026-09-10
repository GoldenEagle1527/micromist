import { CARDS, FUSION_RECIPES, SECRET_FUSION_RECIPES } from "./cards";
import { ENEMIES } from "./enemies";
import { canPlayCard, currentPathOptions, restHealAmount } from "./engine";
import type { CardInstance, CombatState, RunState, SecretFusionRecipe } from "./types";
import {
  type BladeCopy,
  cardDesc,
  cardTitle,
  enemyName,
  passiveDesc,
  passiveTitle,
} from "./copy";
import {
  ApPips,
  Bar,
  HighlightsPanel,
  IntentBadge,
  RuleBanner,
  intentText,
} from "./widgets";

export type RestMode = "menu" | "remove" | "fuse";

export function SetupScreen({
  bl,
  fightTotal,
  onStart,
}: {
  bl: BladeCopy;
  fightTotal: number;
  onStart: () => void;
}) {
  return (
      <div className="blade-break blade-setup">
        <div className="panel">
          <h2>{bl.setupTitle}</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            {bl.setupHint(fightTotal)}
          </p>
          <ul className="blade-rules">
            <li>{bl.ruleAp}</li>
            <li>{bl.rulePoise}</li>
            <li>{bl.ruleRun(fightTotal)}</li>
            <li>{bl.ruleFusion}</li>
          </ul>
          <div className="row">
            <button type="button" className="primary" onClick={onStart}>
              {bl.start}
            </button>
          </div>
        </div>
      </div>
  );
}

export function EndScreen({
  run,
  bl,
  fightTotal,
  onPlayAgain,
  onBack,
}: {
  run: RunState;
  bl: BladeCopy;
  fightTotal: number;
  onPlayAgain: () => void;
  onBack: () => void;
}) {
  return (
      <div className="blade-break blade-end">
        <div className="panel">
          <h2>{run.phase === "runWon" ? bl.runWonTitle : bl.runLostTitle}</h2>
          <p className="hint">
            {run.phase === "runWon"
              ? bl.runWonBody(fightTotal)
              : bl.runLostBody}
          </p>
          <RuleBanner ruleId={run.ruleId} bl={bl} />
          <HighlightsPanel run={run} bl={bl} />
          <div className="row">
            <button type="button" className="primary" onClick={onPlayAgain}>
              {bl.playAgain}
            </button>
            <button type="button" className="ghost" onClick={onBack}>
              {bl.backSetup}
            </button>
          </div>
        </div>
      </div>
  );
}

export function PathScreen({
  run,
  bl,
  fightTotal,
  flash,
  onChoosePath,
}: {
  run: RunState;
  bl: BladeCopy;
  fightTotal: number;
  flash: string | null;
  onChoosePath: (id: string) => void;
}) {
  const opts = currentPathOptions(run);
  return (
      <div className="blade-break blade-path">
        <div className="panel">
          <RuleBanner ruleId={run.ruleId} bl={bl} />
          <h2>{bl.pathTitle}</h2>
          <p className="hint">{bl.pathHint}</p>
          <p className="hint blade-progress">
            {bl.progress(run.fightIndex, fightTotal)}
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

export function EventScreen({
  run,
  bl,
  flash,
  onEventChoice,
}: {
  run: RunState;
  bl: BladeCopy;
  flash: string | null;
  onEventChoice: (i: number) => void;
}) {
  const eid = run.eventId!;
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

export function RewardScreen({
  run,
  bl,
  fightTotal,
  flash,
  onPickReward,
}: {
  run: RunState;
  bl: BladeCopy;
  fightTotal: number;
  flash: string | null;
  onPickReward: (i: number) => void;
}) {
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
            {bl.progress(run.fightIndex, fightTotal)}
          </p>
        </div>
      </div>
  );
}

export function RestScreen({
  run,
  bl,
  flash,
  restMode,
  fusePick,
  secretRecipe,
  onHeal,
  onRemove,
  onFuse,
  onSkip,
  onRestMode,
  onFuseMode,
  onRestMenu,
}: {
  run: RunState;
  bl: BladeCopy;
  flash: string | null;
  restMode: RestMode;
  fusePick: string[];
  secretRecipe: SecretFusionRecipe | null;
  onHeal: () => void;
  onRemove: (uid: string) => void;
  onFuse: (uid: string) => void;
  onSkip: () => void;
  onRestMode: (mode: RestMode) => void;
  onFuseMode: () => void;
  onRestMenu: () => void;
}) {
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
                  onClick={onHeal}
                  disabled={forgeLocked}
                >
                  {bl.restHeal(restHealAmount(run))}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => onRestMode("remove")}
                  disabled={run.deck.length <= 5}
                >
                  {bl.restRemove}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => onFuseMode()}
                  disabled={run.deck.length <= 5}
                >
                  {bl.restFuse}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={onSkip}
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
                    onClick={() => onRemove(c.uid)}
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
                  onClick={() => onRestMode("menu")}
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
                      onClick={() => onFuse(c.uid)}
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
                  onClick={() => onRestMenu()}
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

export function CombatScreen({
  run,
  combat,
  bl,
  fightTotal,
  flash,
  juice,
  selectedUid,
  selectedCard,
  selectedPlayable,
  onSelectCard,
  onPlaySelected,
  onEndTurn,
  onAbandon,
}: {
  run: RunState;
  combat: CombatState;
  bl: BladeCopy;
  fightTotal: number;
  flash: string | null;
  juice: "hit" | "break" | "chain" | null;
  selectedUid: string | null;
  selectedCard: CardInstance | null;
  selectedPlayable: boolean;
  onSelectCard: (uid: string) => void;
  onPlaySelected: () => void;
  onEndTurn: () => void;
  onAbandon: () => void;
}) {
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
              {bl.progress(run.fightIndex + 1, fightTotal)}
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
              <button type="button" className="ghost" onClick={onAbandon}>
                {bl.abandon}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
