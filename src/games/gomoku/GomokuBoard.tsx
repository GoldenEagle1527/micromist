import { useMemo, useState } from "react";
import { SIZE, colOf, rowOf, type GameState, type Player } from "./engine";
import type { GomokuDict } from "./i18n";

const COLS = "ABCDEFGHIJKLMNO";
const STARS = new Set([`${3}-${3}`, `${3}-11`, `${7}-${7}`, `${11}-${3}`, `${11}-11`]);

type Props = {
  state: GameState;
  canPlay: boolean;
  ghostColor?: Player;
  boardAria: string;
  emptyAria: GomokuDict["emptyAria"];
  stoneAria: GomokuDict["stoneAria"];
  black: string;
  white: string;
  onPointClick: (index: number) => void;
};

export function GomokuBoard({
  state,
  canPlay,
  ghostColor,
  boardAria,
  emptyAria,
  stoneAria,
  black,
  white,
  onPointClick,
}: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const lastMove = state.moves.length ? state.moves[state.moves.length - 1] : null;
  const winSet = useMemo(() => new Set(state.winLine ?? []), [state.winLine]);
  const lineNodes = useMemo(() => {
    const n = SIZE;
    const lines: string[] = [];
    for (let i = 0; i < n; i++) {
      const p = (i / (n - 1)) * 100;
      lines.push(`M 0 ${p} H 100`);
      lines.push(`M ${p} 0 V 100`);
    }
    return lines;
  }, []);
  const hoverColor = ghostColor ?? state.turn;

  return (
    <div className="gomoku-board-wrap">
      <div
        className="gomoku-board"
        style={{ ["--gomoku-n" as string]: SIZE }}
        role="grid"
        aria-label={boardAria}
        onMouseLeave={() => setHover(null)}
      >
        <div className="gomoku-inner">
          <svg className="gomoku-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {lineNodes.map((d) => (
              <path key={d} d={d} fill="none" stroke="rgba(40, 24, 8, 0.55)" strokeWidth="0.28" />
            ))}
            {[...STARS].map((key) => {
              const [r, c] = key.split("-").map(Number);
              const x = (c / (SIZE - 1)) * 100;
              const y = (r / (SIZE - 1)) * 100;
              return <circle key={key} cx={x} cy={y} r="0.85" fill="rgba(40, 24, 8, 0.7)" />;
            })}
          </svg>
          <div className="gomoku-points">
            {state.board.map((stone, index) => {
              const r = rowOf(index);
              const c = colOf(index);
              const colLabel = COLS[c] ?? String(c + 1);
              const showGhost = canPlay && hover === index && stone === 0;
              return (
                <button
                  key={index}
                  type="button"
                  role="gridcell"
                  className="gomoku-point"
                  disabled={!canPlay || stone !== 0}
                  aria-label={
                    stone === 0
                      ? emptyAria(r + 1, colLabel)
                      : stoneAria(stone === 1 ? black : white, r + 1, colLabel)
                  }
                  onClick={() => onPointClick(index)}
                  onMouseEnter={() => setHover(index)}
                  onFocus={() => setHover(index)}
                >
                  {stone !== 0 ? (
                    <span
                      className={[
                        "gomoku-stone",
                        stone === 1 ? "is-black" : "is-white",
                        lastMove === index ? "is-last" : "",
                        winSet.has(index) ? "is-win" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    />
                  ) : showGhost ? (
                    <span
                      className={`gomoku-ghost gomoku-stone ${hoverColor === 1 ? "is-black" : "is-white"}`}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
