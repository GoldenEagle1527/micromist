import { promptInviteAgent } from "../../../shared/chroma-slide/agent-handoff";
import type {
  GameAction,
  GamePlayModule,
  GameSession,
  GameSnapshot,
  SessionContext,
} from "../../platform/play";
import { clearLocalProgress, loadLocalProgress, saveLocalProgress } from "../local-persist";
import {
  EMPTY,
  PRESETS,
  TILE_COLORS,
  clickMove,
  isLegalClick,
  isWon,
  newPuzzle,
  normalizePresetId,
  type PresetId,
  type PuzzleState,
} from "./engine";
import { chromaEn, chromaZh, type ChromaDict } from "./i18n";
import {
  OnlineRoomClient,
  getOrCreatePlayerIdForGame,
  type Phase,
  type RoomPlayer,
  type Seat,
} from "../../multiplayer/OnlineRoomClient";
import type { ChromaPublicState } from "../../../shared/chroma-slide/observe";
import { loadScores, recordWin, type ChromaRunRecord, type ChromaScores } from "./scores";
import "./chroma-slide.css";

type ChromaPersist = {
  screen: "playing";
  preset: PresetId;
  puzzle: PuzzleState;
};

type You = { playerId: string; seat: Seat; name?: string };

const SLUG = "chroma-slide";

function dict(locale: SessionContext["locale"]): ChromaDict {
  return locale === "zh" ? chromaZh : chromaEn;
}

function presetTitle(ch: ChromaDict, id: PresetId): string {
  const p = PRESETS[id];
  const name = id === "easy" ? ch.easy : id === "normal" ? ch.normal : ch.hard;
  return `${name} · ${p.size}×${p.size} · ${p.squareSide}×${p.squareSide}`;
}

function isPublicState(value: unknown): value is ChromaPublicState {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<ChromaPublicState>;
  return Array.isArray(row.board) && !!row.config && typeof row.config === "object";
}

function readPublic(payload: Record<string, unknown>): ChromaPublicState | null {
  if (isPublicState(payload.publicState)) return payload.publicState;
  const observation = payload.observation;
  if (observation && typeof observation === "object") {
    const nested = (observation as { publicState?: unknown }).publicState;
    if (isPublicState(nested)) return nested;
  }
  return null;
}

function puzzleFromPublic(pub: ChromaPublicState): PuzzleState | null {
  if (pub.board.length === 0) return null;
  const size = pub.config.size;
  const board: number[] = [];
  let emptyIndex = 0;
  for (const row of pub.board) {
    for (const cell of row) {
      if (cell.empty || cell.color == null) {
        emptyIndex = board.length;
        board.push(EMPTY);
      } else {
        board.push(cell.color);
      }
    }
  }
  if (board.length !== size * size) return null;
  return {
    preset: pub.config.preset,
    size,
    colorCount: pub.config.colorCount,
    board,
    emptyIndex,
    steps: pub.steps,
  };
}

