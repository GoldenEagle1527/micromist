import { promptInviteAgent } from "../../../shared/explosive-chess/agent-handoff";
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
import { explosiveEn, explosiveZh } from "./i18n";
import {
  colorLabel,
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
  FRAME_DELAY_MS,
  SOLO_PROGRESS_SLUG,
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
type MenuStage = "root" | "solo" | "solo-config" | "online";

function dict(locale: SessionContext["locale"]) {
  return locale === "zh" ? explosiveZh : explosiveEn;
}

const CHROME_RED = "#e53935";
const CHROME_BLUE = "#1e88e5";

function explosiveChrome(opts: {
  turn: PlayerColor;
  gameOver: boolean;
  winner: MoveResult["winner"];
  winMode: WinMode;
  counts: { red: number; blue: number };
}): PlayChrome {
  let active: PlayChrome["active"] = opts.turn === COLOR_RED ? "left" : "right";
  if (opts.gameOver) {
    if (opts.winner === COLOR_RED) active = "left";
    else if (opts.winner === COLOR_BLUE) active = "right";
    else active = "both";
  }
  const showCells = opts.winMode === WIN_MODE_AREA;
  return {
    left: { color: CHROME_RED, value: showCells ? String(opts.counts.red) : undefined },
    right: { color: CHROME_BLUE, value: showCells ? String(opts.counts.blue) : undefined },
    active,
  };
}

class ExplosiveSession implements GameSession {
  private listeners = new Set<() => void>();
  private phase: "menu" | "play" = "menu";
  private menuStage: MenuStage = "root";
  private settings: Settings;
  private pendingRestore: SoloPersist | null;
  private localSession = 0;

  private turn: PlayerColor = COLOR_RED;
  private stepCount = 0;
  private counts = { red: 0, blue: 0 };
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

  private canvas: HTMLCanvasElement | null = null;
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
    const roomFromQuery = (ctx.search.get("room") ?? "").trim().toLowerCase();
    this.pendingRestore = loadSoloPersist(roomFromQuery);
    this.settings = loadSettings();
    if (roomFromQuery) {
      clearLocalProgress(SOLO_PROGRESS_SLUG);
      this.pendingRestore = null;
      this.settings = { ...this.settings, opponent: "online" };
      this.roomCode = roomFromQuery;
      this.menuStage = "online";
      this.onlineStatus = this.ex().openShare;
    } else if (this.pendingRestore) {
      this.settings = {
        ...this.settings,
        ...this.pendingRestore.settings,
        opponent: this.pendingRestore.settings.opponent,
      };
      this.localSession = this.pendingRestore.localSession ?? 0;
      this.phase = "play";
    }
    this.tip = this.ex().tipClick;
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
    const room = (this.ctx.search.get("room") ?? "").trim().toLowerCase();
    if (room && room !== this.roomCode && this.onlinePhase === "idle") {
      this.roomCode = room;
      this.settings = { ...this.settings, opponent: "online" };
      this.menuStage = "online";
      this.pendingRestore = null;
      clearLocalProgress(SOLO_PROGRESS_SLUG);
      this.onlineStatus = this.ex().openShare;
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
    if (itemId === "solo") {
      this.disconnectOnline();
      this.ctx.setSearch(new URLSearchParams(), { replace: true });
      this.menuStage = "solo";
      if (this.settings.opponent === "online") {
        this.settings = { ...this.settings, opponent: "ai" };
      }
      this.emit();
      return;
    }
    if (itemId === "online") {
      clearLocalProgress(SOLO_PROGRESS_SLUG);
      this.pendingRestore = null;
      this.settings = { ...this.settings, opponent: "online" };
      this.menuStage = "online";
      this.emit();
      return;
    }
    if (itemId === "ai" || itemId === "local") {
      this.settings = { ...this.settings, opponent: itemId };
      this.menuStage = "solo-config";
      this.emit();
    }
  }

  back(): void {
    if (this.phase === "play") {
      this.backToSetup();
      return;
    }
    if (this.menuStage === "solo-config") {
      this.menuStage = "solo";
      this.emit();
      return;
    }
    if (this.menuStage === "solo" || this.menuStage === "online") {
      if (this.menuStage === "online") this.disconnectOnline();
      this.menuStage = "root";
      this.emit();
    }
  }

  setParam(id: string, value: string | number): void {
    if (this.onlineConfig && this.onlinePhase !== "idle") return;
    const next = { ...this.settings };
    if (id === "boardSize") next.boardSize = Number(value) as 9 | 11 | 13;
    if (id === "winMode") next.winMode = String(value) as WinMode;
    if (id === "winParam") next.winParam = Math.max(1, Number(value) || 1);
    if (id === "difficulty") next.difficulty = String(value) as AiDifficulty;
    if (id === "redOwner") next.redOwner = value === "ai" ? "ai" : "player";
    if (id === "hostColor") next.hostColor = value === "blue" ? "blue" : "red";
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
      const code = this.roomCode || (this.ctx.search.get("room") ?? "").trim().toLowerCase();
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
      this.menuStage = "online";
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
    const canvas = document.createElement("canvas");
    host.append(canvas);
    this.canvas = canvas;
    if (this.phase === "play") {
      if (this.settings.opponent === "online") this.tryMountOnlineBoard();
      else this.mountLocalBoard();
    }
    return {
      destroy: () => {
        if (this.host === host) this.host = null;
        this.canvas = null;
        this.destroyBoard();
        host.replaceChildren();
      },
    };
  }

  snapshot(): GameSnapshot {
    const ex = this.ex();
    if (this.phase === "play") return this.playSnapshot(ex);

    const canBack = this.menuStage !== "root";
    const fields = this.paramFields(ex);
    const snap: GameSnapshot = {
      phase: "menu",
      title: ex.setupTitle,
      hint: ex.setupHint,
      menu: {
        items: this.menuItems(ex),
        canBack,
        backLabel: ex.backSetup,
      },
      params: fields.length ? { fields } : undefined,
      actions: this.menuActions(ex),
      room: this.menuStage === "online" ? this.roomPane(ex, true) : undefined,
      invite: {
        line: ex.agentInviteLine,
        copied: ex.agentInviteCopied,
        failed: ex.agentInviteFailed,
        text: promptInviteAgent(this.ctx.origin, this.ctx.locale),
      },
      status: this.menuStage === "online" ? undefined : undefined,
    };
    return snap;
  }

  private menuItems(ex: Record<string, string>) {
    if (this.menuStage === "root") {
      return [
        { id: "solo", label: ex.solo },
        { id: "online", label: ex.online },
      ];
    }
    if (this.menuStage === "solo") {
      return [
        { id: "ai", label: ex.vsAi },
        { id: "local", label: ex.hotseat },
      ];
    }
    return [];
  }

  private menuActions(ex: Record<string, string>): ShellAction[] {
    if (this.menuStage === "solo-config") {
      return [{ id: "start", label: ex.start, kind: "primary" }];
    }
    if (this.menuStage === "online") {
      const actions: ShellAction[] = [];
      const roomFromQuery = (this.ctx.search.get("room") ?? "").trim();
      if (this.onlinePhase === "idle" || this.onlinePhase === "connecting" || this.onlinePhase === "reconnecting") {
        if (!roomFromQuery && this.onlinePhase !== "reconnecting") {
          actions.push({
            id: "create-room",
            label: ex.createRoom,
            kind: "primary",
            disabled: this.onlinePhase === "connecting",
          });
        } else {
          actions.push({
            id: "join-room",
            label: this.onlinePhase === "reconnecting" ? ex.reconnecting : ex.joinRoom,
            kind: "primary",
            disabled: this.onlinePhase === "connecting" || this.onlinePhase === "reconnecting",
          });
        }
      }
      if (this.onlinePhase === "lobby" || this.onlinePhase === "connecting") {
        actions.push({ id: "leave-room", label: ex.leaveRoom, kind: "ghost" });
      }
      return actions;
    }
    return [];
  }

  private paramFields(ex: Record<string, string>): ParamField[] {
    const online = this.menuStage === "online" || this.settings.opponent === "online";
    const inConfig = this.menuStage === "solo-config" || this.menuStage === "online";
    if (!inConfig) return [];
    const locked = online && this.onlinePhase !== "idle";
    const cfg = this.onlineConfig;
    const boardSize = cfg?.boardSize ?? this.settings.boardSize;
    const winMode = cfg?.winMode ?? this.settings.winMode;
    const winParam = cfg?.winParam ?? this.settings.winParam;
    const fields: ParamField[] = [
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
    if (this.menuStage === "solo-config" && this.settings.opponent === "ai") {
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
    if (this.menuStage === "online" && (this.onlinePhase === "idle" || cfg) && !this.ctx.search.get("room")) {
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
    const status = this.gameOver
      ? `${winnerLabel(this.winner, ex)}${this.winReason ? ` · ${formatWinReason(this.winReason, ex)}` : ""}${
          online && this.onlineStatus ? ` · ${this.onlineStatus}` : ""
        }`
      : `${this.tip}${online && this.onlineStatus ? ` · ${this.onlineStatus}` : ""}`;
    const winMode = this.onlineConfig?.winMode ?? this.settings.winMode;
    return {
      phase: "play",
      chrome: explosiveChrome({
        turn: this.turn,
        gameOver: this.gameOver,
        winner: this.winner,
        winMode,
        counts: this.counts,
      }),
      hud: [
        { id: "steps", label: ex.stepsHud, value: String(this.stepCount) },
        ...(online
          ? [
              {
                id: "you",
                label: ex.you,
                value: this.myColor != null ? colorLabel(this.myColor, ex) : ex.youAreSpectator,
              },
            ]
          : []),
      ],
      status,
      actions,
      room: online && this.onlinePlayers.length > 0 ? this.roomPane(ex, false) : undefined,
    };
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
      } · ${ex.hostLabel} ${cfg.hostColor === "red" ? ex.colorRed : ex.colorBlue}`;
    }
    if (inMenu && this.onlinePhase !== "idle" && this.onlinePhase !== "connecting") {
      /* keep */
    }
    return {
      title: ex.onlineLobby,
      status,
      code: this.roomCode && (this.onlinePhase === "lobby" || this.onlinePhase === "connecting") ? this.roomCode : undefined,
      shareUrl: this.shareLink || undefined,
      shareLabel: ex.copyLink,
      copiedLabel: ex.linkCopied,
      seats: this.seatChips(ex),
    };
  }

  private seatChips(ex: Record<string, string>): SeatChip[] {
    if (this.onlinePlayers.length === 0) return [];
    const me = getOrCreatePlayerId();
    const red = this.onlinePlayers.find((p) => p.seat === "red");
    const blue = this.onlinePlayers.find((p) => p.seat === "blue");
    const spectators = this.onlinePlayers.filter((p) => p.seat === "spectator");
    const mine = this.onlinePlayers.find((p) => p.playerId === me);
    const lobby = this.onlinePhase === "lobby";
    const describe = (p?: RoomPlayer) => {
      if (!p) return ex.seatEmpty;
      return `${p.name}${p.playerId === me ? ` (${ex.you})` : ""}${p.kind === "agent" ? ` · ${ex.agentMark}` : ""} · ${p.role}${
        p.connected ? "" : ` · ${ex.offline}`
      }`;
    };
    const seat = (id: "red" | "blue", occupant?: RoomPlayer): SeatChip => ({
      id,
      label: `${id === "red" ? ex.seatRed : ex.seatBlue} · ${describe(occupant)}`,
      canClaim: Boolean(lobby && !occupant && mine && mine.seat !== id),
      isYou: occupant?.playerId === me,
    });
    const chips: SeatChip[] = [seat("red", red), seat("blue", blue)];
    chips.push({
      id: "spectators",
      label: `${ex.spectatorsLabel} · ${spectators.length === 0 ? ex.seatEmpty : String(spectators.length)}`,
    });
    for (const p of spectators) {
      chips.push({
        id: p.playerId,
        label: `${p.name}${p.playerId === me ? ` (${ex.you})` : ""}${p.kind === "agent" ? ` · ${ex.agentMark}` : ""}${
          p.connected ? "" : ` · ${ex.offline}`
        }`,
        isYou: p.playerId === me,
      });
    }
    return chips;
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  private syncHud(game: GameInstance): void {
    this.turn = game.currentTurn;
    this.stepCount = game.stepCount;
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
      await new Promise((r) => setTimeout(r, FRAME_DELAY_MS));
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
    const shouldAnimate = mode === "local" || mode === "online" || this.settings.difficulty === "easy";
    if (shouldAnimate && result.animationFrames.length > 0) {
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
    const canvas = this.canvas;
    const renderer = this.renderer;
    if (!canvas || !renderer) return;
    canvas.onclick = (e) => this.handlePointer(e.clientX, e.clientY);
    canvas.onmousemove = (e) => {
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
    canvas.onmouseleave = () => this.renderer?.clearHover();
    canvas.ontouchstart = (e) => {
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
    const canvas = this.canvas;
    if (!canvas || this.settings.opponent === "online") {
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
    const renderer = createBoardRenderer(canvas, game);
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
    if (!this.canvas || this.renderer) return;
    const renderer = createBoardRenderer(this.canvas, game);
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
    if (animationFrames && animationFrames.length > 0) {
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
      this.menuStage = "online";
    } else {
      clearLocalProgress(SOLO_PROGRESS_SLUG);
      this.pendingRestore = null;
      this.menuStage = "solo-config";
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
    const code = (this.ctx.search.get("room") ?? "").trim().toLowerCase() || this.roomCode;
    if (!code) {
      this.onlineStatus = this.ex().needShareLink;
      this.emit();
      return;
    }
    clearLocalProgress(SOLO_PROGRESS_SLUG);
    this.pendingRestore = null;
    this.settings = { ...this.settings, opponent: "online" };
    this.connectToRoom(code);
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
      this.menuStage = "online";
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
          client.join({ playerId: getOrCreatePlayerId(), name: "Player" });
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
            });
          }
          this.emit();
        },
        onRoom: (payload) => {
          this.onlinePlayers = payload.players;
          this.onlineConfig = payload.config;
          if (payload.phase === "lobby") {
            this.onlinePhase = "lobby";
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
          this.reconnectAttempts = 0;
          this.onlinePhase = "playing";
          this.onlineStatus = this.ex().gameStart;
          const yourColor = payload.yourColor === "red" || payload.yourColor === "blue" ? payload.yourColor : null;
          this.pendingOnlineStart = { config: payload.config, yourColor };
          if (yourColor == null) this.myColor = null;
          this.phase = "play";
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
          this.menuStage = "online";
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
