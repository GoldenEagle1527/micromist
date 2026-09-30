/** Setup-screen strings for the mode choice and the conserve save slot (plugged into the deep-march dictionary as `setup`). */
import type { GameMode } from "../../modes/gameMode";

export type SetupDict = {
  modeTitle: string;
  modes: Record<GameMode, string>;
  /** Conserve-mode description (the free dive keeps the game's setupHint). */
  conserveHint: string;
  /** Extra control lines shown under the shared ones in conserve mode. */
  conserveControls: string[];
  slot: {
    loading: string;
    failed: string;
    empty: string;
    ready: (seed: string, gen: number, dives: number) => string;
    ended: (seed: string) => string;
    unreadable: string;
    newWorld: string;
    overwriteWarning: string;
    cancelNew: string;
  };
  start: { newWorld: string; continueWorld: string; overwrite: string };
  /** In the play area when the conserve module could not be downloaded. */
  moduleFailed: string;
};

export const setupEn: SetupDict = {
  modeTitle: "Mode",
  modes: { conserve: "Deep March · Conservation", free: "Free dive" },
  conserveHint:
    "A bounded 10 × 10 sea inside a ring wall. Every particle is counted and saved: what you take and lock in your base leaves the sea emptier and the wall thinner. Harvest nodes, found a base, deposit, and call the tide to remake the world — then watch the wall, the first cracks, and what waits outside.",
  conserveControls: [
    "Aim at a glowing node (it lights up) and hold E / left mouse / ABSORB to draw its particles into the 200-particle tank",
    "Hold X or the ⟲ button 2 s: emergency recall — outside the base the tank stays behind as a lost cache (marked on the compass), inside it goes into storage",
    "G / BUILD — build mode (T next building, E / PLACE to place; the base core first) · Q / Base button — the base panel: deposit, withdraw, release, lighthouse switch, call the tide · H — dismiss a tip",
  ],
  slot: {
    loading: "Reading the world save…",
    failed: "The conservation mode could not be loaded — check the connection and try again.",
    empty: "No world yet. Pick a seed to create one.",
    ready: (seed, gen, dives) => `Your world · seed ${seed} · generation ${gen} · ${dives} dive${dives === 1 ? "" : "s"}`,
    ended: (seed) => `The world of seed ${seed} has been annihilated. Only a new world can be entered.`,
    unreadable: "The world save can't be read. A new world would replace it.",
    newWorld: "New world…",
    overwriteWarning: "Creating a new world replaces the current one. This can't be undone.",
    cancelNew: "Keep my world",
  },
  start: { newWorld: "Create world and dive", continueWorld: "Continue diving", overwrite: "Replace and create new world" },
  moduleFailed: "The conservation mode could not be loaded. Go back and try again.",
};

export const setupZh: SetupDict = {
  modeTitle: "模式",
  modes: { conserve: "深潜·守恒", free: "自由潜" },
  conserveHint: "被环形巨壁包住的 10 × 10 小海。每一粒粒子都被计数并存档：你带走、锁进基地的越多，海就越空，壁就越薄。采集节点、建立基地、存入仓储，再唤潮让世界重组——然后留意环壁、第一道裂缝，以及壁外等着的东西。",
  conserveControls: [
    "对准发光的资源节点（被瞄准时会变亮），按住 E / 鼠标左键 / 「吸取」把粒子吸进 200 容量的粒子罐",
    "按住 X 或 ⟲ 按钮 2 秒紧急召回——在基地外，罐中粒子留在原地成为遗失粒子包（罗盘上会标出）；在基地内则存入仓储",
    "G / 「建造」— 建造模式（T 切换建筑，E / 「放置」放置；先建基地核心）· Q / 「基地」按钮 — 基地面板：存入、取出、放流、灯塔开关、唤潮 · H — 关闭当前提示",
  ],
  slot: {
    loading: "正在读取世界存档…",
    failed: "守恒模式加载失败，请检查网络后重试。",
    empty: "还没有世界。选一个种子来创建。",
    ready: (seed, gen, dives) => `你的世界 · 种子 ${seed} · 第 ${gen} 代 · 已下潜 ${dives} 次`,
    ended: (seed) => `种子 ${seed} 的世界已经湮灭，只能新建世界。`,
    unreadable: "世界存档无法读取。新建世界会替换它。",
    newWorld: "新建世界…",
    overwriteWarning: "新建世界会替换当前的世界，无法撤销。",
    cancelNew: "保留我的世界",
  },
  start: { newWorld: "创建世界并下潜", continueWorld: "继续下潜", overwrite: "替换并创建新世界" },
  moduleFailed: "守恒模式加载失败，请返回后重试。",
};