function paintPuzzle(
  host: HTMLElement,
  puzzle: PuzzleState,
  opts: {
    ch: ChromaDict;
    won: boolean;
    disabled: boolean;
    hoverIndex: number | null;
    onClick: (index: number) => void;
    onHover: (index: number | null) => void;
  },
): void {
  const { size, board, emptyIndex } = puzzle;
  const legalHover =
    opts.hoverIndex != null &&
    !opts.won &&
    !opts.disabled &&
    isLegalClick(puzzle, opts.hoverIndex);

  let root = host.querySelector<HTMLDivElement>(".chroma-board");
  if (!root) {
    host.replaceChildren();
    root = document.createElement("div");
    root.className = "chroma-board glass";
    root.setAttribute("role", "grid");
    host.append(root);
  }
  root.setAttribute("aria-label", opts.ch.boardAria);
  root.classList.toggle("chroma-board-won", opts.won);
  root.style.setProperty("--chroma-size", String(size));
  root.onmouseleave = () => opts.onHover(null);

  const wanted = board.length;
  while (root.childElementCount > wanted) root.lastElementChild?.remove();
  for (let index = 0; index < wanted; index += 1) {
    let btn = root.children[index] as HTMLButtonElement | undefined;
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "gridcell");
      root.append(btn);
    }
    const cell = board[index];
    const isEmpty = cell === EMPTY || index === emptyIndex;
    const isHoverTarget = legalHover && opts.hoverIndex === index;
    const onLine =
      legalHover &&
      opts.hoverIndex != null &&
      (() => {
        const er = Math.floor(emptyIndex / size);
        const ec = emptyIndex % size;
        const hr = Math.floor(opts.hoverIndex / size);
        const hc = opts.hoverIndex % size;
        const r = Math.floor(index / size);
        const c = index % size;
        if (er === hr) {
          const lo = Math.min(ec, hc);
          const hi = Math.max(ec, hc);
          return r === er && c >= lo && c <= hi;
        }
        const lo = Math.min(er, hr);
        const hi = Math.max(er, hr);
        return c === ec && r >= lo && r <= hi;
      })();
    btn.className = [
      "chroma-cell",
      isEmpty ? "chroma-empty" : "",
      isHoverTarget ? "chroma-cell-target" : "",
      onLine && !isEmpty ? "chroma-cell-path" : "",
      opts.won && !isEmpty ? "chroma-cell-won" : "",
    ]
      .filter(Boolean)
      .join(" ");
    if (isEmpty) btn.style.removeProperty("background-color");
    else btn.style.backgroundColor = TILE_COLORS[cell] ?? "#888";
    btn.disabled = opts.disabled || opts.won || isEmpty;
    btn.setAttribute(
      "aria-label",
      isEmpty
        ? opts.ch.emptyAria
        : opts.ch.tileAria(cell + 1, Math.floor(index / size) + 1, (index % size) + 1),
    );
    btn.onclick = () => opts.onClick(index);
    btn.onmouseenter = () => opts.onHover(index);
    btn.onfocus = () => opts.onHover(index);
  }
}

class ChromaSession implements GameSession {
  private listeners = new Set<() => void>();
  private phase: "menu" | "play" = "menu";
  private preset: PresetId = "easy";
  private puzzle: PuzzleState | null = null;
  private hoverIndex: number | null = null;
  private scores: ChromaScores = loadScores();
  private dialog: GameSnapshot["dialog"] = undefined;
  private boardHost: HTMLElement | null = null;
  private recordedWin = false;
  private startedAt: number | null = null;

