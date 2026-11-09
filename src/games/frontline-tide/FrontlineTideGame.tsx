import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import "./frontline-tide.css";
import { useLocale } from "../../i18n";
import { AgentInvite } from "./AgentInvite";
import { FrontlineTideRoom } from "./FrontlineTideRoom";
import { swapWouldMatch, resolveSwap } from "./board";
import { placeDefense } from "./build";
import { frontlineTideConfig, swapsForDay } from "./config";
import { completeFrontShift, createGame, enterBuild, enterNight } from "./engine";
import { nextFront, nightEnemyCount, nightGate, pathRowFor, roadGaps, stepNight, washColumnsFor } from "./night";
import type { CSSProperties } from "react";
import type { Cell, DefenseTier, GameState, Pos } from "./types";

type NoteKey =
  | "illegal"
  | "no-swaps"
  | "not-gem"
  | "poor"
  | "occupied"
  | "need-tool"
  | "night"
  | "off-road"
  | "patch"
  | "night-gap"
  | "shear"
  | "placed"
  | "merged";

type Fx =
  | { kind: "nudge"; a: Pos; b: Pos; legal: boolean }
  | { kind: "clear"; board: Cell[][]; cleared: Pos[] }
  | { kind: "pop"; at: Pos };

type Floater = { id: number; text: string; row: number; col: number };
type Banner = { chain: number; total: number };

function same(a: Pos, b: Pos): boolean {
  return a.r === b.r && a.c === b.c;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Swap and merge flourishes. The night clock does not use this. */
function motionMs(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, motionMs(ms));
  });
}

function nudgeName(from: Pos, to: Pos, legal: boolean): string {
  const dr = to.r - from.r;
  const dc = to.c - from.c;
  const prefix = legal ? "ft-nudge" : "ft-deny";
  if (dc === 1) return `${prefix}-e`;
  if (dc === -1) return `${prefix}-w`;
  if (dr === 1) return `${prefix}-s`;
  return `${prefix}-n`;
}

function HeartGlyph({ filled }: { filled: boolean }) {
  return (
    <svg className={filled ? "ft-heart" : "ft-heart off"} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20s-7-4.4-9.2-8.4C1 8.8 2.4 5.5 5.6 5.2 7.6 5 9.2 6.2 12 8.6c2.8-2.4 4.4-3.6 6.4-3.4 3.2.3 4.6 3.6 2.8 6.4C19 15.6 12 20 12 20z" />
    </svg>
  );
}

function spotStyle(row: number, col: number, n: number): CSSProperties {
  return {
    ["--ft-n" as string]: String(n),
    ["--ft-r" as string]: String(row),
    ["--ft-c" as string]: String(col),
  };
}

function centroid(cells: Pos[]): Pos {
  const row = cells.reduce((sum, p) => sum + p.r, 0) / cells.length;
  const col = cells.reduce((sum, p) => sum + p.c, 0) / cells.length;
  return { r: row, c: col };
}

export function FrontlineTideGame() {
  const [searchParams] = useSearchParams();
  const roomCode = (searchParams.get("room") ?? "").trim().toLowerCase();
  if (/^[a-z0-9]+$/.test(roomCode)) return <FrontlineTideRoom roomCode={roomCode} />;
  return <FrontlineTideLocal />;
}

