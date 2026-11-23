import type {
  GameAction,
  GamePlayModule,
  GameSession,
  GameSnapshot,
  ParamField,
  PlayChrome,
  SeatChip,
  SessionContext,
  ShellAction,
} from "../../platform/play";
import { createGridBoard, type GridBoard, type GridCellPaint } from "../../platform/play/grid-board";
import { clearLocalProgress, loadLocalProgress, saveLocalProgress } from "../local-persist";
import { chooseMove, type Difficulty } from "./ai";
import {
  SIZE,
  asRules,
  canActOn,
  clampCapturesToWin,
  cloneState,
  DEFAULT_CAPTURES_TO_WIN,
  emptyState,
  fitsCapture,
  flipShown,
  isOver,
  liftShown,
  other,
  parseState,
  pickFlipStone,
  placeShown,
  play,
  playTurn,
  type GameState,
  type Player,
  type Rules,
} from "./engine";
import { isShareRoomId, parseRoomId, roomIdForGame } from "../../../shared/multiplayer";
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
  rules: Rules;
  capturesToWin: number;
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
const SERIES_BEAT_MS = 500;
const CHROME_BLACK = "#2b2b30";
const CHROME_WHITE = "#f3ead8";

function gomokuChrome(state: GameState | null): PlayChrome {
  const series = state?.rules === "series";
  let active: PlayChrome["active"] = "none";
  if (state) {
    if (state.winner === 1) active = "left";
    else if (state.winner === 2) active = "right";
    else if (state.winner === 3) active = "both";
    else active = state.turn === 1 ? "left" : "right";
  }
  return {
    left: {
      color: CHROME_BLACK,
      value: series && state ? String(state.captures[0]) : undefined,
    },
    right: {
      color: CHROME_WHITE,
      value: series && state ? String(state.captures[1]) : undefined,
    },
    active,
  };
}
const DEFAULT_SETTINGS: Settings = {
  opponent: "ai",
  difficulty: "normal",
  humanColor: 1,
  rules: "classic",
  capturesToWin: DEFAULT_CAPTURES_TO_WIN,
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

function normalizeRoomCode(value: string): string {
  const raw = value.trim().toLowerCase();
  return parseRoomId(raw)?.roomId ?? raw;
}

function isRoomCode(value: string): boolean {
  return isShareRoomId(value);
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
  private scripting = false;
  private scriptGen = 0;
  private flipHint: number | null = null;
  private aiTimer: number | null = null;
  private history: GameState[] = [];
  private roomRules: Rules = "classic";
  private roomCapturesToWin = DEFAULT_CAPTURES_TO_WIN;
  private configSentForRoom = "";
  private pendingConfig: string | null = null;
  private joinCode = "";
  private joinError = "";
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
    const room = roomIdForGame(ctx.search.get("room") ?? "", SLUG);
    if (room) {
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
    const room = roomIdForGame(this.ctx.search.get("room") ?? "", SLUG);
    if (room && room !== this.roomCode) {
      this.leaveRoom(false);
      this.enterRoom(room);
      return;
    }
    if (!room && this.roomCode) {
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
    if (id === "joinCode") {
      this.joinCode = text;
      this.joinError = "";
      this.emit();
      return;
    }
    if (id === "mode") this.settings = { ...this.settings, opponent: asOpponent(text) };
    if (id === "difficulty") this.settings = { ...this.settings, difficulty: asDifficulty(text) };
    if (id === "humanColor") this.settings = { ...this.settings, humanColor: text === "2" ? 2 : 1 };
    if (id === "rules") this.settings = { ...this.settings, rules: asRules(text) };
    if (id === "capturesToWin") {
      this.settings = { ...this.settings, capturesToWin: clampCapturesToWin(value) };
    }
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
    if (id === "join-room") {
      this.joinRoom();
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
    fields.push({
      id: "rules",
      label: g.rules,
      type: "select",
      value: this.settings.rules,
      options: [
        { value: "classic", label: g.rulesClassic },
        { value: "series", label: g.rulesSeries },
      ],
    });
    if (this.settings.rules === "series") {
      fields.push({
        id: "capturesToWin",
        label: g.capturesToWin,
        type: "number",
        value: this.settings.capturesToWin,
        min: 1,
        max: 9,
      });
    }
    const online = this.settings.opponent === "online";
    if (online) {
      fields.push({
        id: "joinCode",
        label: g.joinCode,
        type: "text",
        value: this.joinCode,
      });
    }
    return {
      phase: "menu",
      title: g.setupTitle,
      hint: online
        ? g.onlineSetupHint
        : this.settings.rules === "series"
          ? g.seriesHint
          : g.setupHint,
      status: this.joinError || undefined,
      params: { fields },
      actions: online
        ? [
            { id: "create-room", label: g.createRoom, kind: "primary" },
            {
              id: "join-room",
              label: g.joinRoom,
              kind: "ghost",
              disabled: !isRoomCode(this.joinCode),
            },
          ]
        : [{ id: "start", label: g.start, kind: "primary" }],
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
        disabled: this.thinking || this.history.length === 0,
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
      chrome: gomokuChrome(this.state),
      status: this.localStatus(g),
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
      chrome: showBoard ? gomokuChrome(this.state) : undefined,
      status: showBoard ? this.playNotice(g) : this.roomError || this.peerHint || undefined,
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

  private localStatus(g: GomokuDict): string | undefined {
    if (this.thinking || (this.scripting && this.state.turn !== this.settings.humanColor)) {
      return g.thinking;
    }
    if (this.state.pending?.kind === "remove") {
      return g.pickRemove(this.state.pending.selected.length);
    }
    if (this.state.pending?.kind === "flip") return g.pickFlip;
    if (this.state.winner === 3) return g.draw;
    if (this.state.winner === 1 || this.state.winner === 2) {
      if (this.settings.opponent === "ai") {
        return this.state.winner === this.settings.humanColor ? g.youWin : g.youLose;
      }
      return this.state.winner === 1 ? g.blackWins : g.whiteWins;
    }
    return undefined;
  }

  /** Notices that are not whose-turn (capsule already shows that). */
  private playNotice(g: GomokuDict): string | undefined {
    if (this.roomClosed) return g.roomClosed;
    if (this.roomError) return this.roomError;
    if (this.peerHint) return this.peerHint;
    if (!this.state) return undefined;
    if (this.state.pending?.kind === "remove") {
      return g.pickRemove(this.state.pending.selected.length);
    }
    if (this.state.pending?.kind === "flip") return g.pickFlip;
    if (this.roomPhase === "over" || isOver(this.state)) {
      const myColor = this.you ? seatToPlayer(this.you.seat) : null;
      if (this.state.winner === 3) return g.draw;
      if (myColor && (this.state.winner === 1 || this.state.winner === 2)) {
        return this.state.winner === myColor ? g.youWin : g.youLose;
      }
      if (this.state.winner === 1 || this.state.winner === 2) {
        return this.state.winner === 1 ? g.blackWins : g.whiteWins;
      }
    }
    return undefined;
  }

  private roomStatus(g: GomokuDict): string {
    if (this.roomClosed) return g.roomClosed;
    if (!this.you || this.roomPhase === "connecting") return g.roomConnecting;
    const black = occupant(this.players, "red");
    const white = occupant(this.players, "blue");
    const rulesBit =
      this.roomRules === "series" ? g.roomRulesSeries(this.roomCapturesToWin) : g.roomRulesClassic;
    if (this.roomPhase === "lobby") {
      if (this.you.seat === "red") {
        return `${rulesBit} ${black && !white ? g.waitingWhite : g.waitingSeats}`;
      }
      if (this.you.seat === "blue") {
        return `${rulesBit} ${white && !black ? g.waitingBlack : g.waitingSeats}`;
      }
      return `${rulesBit} ${g.waitingSeats}`;
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
      if (this.state.pending?.kind === "remove") {
        return `${g.pickRemove(this.state.pending.selected.length)} ${youBit}`;
      }
      if (this.state.pending?.kind === "flip") {
        return `${g.pickFlip} ${youBit}`;
      }
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
    if (!state || isOver(state) || !canActOn(state, index)) return false;
    if (this.roomCode) {
      const myColor = this.you ? seatToPlayer(this.you.seat) : null;
      return Boolean(myColor && this.roomPhase === "playing" && state.turn === myColor);
    }
    return (
      !this.thinking &&
      !this.scripting &&
      (this.settings.opponent !== "ai" || state.turn === this.settings.humanColor)
    );
  }

  private paintCell(row: number, col: number): GridCellPaint {
    const state = this.boardState();
    if (!state) return {};
    const index = row * state.size + col;
    const stone = state.board[index];
    const pending = state.pending;
    const selected = pending?.kind === "remove" && pending.selected.includes(index);
    const choosing = pending?.kind === "remove";
    const marked = choosing ? canActOn(state, index) : (state.winLine?.includes(index) ?? false);
    const flipping = this.flipHint === index;
    return {
      stone: stone === 1 ? "black" : stone === 2 ? "white" : null,
      path: marked || flipping,
      accent: selected || flipping ? (state.turn === 1 ? "red" : "blue") : "none",
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
    const last = state?.lastMove;
    if (state && last != null && state.board[last]) {
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
    if (this.thinking || this.scripting || isOver(this.state)) return;
    if (this.settings.opponent === "ai" && this.state.turn !== this.settings.humanColor) return;
    if (this.settings.opponent === "ai" && this.settings.rules === "series") {
      this.onSeriesPoint(index);
      return;
    }
    const next = play(this.state, index);
    if (!next) return;
    this.history.push(cloneState(this.state));
    this.state = next;
    this.emit();
  }

  private onUndo(): void {
    if (this.roomCode || this.thinking || this.history.length === 0) return;
    this.clearAi();
    const classicAi =
      this.settings.opponent === "ai" &&
      this.settings.rules === "classic" &&
      !this.state.pending &&
      this.history.length >= 2;
    const steps = classicAi ? 2 : 1;
    for (let i = 0; i < steps; i++) {
      const prev = this.history.pop();
      if (prev) this.state = prev;
    }
    this.emit();
  }

  private freshState(): GameState {
    return emptyState({
      rules: this.settings.rules,
      capturesToWin: this.settings.capturesToWin,
    });
  }

  private startLocal(): void {
    this.clearAi();
    this.history = [];
    this.state = this.freshState();
    this.phase = "play";
    this.emit();
  }

  private doRestart(): void {
    if (this.roomCode) return;
    this.clearAi();
    this.history = [];
    this.state = this.freshState();
    this.emit();
  }

  private goMenu(clearProgress: boolean): void {
    this.clearAi();
    this.history = [];
    this.phase = "menu";
    this.state = emptyState();
    if (clearProgress) clearLocalProgress(SLUG);
    this.emit();
  }

  private createRoom(): void {
    const code = generateRoomCode();
    this.pendingConfig = code;
    this.joinError = "";
    const next = new URLSearchParams(this.ctx.search);
    next.set("room", code);
    this.ctx.setSearch(next, { replace: true });
  }

  private joinRoom(): void {
    const code = normalizeRoomCode(this.joinCode);
    if (!isRoomCode(code)) {
      this.joinError = dict(this.ctx.locale).needRoomCode;
      this.emit();
      return;
    }
    this.pendingConfig = null;
    this.joinError = "";
    const next = new URLSearchParams(this.ctx.search);
    next.set("room", code);
    this.ctx.setSearch(next, { replace: true });
  }

  private hydrate(): void {
    const data = loadLocalProgress<Persist>(SLUG);
    const state = data?.state ? parseState(data.state) : null;
    if (!data || data.screen !== "playing" || !state) return;
    if (data.settings?.opponent === "online") return;
    this.settings = {
      opponent: data.settings?.opponent === "local" ? "local" : "ai",
      difficulty: asDifficulty(data.settings?.difficulty ?? "normal"),
      humanColor: data.settings?.humanColor === 2 ? 2 : 1,
      rules: asRules(data.settings?.rules ?? state.rules),
      capturesToWin: clampCapturesToWin(data.settings?.capturesToWin ?? state.capturesToWin),
    };
    this.state = state;
    this.history = [];
    this.phase = "play";
    this.scheduleAi();
  }

  private persist(): void {
    if (this.scripting) return;
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

  private onSeriesPoint(index: number): void {
    const state = this.state;
    if (state.pending?.kind === "remove") {
      const selected = state.pending.selected.includes(index)
        ? state.pending.selected.filter((cell) => cell !== index)
        : state.pending.selected.concat(index);
      if (!fitsCapture(state.board, state.size, selected)) return;
      if (selected.length < 5) {
        this.state = {
          ...state,
          pending: { kind: "remove", eligible: state.pending.eligible, selected },
          winLine: state.pending.eligible,
        };
        this.emit();
        return;
      }
      const lifted = liftShown(state, selected);
      if (!lifted) return;
      this.continueSeries(lifted, false);
      return;
    }
    if (state.pending?.kind === "flip") {
      if (state.board[index] !== other(state.turn)) return;
      this.holdFlip(state, index, false);
      return;
    }
    const placed = placeShown(state, index);
    if (!placed) return;
    this.history.push(cloneState(state));
    this.continueSeries(placed, false);
  }

  /** Show a five, then the lift, then the flipped stone, each held so a chain stays readable. */
  private continueSeries(state: GameState, autoFlip: boolean): void {
    const gen = this.scriptGen;
    this.flipHint = null;
    this.state = state;
    if (state.winner !== 0) {
      this.scripting = false;
      this.emit();
      return;
    }
    if (state.pending?.kind === "flip") {
      if (!autoFlip) {
        this.scripting = false;
        this.emit();
        return;
      }
      const flip = pickFlipStone(state);
      if (flip == null) {
        this.scripting = false;
        this.emit();
        return;
      }
      this.holdFlip(state, flip, true);
      return;
    }
    if (state.pending?.kind === "remove") {
      if (!autoFlip) {
        this.scripting = false;
        this.emit();
        return;
      }
      this.scripting = true;
      this.state = { ...state, winLine: state.pending.eligible };
      this.emit();
      this.arm(gen, SERIES_BEAT_MS, () => {
        const lifted = liftShown(this.state);
        if (!lifted) {
          this.scripting = false;
          this.emit();
          return;
        }
        this.continueSeries(lifted, true);
      });
      return;
    }
    const line = state.winLine;
    if (line && line.length >= 5 && !state.pending) {
      this.scripting = true;
      this.emit();
      this.arm(gen, SERIES_BEAT_MS, () => {
        if (line.length > 5 && !autoFlip) {
          this.state = { ...state, pending: { kind: "remove", eligible: line.slice(), selected: [] } };
          this.scripting = false;
          this.emit();
          return;
        }
        const lifted = liftShown(state);
        if (!lifted) {
          this.scripting = false;
          this.emit();
          return;
        }
        this.continueSeries(lifted, autoFlip);
      });
      return;
    }
    this.scripting = false;
    this.emit();
  }

  private holdFlip(state: GameState, index: number, autoFlip: boolean): void {
    const gen = this.scriptGen;
    this.scripting = true;
    this.flipHint = index;
    this.state = state;
    this.emit();
    this.arm(gen, SERIES_BEAT_MS, () => {
      this.flipHint = null;
      const flipped = flipShown(state, index);
      if (!flipped) {
        this.scripting = false;
        this.emit();
        return;
      }
      this.continueSeries(flipped, autoFlip);
    });
  }

  private arm(gen: number, ms: number, fn: () => void): void {
    this.aiTimer = window.setTimeout(() => {
      this.aiTimer = null;
      if (gen !== this.scriptGen) return;
      fn();
    }, ms);
  }

  private scheduleAi(): void {
    const needsAi =
      !this.roomCode &&
      this.phase === "play" &&
      this.settings.opponent === "ai" &&
      !isOver(this.state) &&
      this.state.turn !== this.settings.humanColor;
    if (!needsAi) return;
    if (this.scripting || this.thinking || this.aiTimer != null) return;
    const from = this.state;
    const difficulty = this.settings.difficulty;
    const gen = this.scriptGen;
    this.thinking = true;
    this.aiTimer = window.setTimeout(() => {
      this.aiTimer = null;
      this.thinking = false;
      if (gen !== this.scriptGen) return;
      if (from.rules === "series") {
        if (from.pending) {
          this.history.push(cloneState(from));
          this.continueSeries(from, true);
          return;
        }
        const placed = placeShown(from, chooseMove(from, difficulty));
        if (!placed) {
          this.emit();
          return;
        }
        this.history.push(cloneState(from));
        this.continueSeries(placed, true);
        return;
      }
      const next = playTurn(from, chooseMove(from, difficulty));
      if (next) {
        this.history.push(cloneState(from));
        this.state = next;
      }
      this.emit();
    }, 80);
  }

  private clearAi(): void {
    this.scriptGen += 1;
    if (this.aiTimer != null) {
      window.clearTimeout(this.aiTimer);
      this.aiTimer = null;
    }
    this.thinking = false;
    this.scripting = false;
    this.flipHint = null;
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
    this.configSentForRoom = "";
    this.roomRules = this.settings.rules;
    this.roomCapturesToWin = this.settings.capturesToWin;
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
        if (
          payload.canConfig === true &&
          this.pendingConfig === code &&
          this.configSentForRoom !== code
        ) {
          this.configSentForRoom = code;
          this.pendingConfig = null;
          client.setConfig({
            rules: this.settings.rules,
            capturesToWin: this.settings.capturesToWin,
          });
        }
        this.emit();
      },
      onRoom: (payload) => {
        this.roomPhase = payload.phase;
        this.players = payload.players;
        const self = payload.players.find((p) => p.playerId === playerId);
        if (self) this.you = { playerId: self.playerId, seat: self.seat };
        const cfg = payload.config;
        if (cfg && typeof cfg === "object") {
          this.roomRules = asRules(cfg.rules);
          this.roomCapturesToWin = clampCapturesToWin(cfg.capturesToWin);
        }
        this.emit();
      },
      onStart: () => {
        this.roomPhase = "playing";
        this.roomError = "";
        this.peerHint = "";
        this.emit();
      },
      onState: (payload) => {
        const next = parseState(payload.publicState);
        if (next) {
          this.state = next;
          this.roomRules = next.rules;
          this.roomCapturesToWin = next.capturesToWin;
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
    this.configSentForRoom = "";
    this.pendingConfig = null;
    this.phase = "menu";
    this.state = emptyState();
    this.settings = { ...this.settings, opponent: "online" };
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