  private roomCode = "";
  private roomClient: OnlineRoomClient | null = null;
  private you: You | null = null;
  private roomPhase: Phase = "lobby";
  private roomPlayers: RoomPlayer[] = [];
  private pub: ChromaPublicState | null = null;
  private roomError = "";
  private roomClosed = false;

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
    this.leaveRoom(false);
    this.listeners.clear();
    this.boardHost = null;
  }

  choose(itemId: string): void {
    if (itemId === "claim-player") {
      this.roomClient?.send("claim_seat", { seat: "player" });
      return;
    }
    if (this.roomCode) return;
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
    if (id === "preset" && typeof value === "string") {
      const next = normalizePresetId(value);
      if (next) this.preset = next;
      this.emit();
    }
  }

  dispatch(action: GameAction): void {
    const id = action.type === "ui" && typeof action.id === "string" ? action.id : action.type;
    if (id === "start") {
      this.startLocal();
      return;
    }
    if (id === "reshuffle") {
      if (!this.puzzle) return;
      this.puzzle = newPuzzle(this.puzzle.preset);
      this.hoverIndex = null;
      this.dialog = undefined;
      this.startedAt = Date.now();
      this.recordedWin = false;
      this.persist();
      this.emit();
      return;
    }
    if (id === "setup") {
      this.goMenu(true);
      return;
    }
    if (id === "play-again") {
      this.goMenu(true);
      return;
    }
    if (id === "dismiss-win" || id === "dismiss-dialog") {
      this.dialog = undefined;
      this.emit();
      return;
    }
    if (id === "leave-room") {
      this.leaveRoom(true);
      return;
    }
    if (action.type === "claim-seat" || id === "claim-player") {
      this.roomClient?.send("claim_seat", { seat: "player" });
      return;
    }
    if (action.type === "move" && typeof action.index === "number") {
      this.clickCell(action.index);
    }
  }

  bindBoard(host: HTMLElement) {
    this.boardHost = host;
    this.paint();
    return {
      destroy: () => {
        if (this.boardHost === host) this.boardHost = null;
        host.replaceChildren();
      },
    };
  }

  snapshot(): GameSnapshot {
    const ch = dict(this.ctx.locale);
    if (this.roomCode) return this.roomSnapshot(ch);

    if (this.phase === "menu") {
      const p = PRESETS[this.preset];
      return {
        phase: "menu",
        title: ch.setupTitle,
        hint: `${ch.setupHint} ${ch.presetBlurb(p.size, p.colorCount, p.squareSide)}`,
        params: {
          fields: [
            {
              id: "preset",
              label: ch.difficulty,
              type: "select",
              value: this.preset,
              options: (["easy", "normal", "hard"] as PresetId[]).map((id) => ({
                value: id,
                label: presetTitle(ch, id),
              })),
            },
          ],
        },
        actions: [{ id: "start", label: ch.start, kind: "primary" }],
        records: this.records(ch),
        invite: {
          line: ch.agentInviteLine,
          copied: ch.agentInviteCopied,
          failed: ch.agentInviteFailed,
          text: promptInviteAgent(this.ctx.origin, this.ctx.locale),
        },
      };
    }

    const puzzle = this.puzzle;
    const won = puzzle ? isWon(puzzle) : false;
    return {
      phase: "play",
      hud: [
        {
          id: "steps",
          label: ch.stepsHud,
          value: String(puzzle?.steps ?? 0),
        },
      ],
      status: won && puzzle ? ch.winMessage(puzzle.steps) : ch.playHint,
      actions: [
        {
          id: "reshuffle",
          label: ch.reshuffle,
          kind: "ghost",
          disabled: Boolean(this.dialog),
          confirm: {
            title: ch.confirmReshuffleTitle,
            body: ch.confirmReshuffleBody,
            ok: ch.confirmOk,
            cancel: ch.confirmCancel,
          },
        },
        {
          id: "setup",
          label: ch.adjustSettings,
          kind: "ghost",
          disabled: Boolean(this.dialog),
          confirm: {
            title: ch.confirmSetupTitle,
            body: ch.confirmSetupBody,
            ok: ch.confirmOk,
            cancel: ch.confirmCancel,
          },
        },
      ],
      dialog: this.dialog,
    };
  }

  private records(ch: ChromaDict): GameSnapshot["records"] {
    const row = (run: ChromaRunRecord, id: string, badge?: string) => ({
      id,
      title: `${ch.stepsCount(run.steps)} · ${presetTitle(ch, run.preset).split(" · ")[0]}`,
      meta: [ch.playedAt(run.at), run.durationMs != null ? ch.durationLabel(run.durationMs) : ""]
        .filter(Boolean)
        .join(" · "),
      badge,
    });
    return {
      title: ch.historyTitle,
      empty: ch.emptyHistory,
      groups: [
        {
          id: "best",
          label: ch.bestLabel,
          rows: this.scores.best ? [row(this.scores.best, `best-${this.scores.best.at}`, ch.bestLabel)] : [],
        },
        {
          id: "recent",
          label: ch.recentLabel,
          rows: this.scores.recent.map((run) => row(run, `${run.at}-${run.steps}-${run.preset}`)),
        },
      ],
    };
  }

  private roomSnapshot(ch: ChromaDict): GameSnapshot {
    const pub = this.pub;
    const solver = this.roomPlayers.find((p) => p.seat === "player");
    const won = pub?.won === true || this.roomPhase === "over";
    const status = this.roomClosed
      ? ch.roomClosed
      : this.roomError
        ? this.roomError
        : !this.you
          ? ch.roomConnecting
          : won && pub
            ? ch.roomSolved(pub.steps)
            : this.you.seat === "player"
              ? ch.roomYouSolve
              : solver
                ? ch.roomWatching(solver.name)
                : ch.roomWaiting;
    const canClaim = this.you?.seat === "spectator" && this.roomPhase === "lobby" && !solver;
    const you = this.you;
    const solverLabel = solver?.name || "player";
    return {
      phase: this.puzzle || pub ? "play" : "menu",
      title: ch.roomTitle,
      hint: this.puzzle || pub ? undefined : status,
      hud: [
        { id: "room", value: ch.roomCode(this.roomCode) },
        ...(pub
          ? [
              { id: "preset", value: String(pub.config.preset) },
              { id: "steps", label: ch.stepsHud, value: String(pub.steps) },
            ]
          : []),
      ],
      status:
        status +
        (this.you?.seat === "spectator" && this.roomPhase === "playing" ? ` · ${ch.roomSpectatorHint}` : ""),
      actions: [
        ...(canClaim ? [{ id: "claim-player", label: ch.roomClaim, kind: "primary" as const }] : []),
        { id: "leave-room", label: ch.roomBack, kind: "ghost" as const },
      ],
      room: {
        title: ch.roomTitle,
        status,
        code: this.roomCode,
        seats: [
          {
            id: "player",
            label: solver ? solverLabel : ch.roomClaim,
            canClaim,
            isYou: you?.seat === "player",
            detail: solver && you?.seat !== "player" ? ch.roomWatching(solver.name) : undefined,
          },
        ],
      },
    };
  }

  private emit(): void {
    this.maybeRecordWin();
    this.paint();
    this.listeners.forEach((fn) => fn());
  }

  private paint(): void {
    if (!this.boardHost || this.phase !== "play" && !this.roomCode) return;
    const puzzle = this.puzzle;
    if (!puzzle) {
      this.boardHost.replaceChildren();
      return;
    }
    const ch = dict(this.ctx.locale);
    const won = this.roomCode ? this.pub?.won === true || this.roomPhase === "over" : isWon(puzzle);
    const solving = this.roomCode
      ? this.you?.seat === "player" && this.roomPhase === "playing" && this.pub?.won !== true
      : !won && !this.dialog;
    paintPuzzle(this.boardHost, puzzle, {
      ch,
      won,
      disabled: !solving,
      hoverIndex: this.roomCode ? null : this.hoverIndex,
      onClick: (index) => this.clickCell(index),
      onHover: (index) => {
        if (this.roomCode) return;
        if (this.hoverIndex === index) return;
        this.hoverIndex = index;
        this.emit();
      },
    });
  }

  private clickCell(index: number): void {
    if (this.roomCode) {
      const puzzle = this.puzzle;
      if (!this.roomClient || !puzzle) return;
      const solving = this.you?.seat === "player" && this.roomPhase === "playing" && this.pub?.won !== true;
      if (!solving || !isLegalClick(puzzle, index)) return;
      this.roomClient.send("move", { row: Math.floor(index / puzzle.size), col: index % puzzle.size });
      return;
    }
    if (!this.puzzle || isWon(this.puzzle) || this.dialog) return;
    const next = clickMove(this.puzzle, index);
    if (next !== this.puzzle) {
      this.puzzle = next;
      this.hoverIndex = null;
      this.persist();
      this.emit();
    }
  }

  private maybeRecordWin(): void {
    if (this.roomCode || !this.puzzle || !isWon(this.puzzle) || this.recordedWin) return;
    this.recordedWin = true;
    const at = Date.now();
    const durationMs =
      this.startedAt != null && at >= this.startedAt ? at - this.startedAt : undefined;
    const { scores, isNewBest } = recordWin({
      steps: this.puzzle.steps,
      preset: this.puzzle.preset,
      at,
      ...(durationMs != null ? { durationMs } : {}),
    });
    this.scores = scores;
    const ch = dict(this.ctx.locale);
    this.dialog = {
      id: "win",
      title: ch.winModalTitle,
      body: `${ch.winMessage(this.puzzle.steps)}${isNewBest ? ` · ${ch.newBestBadge}` : ""}`,
      ok: ch.playAgain,
      cancel: ch.confirmCancel,
      actionId: "play-again",
    };
  }

  private startLocal(): void {
    this.puzzle = newPuzzle(this.preset);
    this.hoverIndex = null;
    this.dialog = undefined;
    this.startedAt = Date.now();
    this.recordedWin = false;
    this.phase = "play";
    this.persist();
    this.emit();
  }

  private goMenu(clearProgress: boolean): void {
    this.phase = "menu";
    this.puzzle = null;
    this.hoverIndex = null;
    this.dialog = undefined;
    this.startedAt = null;
    this.recordedWin = false;
    this.scores = loadScores();
    if (clearProgress) clearLocalProgress(SLUG);
    this.emit();
  }

  private hydrate(): void {
    const data = loadLocalProgress<ChromaPersist>(SLUG);
    if (!data || data.screen !== "playing" || !data.puzzle) return;
    const pid = normalizePresetId(data.preset) ?? normalizePresetId(data.puzzle.preset) ?? "easy";
    const expect = PRESETS[pid];
    const pz = data.puzzle;
    if (
      pz.size !== expect.size ||
      pz.colorCount !== expect.colorCount ||
      pz.board.length !== expect.size * expect.size
    ) {
      return;
    }
    this.preset = pid;
    this.puzzle = { ...pz, preset: pid };
    this.recordedWin = isWon(this.puzzle);
    if (this.recordedWin) {
      const ch = dict(this.ctx.locale);
      this.dialog = {
        id: "win",
        title: ch.winModalTitle,
        body: ch.winMessage(this.puzzle.steps),
        ok: ch.playAgain,
        cancel: ch.confirmCancel,
        actionId: "play-again",
      };
    }
    this.phase = "play";
  }

  private persist(): void {
    if (this.roomCode || this.phase !== "play" || !this.puzzle) return;
    saveLocalProgress<ChromaPersist>(SLUG, {
      screen: "playing",
      preset: this.preset,
      puzzle: this.puzzle,
    });
  }

  private enterRoom(code: string): void {
    this.roomCode = code;
    this.phase = "play";
    const room = new OnlineRoomClient("chroma-slide");
    const playerId = getOrCreatePlayerIdForGame("chroma-slide");
    this.roomClient = room;
    room.connect(code, {
      onOpen: () => {
        room.join({ playerId, name: "Player" });
        this.emit();
      },
      onWelcome: (payload) => {
        this.you = { playerId: payload.playerId, seat: payload.seat };
        this.emit();
      },
      onRoom: (payload) => {
        this.roomPhase = payload.phase;
        this.roomPlayers = payload.players;
        this.emit();
      },
      onError: (payload) => {
        this.roomError = payload.message;
        this.emit();
      },
      onRoomClosed: () => {
        this.roomClosed = true;
        this.emit();
      },
      onMessage: (type, payload) => {
        if (type === "seated") {
          const seated = payload.you;
          if (seated && typeof seated === "object") {
            const body = seated as { playerId?: unknown; seat?: unknown };
            if (typeof body.playerId === "string" && typeof body.seat === "string") {
              this.you = { playerId: body.playerId, seat: body.seat as Seat };
            }
          }
        }
        const next = readPublic(payload);
        if (next && (type === "state" || type === "move_applied" || type === "your_turn" || type === "observation")) {
          this.pub = next;
          this.puzzle = puzzleFromPublic(next);
          this.roomError = "";
          this.emit();
        }
      },
    });
  }

  private leaveRoom(clearUrl: boolean): void {
    this.roomClient?.close();
    this.roomClient = null;
    this.roomCode = "";
    this.you = null;
    this.roomPlayers = [];
    this.pub = null;
    this.puzzle = null;
    this.roomError = "";
    this.roomClosed = false;
    this.phase = "menu";
    if (clearUrl) this.ctx.setSearch(new URLSearchParams(), { replace: true });
  }
}

export const playModule: GamePlayModule = {
  createSession: (ctx) => new ChromaSession(ctx),
};
