import type {
  GameAction,
  GamePlayModule,
  GameSession,
  GameSnapshot,
  ParamField,
  PlayChrome,
  SessionContext,
  ShellAction,
} from "../../platform/play";
import { createAI, type AiDifficulty, type AiInstance } from "./ai";
import { createBoardRenderer, type BoardRenderer } from "./boardRenderer";
import {
  COLOR_BLUE,
  COLOR_RED,
  WIN_MODE_ANNIHILATION,
  WIN_MODE_AREA,
  WIN_MODE_STEPS,
  createGame,
  type AnimationFrame,
  type FullState,
  type GameInstance,
  type MoveResult,
  type PlayerColor,
  type WinMode,
} from "./engine";
import { isShareRoomId, parseRoomId, roomIdForGame } from "../../../shared/multiplayer";
import { explosiveEn, explosiveZh } from "./i18n";
import {
  formatWinReason,
  seatLabel,
  seatToPlayerColor,
  winnerLabel,
  winModeLabel,
  youAreLabel,
} from "./labels";
import {
  ExplosiveOnlineClient,
  generateRoomCode,
  getOrCreatePlayerId,
  shareUrl,
  type HostColor,
  type Phase,
  type Role,
  type RoomConfig,
  type RoomPlayer,
  type Seat,
} from "./online";
import { clearLocalProgress } from "../local-persist";
import {
  EXPLOSION_DELAY_MAX_MS,
  SOLO_PROGRESS_SLUG,
  clampExplosionDelay,
  loadSettings,
  loadSoloPersist,
  persistSoloProgress,
  saveSettings,
  type OpponentMode,
  type Settings,
  type SoloPersist,
} from "./settings";
import "./explosive-chess.css";

type OnlinePhase = Phase | "idle" | "connecting" | "reconnecting";

function dict(locale: SessionContext["locale"]) {
  return locale === "zh" ? explosiveZh : explosiveEn;
}

