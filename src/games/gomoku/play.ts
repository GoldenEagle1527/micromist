import type {
  GameAction,
  GamePlayModule,
  GameSession,
  GameSnapshot,
  ParamField,
  SeatChip,
  SessionContext,
  ShellAction,
} from "../../platform/play";
import { createGridBoard, type GridBoard, type GridCellPaint } from "../../platform/play/grid-board";
import { clearLocalProgress, loadLocalProgress, saveLocalProgress } from "../local-persist";
import { chooseMove, type Difficulty } from "./ai";
import {
  SIZE,
  emptyState,
  isOver,
  isValidState,
  play,
  undo,
  type GameState,
  type Player,
} from "./engine";
import { gomokuEn, gomokuZh, type GomokuDict } from "./i18n";
import {
  GomokuOnlineClient,
  generateRoomCode,
  getOrCreatePlayerId,
  shareUrl,
  type Phase,
  type RoomPlayer,
  type Seat,
} from "./online";
import "./gomoku.css";

type Opponent = "ai" | "local" | "online";

type Settings = {
  opponent: Opponent;
  difficulty: Difficulty;
  humanColor: Player;
};

type Persist = {
  screen: "playing";
  settings: Settings;
  state: GameState;
};

type You = {
  playerId: string;
  seat: Seat;
};

const SLUG = "gomoku";
const DEFAULT_SETTINGS: Settings = {
  opponent: "ai",
  difficulty: "normal",
  humanColor: 1,
};

function dict(locale: SessionContext["locale"]): GomokuDict {
  return locale === "zh" ? gomokuZh : gomokuEn;
}

function asDifficulty(value: string): Difficulty {
  if (value === "easy" || value === "hard") return value;
  return "normal";
}

function asOpponent(value: string): Opponent {
  if (value === "local" || value === "online") return value;
  return "ai";
}

function seatToPlayer(seat: Seat): Player | null {
  if (seat === "red") return 1;
  if (seat === "blue") return 2;
  return null;
}

function occupant(players: RoomPlayer[], seat: "red" | "blue"): RoomPlayer | undefined {
  return players.find((p) => p.seat === seat);
}

class GomokuSession implements GameSession {
  private listeners = new Set<() => void>();
  private phase: "menu" | "play" = "menu";
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private state: GameState = emptyState();
  private thinking = false;
  private aiTimer: number | null = null;
  private boardHost: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private grid: GridBoard | null = null;

  private roomCode = "";
  private client: GomokuOnlineClient | null = null;
  private you: You | null = null;
  private roomPhase: Phase | "connecting" = "connecting";
  private players: RoomPlayer[] = [];
  private roomError = "";
  private roomClosed = false;
  private peerHint = "";

  private readonly ctx: SessionContext;

