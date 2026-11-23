/**
 * Generic play shell contracts.
 * This package must stay game-agnostic: no slug checks, no per-game fields.
 * Games inject a session that already localized every string.
 */

export type GameAction = {
  type: string;
  [key: string]: unknown;
};

export type MenuItem = {
  id: string;
  label: string;
};

export type ParamOption = {
  value: string;
  label: string;
};

export type ParamField =
  | {
      id: string;
      label: string;
      type: "select";
      value: string;
      options: ParamOption[];
      disabled?: boolean;
    }
  | {
      id: string;
      label: string;
      type: "number";
      value: number;
      min?: number;
      max?: number;
      disabled?: boolean;
    }
  | {
      id: string;
      label: string;
      type: "text";
      value: string;
      disabled?: boolean;
    };

export type HudItem = {
  id: string;
  label?: string;
  value: string;
};

export type ConfirmSpec = {
  title: string;
  body: string;
  ok: string;
  cancel: string;
};

export type ShellAction = {
  id: string;
  label: string;
  kind?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  confirm?: ConfirmSpec;
};

export type RecordRow = {
  id: string;
  title: string;
  meta?: string;
  badge?: string;
};

export type RecordsPane = {
  title: string;
  empty: string;
  groups: { id: string; label: string; rows: RecordRow[] }[];
};

export type SeatChip = {
  id: string;
  /** Seat title (Black / Red / Player). */
  label: string;
  /** Occupant display name when seated. */
  occupant?: string;
  /** Empty / online / offline. */
  status?: string;
  detail?: string;
  canClaim?: boolean;
  isYou?: boolean;
  claimLabel?: string;
};

export type RoomRuleLine = {
  label: string;
  value: string;
};

export type RoomSpectator = {
  id: string;
  label: string;
  isYou?: boolean;
};

export type RoomRosterPlayer = {
  playerId: string;
  name: string;
  seat: string;
  connected?: boolean;
  kind?: string;
};

export type RoomRosterSeat = {
  id: string;
  label: string;
  claimLabel?: string;
};

/** Raw room list. The shell turns this into seats, spectators, and the name strip. */
export type RoomRoster = {
  youId?: string;
  players: RoomRosterPlayer[];
  seats: RoomRosterSeat[];
  claimable?: boolean;
};

export type RoomPane = {
  title: string;
  status?: string;
  code?: string;
  shareUrl?: string;
  shareLabel?: string;
  copiedLabel?: string;
  rules?: {
    title: string;
    frozen?: boolean;
    frozenLabel?: string;
    lines: RoomRuleLine[];
  };
  roster?: RoomRoster;
  seats?: SeatChip[];
  spectators?: {
    title: string;
    empty: string;
    watching?: string;
    people: RoomSpectator[];
  };
};

export type InvitePane = {
  line: string;
  copied: string;
  failed: string;
  text: string;
};

export type DialogState = {
  id: string;
  title: string;
  body: string;
  ok: string;
  cancel?: string;
  actionId: string;
};

/** Game-registered topbar capsule + play-area glow. Never drawn on the board. */
export type PlayChromeSide = {
  /** CSS color the game owns (not a platform seat name). */
  color: string;
  /** Short number for the half-capsule slot (captures, cells, steps). */
  value?: string;
};

export type PlayChromeActive = "left" | "right" | "none" | "both";

export type PlayMatchSide = {
  name: string;
  vacant?: boolean;
};

export type PlayChrome = {
  /** Defaults to the catalog title in the site header. */
  title?: string;
  /** Replaces the title in the capsule while set (win, thinking, disconnect). */
  notice?: string;
  left: PlayChromeSide;
  right: PlayChromeSide;
  active: PlayChromeActive;
  /**
   * Names hang under the capsule in the existing topbar–board gap.
   * Must not grow the topbar: the strip is absolutely positioned.
   */
  match?: {
    left?: PlayMatchSide;
    right?: PlayMatchSide;
    rulesShort?: string;
    rulesDetail?: string;
    spectatorsLabel?: string;
    spectators?: string[];
  };
};

export type GameSnapshot = {
  phase: "menu" | "play";
  title?: string;
  hint?: string;
  chrome?: PlayChrome;
  menu?: {
    items: MenuItem[];
    canBack?: boolean;
    backLabel?: string;
  };
  params?: {
    fields: ParamField[];
  };
  hud?: HudItem[];
  status?: string;
  actions?: ShellAction[];
  records?: RecordsPane;
  room?: RoomPane;
  invite?: InvitePane;
  dialog?: DialogState;
};

export type BoardHandle = {
  destroy: () => void;
};

export type SessionContext = {
  locale: "zh" | "en";
  path: string;
  origin: string;
  search: URLSearchParams;
  setSearch: (next: URLSearchParams, opts?: { replace?: boolean }) => void;
};

export type GameSession = {
  snapshot: () => GameSnapshot;
  subscribe: (listener: () => void) => () => void;
  choose: (itemId: string) => void;
  back: () => void;
  setParam: (id: string, value: string | number) => void;
  dispatch: (action: GameAction) => void;
  bindBoard: (host: HTMLElement) => BoardHandle;
  /** Shell calls this when locale or URL context changes. */
  syncContext: () => void;
  destroy: () => void;
};

export type GamePreview = (ctx: SessionContext) => GameSnapshot;

export type GamePlayModule = {
  createSession: (ctx: SessionContext) => GameSession;
};
