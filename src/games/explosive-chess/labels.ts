import {
  COLOR_BLUE,
  COLOR_RED,
  WIN_MODE_ANNIHILATION,
  WIN_MODE_STEPS,
  type MoveResult,
  type PlayerColor,
  type WinMode,
} from "./engine";
import type { HostColor, Seat } from "./online";

export type ExplosiveDict = Record<string, string>;

export function colorLabel(color: PlayerColor, ex: ExplosiveDict): string {
  return color === COLOR_RED ? ex.seatRed : ex.seatBlue;
}

export function seatLabel(seat: Seat, ex: ExplosiveDict): string {
  if (seat === "red") return ex.seatRed;
  if (seat === "blue") return ex.seatBlue;
  return ex.seatSpectator;
}

export function winnerLabel(winner: MoveResult["winner"], ex: ExplosiveDict): string {
  if (winner === "draw") return ex.winnerDraw;
  if (winner === COLOR_RED) return ex.winnerRed;
  if (winner === COLOR_BLUE) return ex.winnerBlue;
  return "";
}

export function winModeLabel(mode: WinMode, ex: ExplosiveDict): string {
  if (mode === WIN_MODE_ANNIHILATION) return ex.annihilation;
  if (mode === WIN_MODE_STEPS) return ex.steps;
  return ex.area;
}

export function youAreLabel(seat: Seat, ex: ExplosiveDict): string {
  if (seat === "red") return ex.youAreRed;
  if (seat === "blue") return ex.youAreBlue;
  return ex.youAreSpectator;
}

export function seatToPlayerColor(seat: HostColor | Seat): PlayerColor | null {
  if (seat === "red") return COLOR_RED;
  if (seat === "blue") return COLOR_BLUE;
  return null;
}

export function formatWinReason(reason: string, ex: Record<string, string>): string {
  if (!reason) return "";
  if (reason === "歼灭对手所有棋子" || reason === "annihilation") return ex.reasonAnnihilation;
  if (reason === "对手投降" || reason === "surrender") return ex.reasonSurrender;
  if (reason.startsWith("双方玩家均已离开") || reason === "room_recycled") {
    return ex.roomRecycled || reason;
  }
  const area = /^率先占据 (\d+) 格$/.exec(reason);
  if (area) return ex.reasonArea.replace("{n}", area[1]!);
  const stepsMore = /^(\d+) 步后占据更多面积 \((\d+) vs (\d+)\)$/.exec(reason);
  if (stepsMore) {
    return ex.reasonStepsMore
      .replace("{n}", stepsMore[1]!)
      .replace("{a}", stepsMore[2]!)
      .replace("{b}", stepsMore[3]!);
  }
  const stepsDraw = /^(\d+) 步后双方面积相同 \((\d+)\)$/.exec(reason);
  if (stepsDraw) {
    return ex.reasonStepsDraw.replace("{n}", stepsDraw[1]!).replace("{a}", stepsDraw[2]!);
  }
  return reason;
}