function asOpponent(value: string): OpponentMode {
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

const CHROME_RED = "#e53935";
const CHROME_BLUE = "#1e88e5";

function explosiveChrome(opts: {
  turn: PlayerColor;
  gameOver: boolean;
  winner: MoveResult["winner"];
  winMode: WinMode;
  counts: { red: number; blue: number };
  resetKey: number;
}): PlayChrome {
  let active: PlayChrome["active"] = opts.turn === COLOR_RED ? "left" : "right";
  if (opts.gameOver) {
    if (opts.winner === COLOR_RED) active = "left";
    else if (opts.winner === COLOR_BLUE) active = "right";
    else active = "both";
  }
  const showCells = opts.winMode === WIN_MODE_AREA;
  return {
    resetKey: opts.resetKey,
    left: { color: CHROME_RED, value: showCells ? String(opts.counts.red) : undefined },
    right: { color: CHROME_BLUE, value: showCells ? String(opts.counts.blue) : undefined },
    active,
  };
}

class ExplosiveSession implements GameSession {
  private listeners = new Set<() => void>();
  private phase: "menu" | "play" = "menu";
  private settings: Settings;
  private joinCode = "";
  private pendingRestore: SoloPersist | null;
  private localSession = 0;

  private turn: PlayerColor = COLOR_RED;
  private counts = { red: 0, blue: 0 };
  private matchEpoch = 0;
  private gameOver = false;
  private winReason = "";
  private winner: MoveResult["winner"] = null;
  private tip = "";
  private busy = false;

  private roomCode = "";
  private shareLink = "";
  private onlinePhase: OnlinePhase = "idle";
  private onlineSeat: Seat = "spectator";
  private onlineRole: Role = "spectator";
  private onlinePlayers: RoomPlayer[] = [];
  private onlineConfig: RoomConfig | null = null;
  private onlineStatus = "";
  private myColor: PlayerColor | null = null;

  private game: GameInstance | null = null;
  private renderer: BoardRenderer | null = null;
  private ai: AiInstance | null = null;
  private animating = false;
  private playerColor: PlayerColor = COLOR_RED;
  private aiColor: PlayerColor = COLOR_BLUE;
  private client: ExplosiveOnlineClient | null = null;
  private moveTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private intentionalLeave = false;
  private configSentForRoom: string | null = null;
  private pendingConfig: string | null = null;
  private pendingOnlineStart: { config: RoomConfig; yourColor: HostColor | null } | null = null;
  private pendingOnlineState: {
    fullState: FullState;
    lastMove?: { row: number; col: number };
    animationFrames?: AnimationFrame[];
  } | null = null;
  private resizeCleanup: (() => void) | null = null;
  private host: HTMLElement | null = null;
  private readonly ctx: SessionContext;

  constructor(ctx: SessionContext) {
    this.ctx = ctx;
    const roomFromQuery = roomIdForGame(ctx.search.get("room") ?? "", "explosive-chess");
    this.pendingRestore = loadSoloPersist(roomFromQuery ?? "");
    this.settings = loadSettings();
    this.tip = this.ex().tipClick;
    if (roomFromQuery) {
      clearLocalProgress(SOLO_PROGRESS_SLUG);
      this.pendingRestore = null;
      this.settings = { ...this.settings, opponent: "online" };
      this.connectToRoom(roomFromQuery);
    } else if (this.pendingRestore) {
      this.settings = {
        ...this.settings,
        ...this.pendingRestore.settings,
        opponent: this.pendingRestore.settings.opponent,
        explosionDelayMs: clampExplosionDelay(
          this.pendingRestore.settings.explosionDelayMs ?? this.settings.explosionDelayMs,
        ),
      };
      this.localSession = this.pendingRestore.localSession ?? 0;
      this.phase = "play";
    }
  }

  private ex() {
    return dict(this.ctx.locale);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  syncContext(): void {
    const room = roomIdForGame(this.ctx.search.get("room") ?? "", "explosive-chess");
    if (room && room !== this.roomCode && this.onlinePhase === "idle") {
      this.pendingRestore = null;
      this.settings = { ...this.settings, opponent: "online" };
      this.connectToRoom(room);
      return;
    }
    this.emit();
  }

  destroy(): void {
    this.intentionalLeave = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.moveTimeout) clearTimeout(this.moveTimeout);
    this.client?.close();
    this.client = null;
    this.destroyBoard();
    this.listeners.clear();
  }

  choose(itemId: string): void {
    if (itemId === "start") this.startLocalGame();
  }

  back(): void {
    if (this.phase === "play") {
      this.backToSetup();
      return;
    }
    if (this.roomCode) {
      this.disconnectOnline();
      this.ctx.setSearch(new URLSearchParams(), { replace: true });
      this.roomCode = "";
      this.shareLink = "";
      this.onlineStatus = this.ex().leftRoom;
      this.emit();
    }
  }

  setParam(id: string, value: string | number): void {
    if (id === "joinCode") {
      this.joinCode = String(value);
      this.emit();
      return;
    }
    if (this.onlineConfig && this.onlinePhase !== "idle") return;
    const next = { ...this.settings };
    if (id === "mode") {
      const opponent = asOpponent(String(value));
      if (opponent !== "online" && this.settings.opponent === "online") {
        this.disconnectOnline();
        this.ctx.setSearch(new URLSearchParams(), { replace: true });
        this.roomCode = "";
        this.shareLink = "";
      }
      next.opponent = opponent;
    }
    if (id === "boardSize") next.boardSize = Number(value) as 9 | 11 | 13;
    if (id === "winMode") next.winMode = String(value) as WinMode;
    if (id === "winParam") next.winParam = Math.max(1, Number(value) || 1);
    if (id === "difficulty") next.difficulty = String(value) as AiDifficulty;
    if (id === "redOwner") next.redOwner = value === "ai" ? "ai" : "player";
    if (id === "hostColor") next.hostColor = value === "blue" ? "blue" : "red";
    if (id === "explosionDelayMs") next.explosionDelayMs = clampExplosionDelay(value);
    this.settings = next;
    this.emit();
  }

  dispatch(action: GameAction): void {
    const id = action.type === "ui" && typeof action.id === "string" ? action.id : action.type;
    if (id === "start") {
      this.startLocalGame();
      return;
    }
    if (id === "dismiss-dialog") {
      return;
    }
    if (id === "restart") {
      clearLocalProgress(SOLO_PROGRESS_SLUG);
      this.pendingRestore = null;
      this.localSession += 1;
      this.matchEpoch += 1;
      this.mountLocalBoard();
      this.emit();
      return;
    }
    if (id === "back-setup") {
      this.backToSetup();
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
    if (id === "leave-room") {
      this.disconnectOnline();
      this.ctx.setSearch(new URLSearchParams(), { replace: true });
      this.roomCode = "";
      this.shareLink = "";
      this.onlineStatus = this.ex().leftRoom;
      this.emit();
      return;
    }
    if (id === "reconnect") {
      this.reconnectAttempts = 0;
      const code =
        this.roomCode || roomIdForGame(this.ctx.search.get("room") ?? "", "explosive-chess") || "";
      if (code) this.connectToRoom(code, { keepPlaying: this.phase === "play" });
      return;
    }
    if (id === "surrender") {
      this.client?.surrender();
      return;
    }
    if (id === "rematch") {
      this.client?.rematch();
      this.phase = "menu";
      this.destroyBoard();
      this.emit();
      return;
    }
    if (action.type === "claim-seat" && (action.id === "red" || action.id === "blue")) {
      const sent = this.client?.claimSeat(action.id);
      if (!sent) this.onlineStatus = this.ex().notConnected;
      this.emit();
    }
  }

  bindBoard(host: HTMLElement) {
    this.host = host;
    host.replaceChildren();
    if (this.phase === "play") {
      if (this.settings.opponent === "online") this.tryMountOnlineBoard();
      else this.mountLocalBoard();
    }
    return {
      destroy: () => {
        if (this.host === host) this.host = null;
        this.destroyBoard();
        host.replaceChildren();
      },
    };
  }

  snapshot(): GameSnapshot {
    const ex = this.ex();
    if (this.phase === "play") return this.playSnapshot(ex);
    const online = this.settings.opponent === "online";
    const fields = this.paramFields(ex);
    return {
      phase: "menu",
      title: ex.setupTitle,
      hint: online ? ex.onlineHint : ex.setupHint,
      params: { fields },
      actions: this.menuActions(ex),
      room: online && this.onlinePhase !== "idle" ? this.roomPane(ex, true) : undefined,
    };
  }

  private menuActions(ex: Record<string, string>): ShellAction[] {
    if (this.settings.opponent !== "online") {
      return [{ id: "start", label: ex.start, kind: "primary" }];
    }
    const actions: ShellAction[] = [];
    const busy = this.onlinePhase === "connecting" || this.onlinePhase === "reconnecting";
    if (this.onlinePhase === "idle" || busy) {
      if (this.onlinePhase !== "reconnecting") {
        actions.push({
          id: "create-room",
          label: ex.createRoom,
          kind: "primary",
          disabled: busy,
        });
      }
      actions.push({
        id: "join-room",
        label: this.onlinePhase === "reconnecting" ? ex.reconnecting : ex.joinRoom,
        kind: "ghost",
        disabled: busy || !isRoomCode(this.joinCode),
      });
    }
    if (this.onlinePhase === "lobby" || this.onlinePhase === "connecting") {
      actions.push({ id: "leave-room", label: ex.leaveRoom, kind: "ghost" });
    }
    return actions;
  }

  private paramFields(ex: Record<string, string>): ParamField[] {
    const online = this.settings.opponent === "online";
    const locked = online && this.onlinePhase !== "idle";
    const cfg = this.onlineConfig;
    const boardSize = cfg?.boardSize ?? this.settings.boardSize;
    const winMode = cfg?.winMode ?? this.settings.winMode;
    const winParam = cfg?.winParam ?? this.settings.winParam;
    const explosionDelayMs = clampExplosionDelay(cfg?.explosionDelayMs ?? this.settings.explosionDelayMs);
    const fields: ParamField[] = [
      {
        id: "mode",
        label: ex.mode,
        type: "select",
        value: this.settings.opponent,
        disabled: locked,
        options: [
          { value: "ai", label: ex.vsAi },
          { value: "local", label: ex.hotseat },
          { value: "online", label: ex.online },
        ],
      },
      {
        id: "boardSize",
        label: ex.board,
        type: "select",
        value: String(boardSize),
        disabled: locked,
        options: [
          { value: "9", label: "9×9" },
          { value: "11", label: "11×11" },
          { value: "13", label: "13×13" },
        ],
      },
      {
        id: "winMode",
        label: ex.winMode,
        type: "select",
        value: winMode,
        disabled: locked,
        options: [
          { value: WIN_MODE_ANNIHILATION, label: ex.annihilation },
          { value: WIN_MODE_STEPS, label: ex.steps },
          { value: WIN_MODE_AREA, label: ex.area },
        ],
      },
      {
        id: "explosionDelayMs",
        label: ex.explosionDelay,
        type: "number",
        value: explosionDelayMs,
        min: 0,
        max: EXPLOSION_DELAY_MAX_MS,
        disabled: locked,
      },
    ];
    if (winMode !== WIN_MODE_ANNIHILATION) {
      fields.push({
        id: "winParam",
        label: winMode === WIN_MODE_STEPS ? ex.stepCount : ex.targetCells,
        type: "number",
        value: winParam,
        min: 1,
        disabled: locked,
      });
    }
    if (this.settings.opponent === "ai") {
      fields.push(
        {
          id: "difficulty",
          label: ex.aiDifficulty,
          type: "select",
          value: this.settings.difficulty,
          options: [
            { value: "easy", label: ex.easy },
            { value: "medium", label: ex.medium },
            { value: "hard", label: ex.hard },
            { value: "hell", label: ex.hell },
          ],
        },
        {
          id: "redOwner",
          label: ex.redFirst,
          type: "select",
          value: this.settings.redOwner,
          options: [
            { value: "player", label: ex.me },
            { value: "ai", label: ex.ai },
          ],
        },
      );
    }
    if (online) {
      if (this.onlinePhase === "idle" || cfg) {
        fields.push({
          id: "hostColor",
          label: ex.myColor,
          type: "select",
          value: cfg?.hostColor ?? this.settings.hostColor,
          disabled: locked,
          options: [
            { value: "red", label: ex.redFirstSeat },
            { value: "blue", label: ex.blueSecond },
          ],
        });
      }
      if (this.onlinePhase === "idle") {
        fields.push({
          id: "joinCode",
          label: ex.joinCode,
          type: "text",
          value: this.joinCode,
        });
      }
    }
    return fields;
  }

  private playSnapshot(ex: Record<string, string>): GameSnapshot {
    const online = this.settings.opponent === "online";
    const actions: ShellAction[] = [{ id: "back-setup", label: ex.backSetup, kind: "ghost" }];
    if (!online) {
      actions.push({ id: "restart", label: ex.restart, kind: "ghost" });
    } else if (this.onlinePhase === "reconnecting" || this.onlinePhase === "idle") {
      actions.push({ id: "reconnect", label: ex.reconnect, kind: "primary" });
    } else if (this.onlinePhase === "playing" && this.myColor != null) {
      actions.push({ id: "surrender", label: ex.surrender, kind: "ghost" });
    } else if (this.onlinePhase === "over" && this.myColor != null) {
      actions.push({ id: "rematch", label: ex.rematch, kind: "primary" });
    }
    const status = this.playStatus(ex, online);
    const winMode = this.onlineConfig?.winMode ?? this.settings.winMode;
    return {
      phase: "play",
      chrome: explosiveChrome({
        turn: this.turn,
        gameOver: this.gameOver,
        winner: this.winner,
        winMode,
        counts: this.counts,
        resetKey: this.matchEpoch,
      }),
      status,
      actions,
      room: online && this.onlinePlayers.length > 0 ? this.roomPane(ex, false) : undefined,
    };
  }

  private playStatus(ex: Record<string, string>, online: boolean): string | undefined {
    if (this.gameOver) {
      return `${winnerLabel(this.winner, ex)}${this.winReason ? ` · ${formatWinReason(this.winReason, ex)}` : ""}${
        online && this.onlineStatus ? ` · ${this.onlineStatus}` : ""
      }`;
    }
    if (online && this.onlineStatus) return this.onlineStatus;
    const turnTips = new Set([
      ex.tipClick,
      ex.tipYourTurn,
      ex.tipAiTurn,
      ex.tipOppTurn,
      ex.redToMove,
      ex.blueToMove,
      ex.youAreSpectator,
    ]);
    if (this.tip && !turnTips.has(this.tip)) return this.tip;
    return undefined;
  }

  private roomPane(ex: Record<string, string>, inMenu: boolean): GameSnapshot["room"] {
    const cfg = this.onlineConfig;
    let status = this.onlineStatus || (inMenu ? ex.onlineHint : "");
    if (this.onlinePhase === "lobby" && this.onlineSeat) {
      status = `${status} ${youAreLabel(this.onlineSeat, ex)}`.trim();
    }
    if (cfg && this.onlineRole !== "host" && (this.onlinePhase === "lobby" || this.onlinePhase === "connecting")) {
      status = `${status} · ${ex.configLabel}${cfg.boardSize}×${cfg.boardSize} · ${winModeLabel(cfg.winMode, ex)}${
        cfg.winMode !== WIN_MODE_ANNIHILATION ? ` (${cfg.winParam})` : ""
      } · ${ex.explosionDelay} ${clampExplosionDelay(cfg.explosionDelayMs)} · ${ex.hostLabel} ${cfg.hostColor === "red" ? ex.colorRed : ex.colorBlue}`;
    }
    if (inMenu && this.onlinePhase !== "idle" && this.onlinePhase !== "connecting") {
      /* keep */
    }
    const board = cfg ? `${cfg.boardSize}×${cfg.boardSize}` : `${this.settings.boardSize}×${this.settings.boardSize}`;
    const mode = cfg ? winModeLabel(cfg.winMode, ex) : winModeLabel(this.settings.winMode, ex);
    const param =
      (cfg?.winMode ?? this.settings.winMode) !== WIN_MODE_ANNIHILATION
        ? ` (${cfg?.winParam ?? this.settings.winParam})`
        : "";
    return {
      title: ex.onlineLobby,
      status,
      code: this.roomCode && (this.onlinePhase === "lobby" || this.onlinePhase === "connecting") ? this.roomCode : undefined,
      shareUrl: this.shareLink || undefined,
      shareLabel: ex.copyLink,
      copiedLabel: ex.linkCopied,
      rules: {
        title: ex.rulesTitle,
        frozen: this.onlinePhase !== "idle",
        lines: [
          { label: ex.board, value: board },
          { label: ex.winMode, value: `${mode}${param}` },
        ],
      },
      roster: {
        youId: getOrCreatePlayerId(),
        players: this.onlinePlayers,
        claimable: this.onlinePhase === "lobby",
        seats: [
          { id: "red", label: ex.seatRed, claimLabel: ex.sitRed },
          { id: "blue", label: ex.seatBlue, claimLabel: ex.sitBlue },
        ],
      },
    };
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  private resetMatchHud(): void {
    this.gameOver = false;
    this.winner = null;
    this.winReason = "";
    this.turn = COLOR_RED;
    this.counts = { red: 0, blue: 0 };
  }

  private syncHud(game: GameInstance): void {
    this.turn = game.currentTurn;
    this.counts = game.getCellCounts();
    this.gameOver = game.gameOver;
    this.winner = game.winner;
    this.winReason = game.winReason;
  }

  private updateTip(game: GameInstance, mode: OpponentMode): void {
    const ex = this.ex();
    if (game.gameOver) {
      this.tip = `${winnerLabel(game.winner, ex)}${game.winReason ? ` · ${game.winReason}` : ""}`;
      return;
    }
    if (mode === "ai") {
      this.tip = game.currentTurn === this.playerColor ? ex.tipYourTurn : ex.tipAiTurn;
    } else if (mode === "online") {
      this.tip =
        this.myColor == null ? ex.youAreSpectator : game.currentTurn === this.myColor ? ex.tipYourTurn : ex.tipOppTurn;
    } else {
      this.tip = game.currentTurn === COLOR_RED ? ex.redToMove : ex.blueToMove;
    }
  }

  private matchExplosionDelay(): number {
    const raw =
      this.settings.opponent === "online"
        ? (this.onlineConfig?.explosionDelayMs ?? this.settings.explosionDelayMs)
        : this.settings.explosionDelayMs;
    return clampExplosionDelay(raw);
  }

  private async playFrames(frames: AnimationFrame[], renderer: BoardRenderer): Promise<void> {
    if (frames.length === 0) {
      renderer.setExplosionHighlight(null);
      renderer.render();
      return;
    }
    this.animating = true;
    for (const frame of frames) {
      renderer.setExplosionHighlight([frame.explodedCell, ...frame.affectedCells]);
      renderer.render();
      const delay = this.matchExplosionDelay();
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    }
    renderer.setExplosionHighlight(null);
    renderer.render();
    this.animating = false;
  }

  private destroyBoard(): void {
    this.resizeCleanup?.();
    this.resizeCleanup = null;
    this.ai?.destroy();
    this.ai = null;
    this.renderer?.destroy();
    this.renderer = null;
    this.game = null;
  }

  private async afterMove(result: MoveResult): Promise<void> {
    const game = this.game;
    const renderer = this.renderer;
    const mode = this.settings.opponent;
    if (!game || !renderer) return;
    if (this.matchExplosionDelay() > 0 && result.animationFrames.length > 0) {
      this.busy = true;
      await this.playFrames(result.animationFrames, renderer);
    } else {
      renderer.setExplosionHighlight(null);
      renderer.render();
    }
    this.syncHud(game);
    this.updateTip(game, mode);
    if (mode !== "online") {
      if (result.gameOver || game.gameOver) clearLocalProgress(SOLO_PROGRESS_SLUG);
      else persistSoloProgress(this.settings, game, this.localSession);
    }
    if (result.gameOver) {
      this.busy = false;
      this.emit();
      return;
    }
    if (mode === "ai" && game.currentTurn === this.aiColor) await this.runAiMove();
    else this.busy = false;
    this.emit();
  }

  private async runAiMove(): Promise<void> {
    const game = this.game;
    const renderer = this.renderer;
    const ai = this.ai;
    if (!game || !renderer || !ai || game.gameOver) {
      this.busy = false;
      this.emit();
      return;
    }
    this.busy = true;
    this.tip = this.ex().tipAiTurn;
    this.emit();
    const move = await ai.getMove();
    if (!move || !this.game || this.game.gameOver) {
      this.busy = false;
      this.emit();
      return;
    }
    const result = game.makeMove(move.row, move.col, this.aiColor);
    if (!result) {
      this.busy = false;
      this.emit();
      return;
    }
    renderer.setLastMove(move.row, move.col);
    await this.afterMove(result);
  }

  private hookCanvas(): void {
    const renderer = this.renderer;
    if (!renderer) return;
    const surface = renderer.surface;
    surface.onclick = (e) => this.handlePointer(e.clientX, e.clientY);
    surface.onmousemove = (e) => {
      const game = this.game;
      if (!this.renderer || !game || game.gameOver) {
        this.renderer?.clearHover();
        return;
      }
      if (this.settings.opponent === "online" && this.myColor != null && game.currentTurn !== this.myColor) {
        this.renderer.clearHover();
        return;
      }
      const cell = this.renderer.pixelToCell(e.clientX, e.clientY);
      if (cell) this.renderer.setHoverCell(cell.row, cell.col);
      else this.renderer.clearHover();
    };
    surface.onmouseleave = () => this.renderer?.clearHover();
    surface.ontouchstart = (e) => {
      if (renderer.panEnabled) return;
      e.preventDefault();
      const touch = e.touches[0];
      if (touch) this.handlePointer(touch.clientX, touch.clientY);
    };
    const onResize = () => this.renderer?.resize();
    window.addEventListener("resize", onResize);
    const themeObserver = new MutationObserver(() => this.renderer?.resize());
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    this.resizeCleanup = () => {
      window.removeEventListener("resize", onResize);
      themeObserver.disconnect();
    };
  }

  private mountLocalBoard(): void {
    const host = this.host;
    if (!host || this.settings.opponent === "online") {
      if (this.settings.opponent === "online") clearLocalProgress(SOLO_PROGRESS_SLUG);
      return;
    }
    this.destroyBoard();
    saveSettings(this.settings);
    const winParam = this.settings.winMode === WIN_MODE_ANNIHILATION ? undefined : this.settings.winParam;
    const game = createGame({
      boardSize: this.settings.boardSize,
      winMode: this.settings.winMode,
      winParam,
    });
    this.game = game;
    const restore = this.pendingRestore;
    this.pendingRestore = null;
    if (restore && !restore.fullState.gameOver) game.loadFullState(restore.fullState);
    if (this.settings.opponent === "ai") {
      const playerColor: PlayerColor = this.settings.redOwner === "player" ? COLOR_RED : COLOR_BLUE;
      this.playerColor = playerColor;
      this.aiColor = playerColor === COLOR_RED ? COLOR_BLUE : COLOR_RED;
      this.ai = createAI(this.settings.difficulty, this.aiColor, game);
    } else {
      this.playerColor = COLOR_RED;
      this.aiColor = COLOR_BLUE;
    }
    const renderer = createBoardRenderer(host, game);
    this.renderer = renderer;
    renderer.resize();
    this.hookCanvas();
    this.syncHud(game);
    this.updateTip(game, this.settings.opponent);
    this.busy = false;
    this.animating = false;
    if (!restore) {
      this.gameOver = false;
      this.winner = null;
      this.winReason = "";
    }
    persistSoloProgress(this.settings, game, this.localSession);
    if (this.settings.opponent === "ai" && game.currentTurn === this.aiColor) {
      queueMicrotask(() => void this.runAiMove());
    }
  }

  private attachCanvas(game: GameInstance): void {
    if (!this.host || this.renderer) return;
    const renderer = createBoardRenderer(this.host, game);
    this.renderer = renderer;
    renderer.resize();
    this.hookCanvas();
  }

  private tryMountOnlineBoard(): void {
    const pending = this.pendingOnlineStart;
    if (pending) {
      this.pendingOnlineStart = null;
      this.mountOnlineBoard(pending.config, pending.yourColor);
    } else if (this.game) {
      this.attachCanvas(this.game);
    }
    const buffered = this.pendingOnlineState;
    if (this.game && this.renderer && buffered) {
      this.pendingOnlineState = null;
      void this.applyServerState(buffered.fullState, buffered.lastMove, buffered.animationFrames);
    }
    queueMicrotask(() => this.renderer?.resize());
  }

  private mountOnlineBoard(config: RoomConfig, yourColor: HostColor | null): void {
    const color = yourColor ? seatToPlayerColor(yourColor) : null;
    this.myColor = color;
    if (color != null) this.playerColor = color;
    const winParam = config.winMode === WIN_MODE_ANNIHILATION ? undefined : config.winParam;
    const game = createGame({
      boardSize: config.boardSize,
      winMode: config.winMode,
      winParam,
    });
    this.ai?.destroy();
    this.ai = null;
    this.resizeCleanup?.();
    this.resizeCleanup = null;
    this.renderer?.destroy();
    this.renderer = null;
    this.game = game;
    this.attachCanvas(game);
    this.syncHud(game);
    this.updateTip(game, "online");
    this.busy = false;
    this.gameOver = false;
    this.winner = null;
    this.winReason = "";
  }

  private clearMoveLock(): void {
    if (this.moveTimeout) {
      clearTimeout(this.moveTimeout);
      this.moveTimeout = null;
    }
    this.busy = false;
  }

  private armMoveLock(): void {
    this.busy = true;
    if (this.moveTimeout) clearTimeout(this.moveTimeout);
    this.moveTimeout = setTimeout(() => {
      this.busy = false;
      this.onlineStatus = this.ex().moveTimeout;
      this.tip = this.ex().moveTimeoutTip;
      this.moveTimeout = null;
      this.emit();
    }, 6000);
  }

  private async applyServerState(
    fullState: FullState,
    lastMove?: { row: number; col: number },
    animationFrames?: AnimationFrame[],
  ): Promise<void> {
    const game = this.game;
    const renderer = this.renderer;
    if (!game || !renderer) {
      this.clearMoveLock();
      return;
    }
    game.loadFullState(fullState);
    if (lastMove) renderer.setLastMove(lastMove.row, lastMove.col);
    renderer.render();
    if (this.matchExplosionDelay() > 0 && animationFrames && animationFrames.length > 0) {
      this.busy = true;
      await this.playFrames(animationFrames, renderer);
    }
    this.syncHud(game);
    this.updateTip(game, "online");
    this.clearMoveLock();
    this.emit();
  }

  private handlePointer(clientX: number, clientY: number): void {
    const game = this.game;
    const renderer = this.renderer;
    const mode = this.settings.opponent;
    if (!game || !renderer || game.gameOver || this.busy || this.animating) return;
    if (mode === "ai" && game.currentTurn === this.aiColor) return;
    if (mode === "online") {
      const mine = this.myColor;
      if (mine == null || game.currentTurn !== mine) return;
      if (!this.client?.isOpen) {
        this.onlineStatus = this.ex().notConnected;
        this.scheduleReconnect();
        this.emit();
        return;
      }
      const cell = renderer.pixelToCell(clientX, clientY);
      if (!cell || !game.isValidMove(cell.row, cell.col, mine) || this.busy) return;
      this.armMoveLock();
      const sent = this.client.move(cell.row, cell.col);
      if (!sent) {
        this.clearMoveLock();
        this.onlineStatus = this.ex().sendFail;
        this.scheduleReconnect();
      }
      this.emit();
      return;
    }
    const cell = renderer.pixelToCell(clientX, clientY);
    if (!cell || !game.isValidMove(cell.row, cell.col, game.currentTurn)) return;
    const result = game.makeMove(cell.row, cell.col, game.currentTurn);
    if (!result) return;
    renderer.setLastMove(cell.row, cell.col);
    void this.afterMove(result);
  }

  private startLocalGame(): void {
    clearLocalProgress(SOLO_PROGRESS_SLUG);
    this.pendingRestore = null;
    saveSettings(this.settings);
    this.disconnectOnline();
    this.ctx.setSearch(new URLSearchParams(), { replace: true });
    this.phase = "play";
    this.localSession += 1;
    this.matchEpoch += 1;
    this.emit();
    queueMicrotask(() => {
      this.mountLocalBoard();
      this.emit();
    });
  }

  private backToSetup(): void {
    this.destroyBoard();
    if (this.settings.opponent === "online") {
      if (this.onlinePhase === "playing" || this.onlinePhase === "over" || this.onlinePhase === "reconnecting") {
        this.disconnectOnline();
        this.ctx.setSearch(new URLSearchParams(), { replace: true });
        this.roomCode = "";
      }
    } else {
      clearLocalProgress(SOLO_PROGRESS_SLUG);
      this.pendingRestore = null;
    }
    this.phase = "menu";
    this.clearMoveLock();
    this.gameOver = false;
    this.tip = this.ex().tipClick;
    this.emit();
  }

  private createRoom(): void {
    clearLocalProgress(SOLO_PROGRESS_SLUG);
    this.pendingRestore = null;
    const next = { ...this.settings, opponent: "online" as const };
    saveSettings(next);
    this.settings = next;
    const code = generateRoomCode();
    this.pendingConfig = code;
    this.connectToRoom(code);
  }

  private joinRoom(): void {
    const code = normalizeRoomCode(this.joinCode || this.ctx.search.get("room") || this.roomCode);
    if (!isRoomCode(code)) {
      this.onlineStatus = this.ex().needShareLink;
      this.emit();
      return;
    }
    const parsed = parseRoomId(code);
    if (!parsed) {
      this.onlineStatus = this.ex().needShareLink;
      this.emit();
      return;
    }
    this.pendingConfig = null;
    clearLocalProgress(SOLO_PROGRESS_SLUG);
    this.pendingRestore = null;
    this.settings = { ...this.settings, opponent: "online" };
    this.ctx.setSearch(new URLSearchParams({ room: parsed.roomId }), { replace: true });
    if (parsed.game !== "explosive-chess") return;
    this.connectToRoom(parsed.roomId);
  }

  private disconnectOnline(): void {
    this.intentionalLeave = true;
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearMoveLock();
    this.client?.close();
    this.client = null;
    this.configSentForRoom = null;
    this.onlinePhase = "idle";
    this.onlineStatus = "";
    this.onlinePlayers = [];
    this.onlineConfig = null;
    this.myColor = null;
    this.shareLink = "";
  }

  private scheduleReconnect(): void {
    const code = this.roomCode.trim().toLowerCase();
    if (!code || this.intentionalLeave) return;
    if (this.reconnectAttempts >= 8) {
      this.onlinePhase = "idle";
      this.onlineStatus = this.ex().reconnectFail;
      this.tip = this.ex().disconnected;
      this.clearMoveLock();
      this.emit();
      return;
    }
    const attempt = this.reconnectAttempts + 1;
    this.reconnectAttempts = attempt;
    this.onlinePhase = "reconnecting";
    this.onlineStatus = `${this.ex().connInterrupted} (${attempt}/8)`;
    this.tip = this.ex().connInterrupted;
    this.clearMoveLock();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = Math.min(1000 * attempt, 5000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.client || this.intentionalLeave) return;
      if (!this.client.reconnect()) {
        this.connectToRoom(code, { keepPlaying: true });
        return;
      }
      this.onlineStatus = `${this.ex().reconnecting} (${attempt}/8)`;
      this.emit();
    }, delay);
    this.emit();
  }

  private connectToRoom(code: string, opts?: { keepPlaying?: boolean }): void {
    const trimmed = code.trim().toLowerCase();
    if (!trimmed) {
      this.onlineStatus = this.ex().missingCode;
      this.emit();
      return;
    }
    this.intentionalLeave = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (!opts?.keepPlaying) {
      this.reconnectAttempts = 0;
      this.client?.close();
      this.destroyBoard();
      this.phase = "menu";
      this.gameOver = false;
      this.winner = null;
      this.winReason = "";
      this.onlinePlayers = [];
    }
    this.roomCode = trimmed;
    this.shareLink = shareUrl(trimmed);
    this.onlinePhase = opts?.keepPlaying ? "reconnecting" : "connecting";
    this.onlineStatus = opts?.keepPlaying ? this.ex().reconnectingStatus : this.ex().connecting;
    this.ctx.setSearch(new URLSearchParams({ room: trimmed }), { replace: true });
    clearLocalProgress(SOLO_PROGRESS_SLUG);
    this.pendingRestore = null;
    saveSettings({ ...this.settings, opponent: "online" });
    this.settings = { ...this.settings, opponent: "online" };
    this.clearMoveLock();

    const client = this.client ?? new ExplosiveOnlineClient();
    this.client = client;

    const bindHandlers = (): void => {
      client.connect(trimmed, {
        onOpen: () => {
          client.join({ playerId: getOrCreatePlayerId() });
          this.onlineStatus =
            opts?.keepPlaying || this.phase === "play" ? this.ex().reconnected : this.ex().connectedJoin;
          this.emit();
        },
        onWelcome: (payload) => {
          this.reconnectAttempts = 0;
          this.onlineSeat = payload.seat;
          this.onlineRole = payload.role;
          const color = seatToPlayerColor(payload.seat);
          this.myColor = color;
          if (color != null) this.playerColor = color;
          this.onlineStatus = `${this.ex().seatInfo}${seatLabel(payload.seat, this.ex())} (${payload.role})`;
          if (
            payload.canConfig === true &&
            this.pendingConfig === trimmed &&
            this.onlinePhase !== "playing" &&
            this.phase !== "play" &&
            this.configSentForRoom !== trimmed
          ) {
            this.configSentForRoom = trimmed;
            this.pendingConfig = null;
            const s = this.settings;
            client.setConfig({
              boardSize: s.boardSize,
              winMode: s.winMode,
              winParam: s.winParam,
              hostColor: s.hostColor,
              explosionDelayMs: s.explosionDelayMs,
            });
          }
          this.emit();
        },
        onRoom: (payload) => {
          this.onlinePlayers = payload.players;
          this.onlineConfig = payload.config;
          if (payload.phase === "lobby") {
            const leavingMatch = this.onlinePhase === "playing" || this.onlinePhase === "over";
            this.onlinePhase = "lobby";
            if (leavingMatch) this.resetMatchHud();
            if (this.phase !== "play") this.tip = this.ex().tipWaitJoin;
          } else if (payload.phase === "playing") {
            this.onlinePhase = "playing";
            const peerOffline = payload.players.some(
              (p) => (p.seat === "red" || p.seat === "blue") && !p.connected && p.playerId !== getOrCreatePlayerId(),
            );
            if (peerOffline) {
              this.onlineStatus = this.ex().peerOffline;
              this.tip = this.ex().peerWait;
            } else {
              const vsAgent = payload.players.some(
                (p) =>
                  p.kind === "agent" &&
                  p.playerId !== getOrCreatePlayerId() &&
                  (p.seat === "red" || p.seat === "blue"),
              );
              const progress = this.ex().inProgress;
              this.onlineStatus = vsAgent ? `${progress} · ${this.ex().vsAgent}` : progress;
            }
          } else if (payload.phase === "over") {
            this.onlinePhase = "over";
          }
          this.emit();
        },
        onGameStart: (payload) => {
          const newMatch =
            this.gameOver ||
            this.onlinePhase === "over" ||
            this.onlinePhase === "lobby" ||
            this.game == null;
          this.reconnectAttempts = 0;
          this.onlinePhase = "playing";
          this.onlineStatus = this.ex().gameStart;
          const yourColor = payload.yourColor === "red" || payload.yourColor === "blue" ? payload.yourColor : null;
          this.pendingOnlineStart = { config: payload.config, yourColor };
          if (yourColor == null) this.myColor = null;
          this.phase = "play";
          if (newMatch) {
            this.resetMatchHud();
            this.matchEpoch += 1;
          }
          this.clearMoveLock();
          this.emit();
          queueMicrotask(() => {
            this.tryMountOnlineBoard();
            this.emit();
          });
        },
        onState: (payload) => {
          this.reconnectAttempts = 0;
          if (this.phase !== "play") this.phase = "play";
          if (this.onlinePhase === "reconnecting" || this.onlinePhase === "connecting") {
            this.onlinePhase = payload.fullState.gameOver ? "over" : "playing";
          }
          if (!this.game) {
            this.pendingOnlineState = {
              fullState: payload.fullState,
              lastMove: payload.lastMove,
              animationFrames: payload.animationFrames,
            };
            this.clearMoveLock();
            queueMicrotask(() => {
              this.tryMountOnlineBoard();
              this.emit();
            });
          } else {
            void this.applyServerState(payload.fullState, payload.lastMove, payload.animationFrames);
          }
          if (payload.fullState.gameOver) this.onlinePhase = "over";
          this.emit();
        },
        onGameOver: (payload) => {
          this.onlinePhase = "over";
          this.gameOver = true;
          this.winner = payload.winner as MoveResult["winner"];
          this.winReason = payload.winReason;
          const ex = this.ex();
          this.tip = `${winnerLabel(this.winner, ex)}${
            payload.winReason ? ` · ${formatWinReason(payload.winReason, ex)}` : ""
          }`;
          this.clearMoveLock();
          this.emit();
        },
        onError: (payload) => {
          this.onlineStatus = `${this.ex().errorPrefix}${payload.message}`;
          this.clearMoveLock();
          this.emit();
        },
        onPeerLeft: () => {
          this.onlineStatus = this.ex().peerWait;
          this.tip = this.ex().peerTip;
          this.clearMoveLock();
          this.emit();
        },
        onRoomClosed: (payload) => {
          this.intentionalLeave = true;
          this.reconnectAttempts = 0;
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          this.clearMoveLock();
          this.client?.close();
          this.client = null;
          this.onlinePhase = "idle";
          this.onlinePlayers = [];
          this.onlineConfig = null;
          this.myColor = null;
          this.shareLink = "";
          this.roomCode = "";
          this.ctx.setSearch(new URLSearchParams(), { replace: true });
          this.onlineStatus = payload.reason || this.ex().roomRecycled;
          this.tip = this.ex().roomClosedTip;
          this.destroyBoard();
          this.phase = "menu";
          this.gameOver = false;
          this.emit();
        },
        onClose: () => {
          if (this.intentionalLeave) {
            this.onlinePhase = "idle";
            this.onlineStatus = this.ex().leftRoom;
            this.clearMoveLock();
            this.emit();
            return;
          }
          if (
            this.phase === "play" ||
            this.onlinePhase === "playing" ||
            this.onlinePhase === "over" ||
            this.onlinePhase === "lobby" ||
            this.onlinePhase === "reconnecting"
          ) {
            this.scheduleReconnect();
            return;
          }
          this.onlinePhase = "idle";
          this.onlineStatus = this.ex().connClosed;
          this.clearMoveLock();
          this.emit();
        },
      });
    };

    if (opts?.keepPlaying && client.currentRoomId === trimmed && client.isOpen) return;
    bindHandlers();
    this.emit();
  }
}

export const playModule: GamePlayModule = {
  createSession: (ctx) => new ExplosiveSession(ctx),
};