function FrontlineTideLocal() {
  const { t, locale } = useLocale();
  const fl = t.frontline;
  const [game, setGame] = useState<GameState>(() => createGame());
  const [selected, setSelected] = useState<Pos | null>(null);
  const [tool, setTool] = useState(false);
  const [note, setNote] = useState<{ key: NoteKey; tier?: DefenseTier } | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [fx, setFx] = useState<Fx | null>(null);
  const [hud, setHud] = useState<{ points: number; swaps: number } | null>(null);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [pulse, setPulse] = useState(0);
  const [hurt, setHurt] = useState(0);
  const [nightArmed, setNightArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const runId = useRef(0);
  const floaterId = useRef(1);
  const againRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (game.phase !== "night") return;
    const id = window.setInterval(() => {
      if (!mounted.current) return;
      setGame((current) => {
        if (current.phase !== "night") return current;
        const step = stepNight(current);
        if (step.state.hearts < current.hearts) setHurt((n) => n + 1);
        return step.state;
      });
    }, frontlineTideConfig.nightTickMs);
    return () => window.clearInterval(id);
  }, [game.phase]);

  useEffect(() => {
    if (game.phase !== "front_shift") return;
    const id = window.setTimeout(() => {
      setGame((current) => (current.phase === "front_shift" ? completeFrontShift(current) : current));
    }, Math.max(420, frontlineTideConfig.frontShiftMs));
    return () => window.clearTimeout(id);
  }, [game.phase, game.day, game.clock]);

  useEffect(() => {
    if (game.phase === "gameover") againRef.current?.focus();
  }, [game.phase]);

  const board = fx && fx.kind !== "nudge" && fx.kind === "clear" ? fx.board : game.board;
  const pathRow = pathRowFor(board.length, game.day);
  const tideDay = game.phase === "front_shift" ? game.day + 1 : game.day;
  const washCols = washColumnsFor(board.length, game.frontDir, tideDay);
  const upcoming = game.phase === "front_shift" ? nextFront(game) : null;
  const nextWash = upcoming ? washColumnsFor(board.length, upcoming.frontDir, tideDay) : [];
  const scrubbed = new Set(game.scrubbedRoad ?? []);
  const gate = game.phase === "day_build" ? nightGate(game) : "ok";
  const shownPoints = hud?.points ?? game.points;
  const shownSwaps = hud?.swaps ?? game.swapsLeft;
  const wave =
    game.phase === "night" || game.phase === "front_shift"
      ? game.enemies.length + game.spawnLeft
      : nightEnemyCount(game.day);

  const previews = useMemo(() => {
    const marks = new Set<string>();
    if (!selected || game.phase !== "day_match" || busy) return marks;
    const neighbors = [
      { r: selected.r + 1, c: selected.c },
      { r: selected.r - 1, c: selected.c },
      { r: selected.r, c: selected.c + 1 },
      { r: selected.r, c: selected.c - 1 },
    ];
    for (const pos of neighbors) {
      if (swapWouldMatch(game.board, game.bands, selected, pos)) marks.add(`${pos.r},${pos.c}`);
    }
    return marks;
  }, [selected, game.board, game.phase, busy]);

  function pushFloater(text: string, row: number, col: number) {
    const id = floaterId.current++;
    setFloaters((prev) => [...prev, { id, text, row, col }]);
    window.setTimeout(() => {
      setFloaters((prev) => prev.filter((item) => item.id !== id));
    }, motionMs(720) || 500);
  }

  function resetRun() {
    runId.current += 1;
    busyRef.current = false;
    setBusy(false);
    setFx(null);
    setHud(null);
    setBanner(null);
    setSelected(null);
    setTool(false);
    setNote(null);
    setNightArmed(false);
    setFloaters([]);
    setGame(createGame());
  }

  async function playLegal(result: Extract<ReturnType<typeof resolveSwap>, { ok: true }>, a: Pos, b: Pos) {
    const ticket = runId.current;
    busyRef.current = true;
    setBusy(true);
    setSelected(null);
    setNote(null);
    setBanner(null);
    setFx({ kind: "nudge", a, b, legal: true });
    let gained = 0;
    setHud({ points: game.points, swaps: game.swapsLeft - 1 });
    await wait(180);
    if (ticket !== runId.current) return;
    for (const step of result.steps) {
      gained += step.points;
      setFx({ kind: "clear", board: step.boardBeforeClear, cleared: step.cleared });
      setHud({ points: game.points + gained, swaps: game.swapsLeft - 1 });
      setBanner({ chain: step.chain, total: gained });
      const at = centroid(step.cleared);
      pushFloater(`+${step.points}`, at.r, at.c);
      setPulse((n) => n + 1);
      await wait(240);
      if (ticket !== runId.current) return;
      setFx({ kind: "clear", board: step.boardAfter, cleared: [] });
      await wait(150);
      if (ticket !== runId.current) return;
    }
    setFx(null);
    setHud(null);
    setGame(result.state);
    busyRef.current = false;
    setBusy(false);
  }

  async function playDeny(a: Pos, b: Pos) {
    const ticket = runId.current;
    busyRef.current = true;
    setBusy(true);
    setSelected(null);
    setFx({ kind: "nudge", a, b, legal: false });
    setNote({ key: "illegal" });
    await wait(280);
    if (ticket !== runId.current) return;
    setFx(null);
    busyRef.current = false;
    setBusy(false);
  }

  function onBuild(r: number, c: number) {
    if (!tool) {
      setNote({ key: "need-tool" });
      return;
    }
    const result = placeDefense(game, r, c);
    if (!result.ok) {
      const key = result.reason === "poor" ? "poor" : result.reason === "off-road" ? "off-road" : "occupied";
      setNote({ key });
      return;
    }
    const merged = result.merges.at(-1);
    setGame(result.state);
    setNightArmed(false);
    setFx({ kind: "pop", at: { r, c } });
    window.setTimeout(() => setFx(null), motionMs(280) || 160);
    const stillOpen = roadGaps(result.state).length > 0;
    if (merged) {
      setNote(stillOpen ? { key: "patch", tier: merged.tier } : { key: "merged", tier: merged.tier });
      pushFloater(fl.defenseName(merged.tier), r, c);
    } else if (stillOpen && scrubbed.has(c)) {
      setNote({ key: "patch" });
    } else {
      setNote({ key: "placed" });
    }
    setPulse((n) => n + 1);
  }

  function onCell(r: number, c: number) {
    if (busyRef.current) return;
    if (game.phase === "night" || game.phase === "front_shift" || game.phase === "gameover") {
      if (game.phase === "night") setNote({ key: "night" });
      return;
    }
    if (game.phase === "day_build") {
      onBuild(r, c);
      return;
    }
    const cell = game.board[r][c];
    if (!selected) {
      if (!cell || cell.kind !== "gem") {
        setNote({ key: "not-gem" });
        return;
      }
      setSelected({ r, c });
      setNote(null);
      return;
    }
    if (same(selected, { r, c })) {
      setSelected(null);
      return;
    }
    const target = { r, c };
    if (Math.abs(selected.r - r) + Math.abs(selected.c - c) !== 1) {
      setSelected(cell && cell.kind === "gem" ? target : null);
      if (!cell || cell.kind !== "gem") setNote({ key: "not-gem" });
      return;
    }
    const result = resolveSwap(game, selected, target);
    if (!result.ok) {
      if (result.reason === "no-match") void playDeny(selected, target);
      else if (result.reason === "shear") setNote({ key: "shear" });
      else setNote({ key: result.reason === "no-swaps" ? "no-swaps" : "not-gem" });
      if (result.reason !== "no-match") setSelected(null);
      return;
    }
    void playLegal(result, selected, target);
  }

  function goBuild() {
    if (busyRef.current || game.phase !== "day_match") return;
    setGame(enterBuild(game));
    setTool(true);
    setSelected(null);
    setBanner(null);
    setNightArmed(false);
    const open = roadGaps(game);
    const washed = (game.scrubbedRoad ?? []).some((col) => open.some((gap) => gap.c === col));
    setNote(open.length > 0 && (washed || game.day === 1) ? { key: "patch" } : null);
  }

  function goNight() {
    if (busyRef.current || game.phase !== "day_build") return;
    const ready = nightGate(game);
    if (ready === "patch") {
      setNightArmed(false);
      setNote({ key: "patch" });
      return;
    }
    if (ready === "warn" && !nightArmed) {
      setNightArmed(true);
      setNote({ key: "night-gap" });
      return;
    }
    setNightArmed(false);
    setGame(enterNight(game));
    setTool(false);
    setSelected(null);
    setNote(null);
  }

  const phaseLine =
    game.phase === "day_match"
      ? fl.phaseMatch
      : game.phase === "day_build"
        ? fl.phaseBuild
        : game.phase === "night"
          ? `${fl.phaseNight} · ${game.clock}`
          : game.phase === "front_shift" && upcoming
            ? fl.phaseShift(game.frontCol + 1, upcoming.frontCol + 1)
            : fl.phaseNight;

  const noteLine = note
    ? note.key === "merged" && note.tier
      ? fl.noteMerged(fl.defenseName(note.tier))
      : note.key === "illegal"
        ? fl.noteIllegal
        : note.key === "no-swaps"
          ? fl.noteNoSwaps
          : note.key === "not-gem"
            ? fl.noteNotGem
            : note.key === "poor"
              ? fl.notePoor
              : note.key === "occupied"
                ? fl.noteOccupied
                : note.key === "need-tool"
                  ? fl.noteNeedTool
                  : note.key === "night"
                    ? fl.noteNight
                    : note.key === "off-road"
                      ? fl.noteOffRoad
                      : note.key === "patch"
                        ? `${note.tier ? `${fl.noteMerged(fl.defenseName(note.tier))} ` : ""}${fl.notePatchRoad}`
                        : note.key === "night-gap"
                          ? fl.noteNightGap
                          : note.key === "shear"
                            ? fl.noteShear
                            : fl.notePlaced
    : null;

  const n = board.length;
  const locked = busy || game.phase === "night" || game.phase === "front_shift" || game.phase === "gameover";

  return (
    <div className={`frontline-tide${game.phase === "day_build" ? " ft-build" : ""}`} data-phase={game.phase}>
      <p className="ft-live" aria-live="polite">
        {phaseLine}
        {game.day === 1 ? ` ${fl.teachBite(pathRow + 1)} ${fl.teachWash}` : ""}
        {noteLine ? ` ${noteLine}` : ""}
      </p>
      <header className="ft-hud">
        <div className="ft-hud-top">
          <span className="ft-day">{fl.day(game.day)}</span>
          <span className="ft-phase">{phaseLine}</span>
        </div>
        <div className={`ft-stats${hurt ? " ft-hurt" : ""}`} key={hurt}>
          <span className="ft-stat" aria-label={fl.hearts(game.hearts, frontlineTideConfig.hearts)}>
            <span className="ft-hearts" aria-hidden="true">
              {Array.from({ length: frontlineTideConfig.hearts }, (_, i) => (
                <HeartGlyph key={i} filled={i < game.hearts} />
              ))}
            </span>
            <strong>{game.hearts}</strong>
          </span>
          <span className="ft-stat">
            <span className="ft-pips" aria-hidden="true">
              {Array.from({ length: swapsForDay(game.day) }, (_, i) => (
                <i key={i} className={i < shownSwaps ? "on" : ""} />
              ))}
            </span>
            <strong>{fl.swaps(shownSwaps)}</strong>
          </span>
          <span className={`ft-stat ft-points${pulse ? " pulse" : ""}`} key={pulse}>
            <strong>{fl.points(shownPoints)}</strong>
          </span>
          <span className="ft-stat ft-road-stat">
            <strong>{fl.roadStat(pathRow + 1)}</strong>
          </span>
          <span className="ft-stat">
            <strong>{game.frontDir < 0 ? fl.dirShore : fl.dirSea}</strong>
            <span>{fl.wash(washCols.map((col) => col + 1))}</span>
          </span>
          <span className="ft-stat">
            <strong>{game.phase === "night" ? fl.remaining(wave) : fl.tonight(wave)}</strong>
          </span>
        </div>
      </header>
      <div className="ft-rules">
        {game.day === 1 ? (
          <p className="ft-teach">
            {fl.teachBite(pathRow + 1)} {fl.teachWash}
          </p>
        ) : null}
        {game.day >= 10 ? <p className={game.day === 10 ? "ft-milestone" : ""}>{fl.ruleDay10}</p> : null}
        {game.day >= 25 ? <p className={game.day === 25 ? "ft-milestone" : ""}>{fl.ruleDay25}</p> : null}
        {game.day >= 50 ? <p className={game.day === 50 ? "ft-milestone" : ""}>{fl.ruleDay50(pathRow + 1)}</p> : null}
        <p>{fl.ruleRoad}</p>
        <p>{fl.ruleMerge}</p>
        <p>{fl.terrainRule}</p>
        <p className="ft-legend">
          <span className="ft-swatch shoal">{fl.terrainShoal}</span>
          <span className="ft-swatch reef">{fl.terrainReef}</span>
          <span className="ft-swatch rip">{fl.terrainRip}</span>
        </p>
        {banner ? <p className="ft-note">{fl.chain(banner.chain, banner.total)}</p> : null}
        {noteLine ? <p className="ft-note">{noteLine}</p> : null}
      </div>
      <div className="ft-stage">
        <div className="ft-shore">{fl.shore}</div>
        <div className="ft-board-wrap">
          <div className="ft-board" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
            {board.map((row, r) =>
              row.map((cell, c) => {
                const classes = ["ft-cell"];
                classes.push(`ft-band-${game.bands[c] ?? "shoal"}`);
                if (r === pathRow) classes.push("ft-road");
                if (game.phase === "day_build" && r !== pathRow) classes.push("ft-offroad");
                if (r === pathRow && cell.kind !== "defense" && (game.phase === "day_build" || scrubbed.has(c))) {
                  classes.push("ft-road-gap");
                }
                if (r === pathRow && scrubbed.has(c) && cell.kind !== "defense") classes.push("ft-road-scrub");
                if (washCols.includes(c)) classes.push("ft-front");
                if (c === n - 1) classes.push("ft-sea-edge");
                if (nextWash.includes(c)) classes.push("ft-front-next");
                if (game.phase === "night" && c > game.frontCol && r !== pathRow) classes.push("ft-flood");
                if (selected && same(selected, { r, c })) classes.push("ft-selected");
                if (previews.has(`${r},${c}`)) classes.push("ft-preview");
                if (fx?.kind === "nudge") {
                  if (same(fx.a, { r, c })) classes.push(nudgeName(fx.a, fx.b, fx.legal));
                  if (same(fx.b, { r, c })) classes.push(nudgeName(fx.b, fx.a, fx.legal));
                }
                if (fx?.kind === "clear" && fx.cleared.some((p) => p.r === r && p.c === c)) classes.push("ft-clear");
                if (fx?.kind === "pop" && fx.at.r === r && fx.at.c === c) classes.push("ft-pop");
                const label =
                  cell.kind === "gem"
                    ? fl.cellAria(fl.colorName(cell.color), r + 1, c + 1)
                    : cell.kind === "defense"
                      ? fl.cellAria(`${fl.defenseName(cell.tier)} ${cell.hp}`, r + 1, c + 1)
                      : fl.emptyAria(r + 1, c + 1);
                return (
                  <button
                    key={`${r}-${c}`}
                    type="button"
                    className={classes.join(" ")}
                    disabled={locked}
                    aria-pressed={selected ? same(selected, { r, c }) : undefined}
                    aria-label={label}
                    onClick={() => onCell(r, c)}
                  >
                    {washCols.includes(c) && r === 0 ? <span className="ft-flag">{fl.flag}</span> : null}
                    {r === pathRow && c === n - 1 ? <span className="ft-road-flag">←</span> : null}
                    {cell.kind === "gem" ? (
                      <span className="ft-piece">
                        <i className="ft-gem" data-color={cell.color} />
                      </span>
                    ) : null}
                    {cell.kind === "defense" ? (
                      <span className="ft-piece">
                        <i className="ft-defense" data-tier={cell.tier} />
                        <i className="ft-hp" aria-hidden="true">
                          <span style={{ width: `${(Math.max(0, cell.hp) / cell.maxHp) * 100}%` }} />
                        </i>
                      </span>
                    ) : null}
                    {cell.kind === "empty" ? <i className="ft-hole" /> : null}
                  </button>
                );
              }),
            )}
          </div>
          <div className="ft-actors">
            {game.enemies.map((enemy) => (
              <div
                key={enemy.id}
                className={enemy.rusher ? "ft-enemy ft-rusher" : "ft-enemy"}
                style={spotStyle(pathRow, enemy.col, n)}
                role="img"
                aria-label={fl.enemyAria(enemy.hp)}
              >
                <i className="ft-enemy-body" />
                <i className="ft-enemy-hp" aria-hidden="true">
                  <span style={{ width: `${(Math.max(0, enemy.hp) / enemy.maxHp) * 100}%` }} />
                </i>
              </div>
            ))}
            {floaters.map((floater) => (
              <span key={floater.id} className="ft-floater" style={spotStyle(floater.row, floater.col, n)}>
                {floater.text}
              </span>
            ))}
          </div>
        </div>
        <div className="ft-sea">{fl.sea}</div>
      </div>
      <div className="ft-actions">
        {game.phase === "day_match" ? (
          <button type="button" className={`primary${shownSwaps === 0 ? " ft-urge" : ""}`} onClick={goBuild} disabled={busy}>
            {fl.toBuild}
          </button>
        ) : null}
        {game.phase === "day_build" ? (
          <>
            <button
              type="button"
              className={tool ? "primary" : "ghost"}
              aria-pressed={tool}
              onClick={() => {
                setTool(true);
                setNote(null);
              }}
            >
              {fl.place(frontlineTideConfig.t1Cost)}
            </button>
            <button
              type="button"
              className={gate === "patch" ? "ghost" : nightArmed ? "primary ft-urge" : "primary"}
              onClick={goNight}
            >
              {nightArmed ? fl.confirmNight : fl.toNight}
            </button>
          </>
        ) : null}
        <AgentInvite
          line={fl.agentInviteLine}
          copiedLabel={fl.agentInviteCopied}
          failedLabel={fl.agentInviteFailed}
          locale={locale === "zh" ? "zh" : "en"}
        />
      </div>
      {game.phase === "gameover" ? (
        <div className="ft-over">
          <div className="panel" role="dialog" aria-labelledby="ft-over-title">
            <h2 id="ft-over-title">{fl.overTitle}</h2>
            <p className="survived">{fl.survived(game.day)}</p>
            <p>{fl.overHint}</p>
            <button ref={againRef} type="button" className="primary" onClick={resetRun}>
              {fl.playAgain}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