  constructor(ctx: SessionContext) {
    this.ctx = ctx;
    const room = (ctx.search.get("room") ?? "").trim().toLowerCase();
    if (/^[a-z0-9]+$/.test(room)) {
      this.enterRoom(room);
      return;
    }
    this.hydrate();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  syncContext(): void {
    const room = (this.ctx.search.get("room") ?? "").trim().toLowerCase();
    const valid = /^[a-z0-9]+$/.test(room);
    if (valid && room !== this.roomCode) {
      this.leaveRoom(false);
      this.enterRoom(room);
      return;
    }
    if (!valid && this.roomCode) {
      this.leaveRoom(false);
    }
    this.emit();
  }

  destroy(): void {
    this.clearAi();
    this.leaveRoom(false);
    this.destroyBoard();
    this.listeners.clear();
  }

  choose(itemId: string): void {
    if (itemId === "start") this.startLocal();
  }

  back(): void {
    if (this.roomCode) {
      this.leaveRoom(true);
      return;
    }
    this.goMenu(true);
  }

  setParam(id: string, value: string | number): void {
    if (this.phase !== "menu" || this.roomCode) return;
    const text = String(value);
    if (id === "mode") this.settings = { ...this.settings, opponent: asOpponent(text) };
    if (id === "difficulty") this.settings = { ...this.settings, difficulty: asDifficulty(text) };
    if (id === "humanColor") this.settings = { ...this.settings, humanColor: text === "2" ? 2 : 1 };
    this.emit();
  }

  dispatch(action: GameAction): void {
    const id = action.type === "ui" && typeof action.id === "string" ? action.id : action.type;
    if (id === "start") {
      if (this.settings.opponent === "online") this.createRoom();
      else this.startLocal();
      return;
    }
    if (id === "create-room") {
      this.createRoom();
      return;
    }
    if (id === "undo") {
      this.onUndo();
      return;
    }
    if (id === "restart") {
      this.doRestart();
      return;
    }
    if (id === "setup") {
      this.goMenu(true);
      return;
    }
    if (id === "surrender") {
      this.client?.surrender();
      return;
    }
    if (id === "rematch") {
      this.client?.rematch();
      return;
    }
    if (id === "leave-room") {
      this.leaveRoom(true);
      return;
    }
    if (id === "dismiss-dialog") {
      return;
    }
    if (action.type === "claim-seat" && (action.id === "red" || action.id === "blue")) {
      this.client?.claimSeat(action.id);
      return;
    }
    if (action.type === "move" && typeof action.index === "number") {
      this.onPointClick(action.index);
    }
  }

  bindBoard(host: HTMLElement) {
    this.destroyBoard();
    this.boardHost = host;
    host.replaceChildren();
    const canvas = document.createElement("canvas");
    host.append(canvas);
    this.canvas = canvas;
    const session = this;
    this.grid = createGridBoard(canvas, {
      get size() {
        return session.boardState()?.size ?? SIZE;
      },
      paintCell: (row, col) => session.paintCell(row, col),
      isHoverValid: (row, col) => session.canPlayIndex(row * (session.boardState()?.size ?? SIZE) + col),
    });
    this.hookCanvas();
    this.paint();
    return {
      destroy: () => {
        if (this.boardHost === host) this.destroyBoard();
      },
    };
  }

  snapshot(): GameSnapshot {
    const g = dict(this.ctx.locale);
    if (this.roomCode) return this.roomSnapshot(g);
    if (this.phase === "menu") return this.menuSnapshot(g);
    return this.playSnapshot(g);
  }

  private menuSnapshot(g: GomokuDict): GameSnapshot {
    const fields: ParamField[] = [
      {
        id: "mode",
        label: g.mode,
        type: "select",
        value: this.settings.opponent,
        options: [
          { value: "ai", label: g.vsAi },
          { value: "local", label: g.hotseat },
          { value: "online", label: g.online },
        ],
      },
    ];
    if (this.settings.opponent === "ai") {
      fields.push(
        {
          id: "difficulty",
          label: g.difficulty,
          type: "select",
          value: this.settings.difficulty,
          options: [
            { value: "easy", label: g.easy },
            { value: "normal", label: g.normal },
            { value: "hard", label: g.hard },
          ],
        },
        {
          id: "humanColor",
          label: g.yourColor,
          type: "select",
          value: String(this.settings.humanColor),
          options: [
            { value: "1", label: g.playBlack },
            { value: "2", label: g.playWhite },
          ],
        },
      );
    }
    const online = this.settings.opponent === "online";
    return {
      phase: "menu",
      title: g.setupTitle,
      hint: g.setupHint,
      params: { fields },
      actions: [
        {
          id: online ? "create-room" : "start",
          label: online ? g.createRoom : g.start,
          kind: "primary",
        },
      ],
    };
  }

  private playSnapshot(g: GomokuDict): GameSnapshot {
    const confirm = (title: string, body: string) => ({
      title,
      body,
      ok: g.confirmOk,
      cancel: g.confirmCancel,
    });
    const actions: ShellAction[] = [
      {
        id: "undo",
        label: g.undo,
        kind: "ghost",
        disabled: this.thinking || this.state.moves.length === 0,
      },
      {
        id: "restart",
        label: g.restart,
        kind: "ghost",
        disabled: this.thinking,
        confirm: confirm(g.confirmRestartTitle, g.confirmRestartBody),
      },
      {
        id: "setup",
        label: g.backSetup,
        kind: "ghost",
        disabled: this.thinking,
        confirm: confirm(g.confirmSetupTitle, g.confirmSetupBody),
      },
    ];
    return {
      phase: "play",
      hud: [{ id: "status", value: this.localStatus(g) }],
      actions,
    };
  }

  private roomSnapshot(g: GomokuDict): GameSnapshot {
    const myColor = this.you ? seatToPlayer(this.you.seat) : null;
    const askedRematch = Boolean(
      this.you && this.players.find((p) => p.playerId === this.you?.playerId)?.rematch,
    );
    const playing = this.roomPhase === "playing" && this.state && !isOver(this.state);
    const over = this.roomPhase === "over" || (this.state != null && isOver(this.state));
    const actions: ShellAction[] = [];
    if (playing && myColor) {
      actions.push({ id: "surrender", label: g.resign, kind: "ghost" });
    }
    if (over && myColor) {
      actions.push({
        id: "rematch",
        label: askedRematch ? g.rematchWaiting : g.rematch,
        kind: "primary",
        disabled: askedRematch,
      });
    }
    actions.push({ id: "leave-room", label: g.leaveRoom, kind: "ghost" });
    const showBoard = this.state != null;
    return {
      phase: showBoard ? "play" : "menu",
      title: showBoard ? undefined : g.roomCodeLabel(this.roomCode),
      hint: showBoard ? undefined : this.roomStatus(g),
      hud: showBoard
        ? [
            { id: "room", value: g.roomCodeLabel(this.roomCode) },
            { id: "status", value: this.roomStatus(g) },
          ]
        : undefined,
      status: showBoard ? undefined : this.roomError || this.peerHint || undefined,
      actions,
      room: {
        title: g.roomCodeLabel(this.roomCode),
        status: [this.roomStatus(g), this.peerHint, this.roomError].filter(Boolean).join(" · ") || undefined,
        code: this.roomCode,
        shareUrl: shareUrl(this.roomCode),
        shareLabel: g.copyLink,
        copiedLabel: g.linkCopied,
        seats: this.seatChips(g),
      },
    };
  }

  private seatChips(g: GomokuDict): SeatChip[] {
    const black = occupant(this.players, "red");
    const white = occupant(this.players, "blue");
    const lobby = this.roomPhase === "lobby" || this.roomPhase === "connecting";
    const line = (seat: "red" | "blue", player: RoomPlayer | undefined, claimLabel: string): SeatChip => {
      const mine = this.you?.seat === seat;
      const name = player?.name || (mine ? g.you : "");
      const online = player ? (player.connected ? g.onlineNow : g.offlineNow) : g.seatEmpty;
      const taken = Boolean(player);
      return {
        id: seat,
        label: `${seat === "red" ? g.black : g.white} · ${taken ? `${name || g.seatTaken} (${online})` : g.seatEmpty}`,
        canClaim: Boolean(lobby && (!taken || mine)),
        isYou: mine,
        detail: taken ? undefined : claimLabel,
      };
    };
    return [
      line("red", black, g.claimBlack),
      line("blue", white, g.claimWhite),
    ];
  }

  private localStatus(g: GomokuDict): string {
    if (this.thinking) return g.thinking;
    if (this.state.winner === 3) return g.draw;
    if (this.state.winner === 1 || this.state.winner === 2) {
      if (this.settings.opponent === "ai") {
        return this.state.winner === this.settings.humanColor ? g.youWin : g.youLose;
      }
      return this.state.winner === 1 ? g.blackWins : g.whiteWins;
    }
    return this.state.turn === 1 ? g.turnBlack : g.turnWhite;
  }

  private roomStatus(g: GomokuDict): string {
    if (this.roomClosed) return g.roomClosed;
    if (!this.you || this.roomPhase === "connecting") return g.roomConnecting;
    const black = occupant(this.players, "red");
    const white = occupant(this.players, "blue");
    if (this.roomPhase === "lobby") {
      if (this.you.seat === "red") return black && !white ? g.waitingWhite : g.waitingSeats;
      if (this.you.seat === "blue") return white && !black ? g.waitingBlack : g.waitingSeats;
      return g.waitingSeats;
    }
    const youBit =
      this.you.seat === "red" ? g.youAreBlack : this.you.seat === "blue" ? g.youAreWhite : g.watching;
    if (this.state && (this.roomPhase === "over" || isOver(this.state))) {
      const myColor = seatToPlayer(this.you.seat);
      if (this.state.winner === 3) return `${g.draw} ${youBit}`;
      if (myColor && (this.state.winner === 1 || this.state.winner === 2)) {
        return `${this.state.winner === myColor ? g.youWin : g.youLose} ${youBit}`;
      }
      return `${this.state.winner === 1 ? g.blackWins : g.whiteWins} ${youBit}`;
    }
    if (this.state && this.roomPhase === "playing") {
      const myColor = seatToPlayer(this.you.seat);
      if (myColor) {
        return `${this.state.turn === myColor ? g.yourTurn : g.opponentTurn} ${youBit}`;
      }
      return `${this.state.turn === 1 ? g.turnBlack : g.turnWhite} ${youBit}`;
    }
    return `${g.waitingSeats} ${youBit}`;
  }

  private emit(): void {
    this.scheduleAi();
    this.persist();
    this.paint();
    this.listeners.forEach((fn) => fn());
  }

  private boardState(): GameState | null {
    if (this.roomCode) return this.state;
    return this.phase === "play" ? this.state : null;
  }

  private canPlayIndex(index: number): boolean {
    const state = this.boardState();
    if (!state || isOver(state)) return false;
    if (state.board[index] !== 0) return false;
    if (this.roomCode) {
      const myColor = this.you ? seatToPlayer(this.you.seat) : null;
      return Boolean(myColor && this.roomPhase === "playing" && state.turn === myColor);
    }
    return !this.thinking && (this.settings.opponent !== "ai" || state.turn === this.settings.humanColor);
  }

  private paintCell(row: number, col: number): GridCellPaint {
    const state = this.boardState();
    if (!state) return {};
    const index = row * state.size + col;
    const stone = state.board[index];
    const win = state.winLine?.includes(index) ?? false;
    return {
      stone: stone === 1 ? "black" : stone === 2 ? "white" : null,
      path: win,
    };
  }

  private hookCanvas(): void {
    const canvas = this.canvas;
    const grid = this.grid;
    if (!canvas || !grid) return;
    canvas.onclick = (event) => {
      const cell = grid.pixelToCell(event.clientX, event.clientY);
      const state = this.boardState();
      if (!cell || !state) return;
      this.onPointClick(cell.row * state.size + cell.col);
    };
    canvas.onmousemove = (event) => {
      const cell = grid.pixelToCell(event.clientX, event.clientY);
      if (cell) grid.setHoverCell(cell.row, cell.col);
      else grid.clearHover();
    };
    canvas.onmouseleave = () => grid.clearHover();
    canvas.ontouchstart = (event) => {
      if (grid.panEnabled) return;
      event.preventDefault();
      const touch = event.touches[0];
      const state = this.boardState();
      if (!touch || !state) return;
      const cell = grid.pixelToCell(touch.clientX, touch.clientY);
      if (cell) this.onPointClick(cell.row * state.size + cell.col);
    };
  }

  private paint(): void {
    const state = this.boardState();
    if (state && state.moves.length) {
      const last = state.moves[state.moves.length - 1]!;
      this.grid?.setLastMove(Math.floor(last / state.size), last % state.size);
    } else {
      this.grid?.clearLastMove();
    }
    this.grid?.resize();
  }

  private onPointClick(index: number): void {
    if (this.roomCode) {
      const myColor = this.you ? seatToPlayer(this.you.seat) : null;
      if (
        !myColor ||
        !this.state ||
        this.roomPhase !== "playing" ||
        isOver(this.state) ||
        this.state.turn !== myColor
      ) {
        return;
      }
      this.client?.move(index);
      return;
    }
    if (this.thinking || isOver(this.state)) return;
    if (this.settings.opponent === "ai" && this.state.turn !== this.settings.humanColor) return;
    const next = play(this.state, index);
    if (!next) return;
    this.state = next;
    this.emit();
  }

  private onUndo(): void {
    if (this.roomCode || this.thinking || this.state.moves.length === 0) return;
    this.clearAi();
    const steps = this.settings.opponent === "ai" ? Math.min(2, this.state.moves.length) : 1;
    this.state = undo(this.state, steps);
    this.emit();
  }

  private startLocal(): void {
    this.clearAi();
    this.state = emptyState();
    this.phase = "play";
    this.emit();
  }

  private doRestart(): void {
    if (this.roomCode) return;
    this.clearAi();
    this.state = emptyState();
    this.emit();
  }

  private goMenu(clearProgress: boolean): void {
    this.clearAi();
    this.phase = "menu";
    this.state = emptyState();
    if (clearProgress) clearLocalProgress(SLUG);
    this.emit();
  }

  private createRoom(): void {
    const code = generateRoomCode();
    const next = new URLSearchParams(this.ctx.search);
    next.set("room", code);
    this.ctx.setSearch(next, { replace: true });
  }

  private hydrate(): void {
    const data = loadLocalProgress<Persist>(SLUG);
    if (!data || data.screen !== "playing" || !isValidState(data.state)) return;
    if (data.settings?.opponent === "online") return;
    this.settings = {
      opponent: data.settings?.opponent === "local" ? "local" : "ai",
      difficulty: asDifficulty(data.settings?.difficulty ?? "normal"),
      humanColor: data.settings?.humanColor === 2 ? 2 : 1,
    };
    this.state = data.state;
    this.phase = "play";
    this.scheduleAi();
  }

  private persist(): void {
    if (this.roomCode || this.phase !== "play") return;
    if (this.settings.opponent === "online") return;
    if (this.state.moves.length === 0 || this.state.winner !== 0) {
      clearLocalProgress(SLUG);
      return;
    }
    saveLocalProgress<Persist>(SLUG, {
      screen: "playing",
      settings: this.settings,
      state: this.state,
    });
  }

  private scheduleAi(): void {
    const needsAi =
      !this.roomCode &&
      this.phase === "play" &&
      this.settings.opponent === "ai" &&
      !isOver(this.state) &&
      this.state.turn !== this.settings.humanColor;
    if (!needsAi) return;
    if (this.thinking || this.aiTimer != null) return;
    const from = this.state;
    const difficulty = this.settings.difficulty;
    this.thinking = true;
    this.aiTimer = window.setTimeout(() => {
      const move = chooseMove(from, difficulty);
      const next = play(from, move);
      this.thinking = false;
      this.aiTimer = null;
      if (next) this.state = next;
      this.emit();
    }, 80);
  }

  private clearAi(): void {
    if (this.aiTimer != null) {
      window.clearTimeout(this.aiTimer);
      this.aiTimer = null;
    }
    this.thinking = false;
  }

  private enterRoom(code: string): void {
    this.clearAi();
    clearLocalProgress(SLUG);
    this.roomCode = code;
    this.settings = { ...this.settings, opponent: "online" };
    this.phase = "menu";
    this.state = emptyState();
    this.roomPhase = "connecting";
    this.roomClosed = false;
    this.roomError = "";
    this.peerHint = "";
    this.you = null;
    this.players = [];
    const client = new GomokuOnlineClient();
    const playerId = getOrCreatePlayerId();
    this.client = client;
    client.connect(code, {
      onOpen: () => {
        client.join({ playerId, name: "Player" });
      },
      onWelcome: (payload) => {
        this.you = { playerId: payload.playerId, seat: payload.seat };
        if (this.roomPhase === "connecting") this.roomPhase = "lobby";
        this.emit();
      },
      onRoom: (payload) => {
        this.roomPhase = payload.phase;
        this.players = payload.players;
        const self = payload.players.find((p) => p.playerId === playerId);
        if (self) this.you = { playerId: self.playerId, seat: self.seat };
        this.emit();
      },
      onStart: () => {
        this.roomPhase = "playing";
        this.roomError = "";
        this.peerHint = "";
        this.emit();
      },
      onState: (payload) => {
        if (isValidState(payload.publicState)) {
          this.state = payload.publicState;
          this.phase = "play";
          this.roomError = "";
          this.emit();
        }
      },
      onGameOver: () => {
        this.roomPhase = "over";
        this.emit();
      },
      onSeated: (payload) => {
        if (payload.playerId === playerId) {
          this.you = { playerId: payload.playerId, seat: payload.seat };
          this.emit();
        }
      },
      onError: (payload) => {
        this.roomError = payload.message;
        this.emit();
      },
      onPeerLeft: () => {
        this.peerHint = dict(this.ctx.locale).opponentLeft;
        this.emit();
      },
      onRoomClosed: () => {
        this.roomClosed = true;
        this.emit();
      },
    });
  }

  private leaveRoom(clearUrl: boolean): void {
    this.client?.close();
    this.client = null;
    this.roomCode = "";
    this.you = null;
    this.players = [];
    this.roomError = "";
    this.roomClosed = false;
    this.peerHint = "";
    this.roomPhase = "connecting";
    this.phase = "menu";
    this.state = emptyState();
    this.settings = { ...this.settings, opponent: "ai" };
    if (clearUrl) this.ctx.setSearch(new URLSearchParams(), { replace: true });
  }

  private destroyBoard(): void {
    this.grid?.destroy();
    this.grid = null;
    this.canvas = null;
    if (this.boardHost) this.boardHost.replaceChildren();
    this.boardHost = null;
  }
}

export const playModule: GamePlayModule = {
  createSession: (ctx) => new GomokuSession(ctx),
};
