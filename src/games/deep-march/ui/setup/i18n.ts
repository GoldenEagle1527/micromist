/** Setup-screen strings for the mode choice and the conserve save slot (plugged into the deep-march dictionary as `setup`). */
import type { GameMode } from "../../modes/gameMode";

export type SetupDict = {
  modeTitle: string;
  modes: Record<GameMode, string>;
  /** Conserve-mode description (the free dive keeps the game's setupHint). */
  conserveHint: string;
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
    "A bounded world whose particles are counted and saved. Early build (milestone 1): the world save and particle ledger exist; the sea is still the free-dive terrain — harvesting, the base and the tides come in later milestones.",
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
  conserveHint: "有边界的世界，粒子总量固定并会存档。当前是早期版本（里程碑 1）：已有世界存档与粒子账本，海域仍是自由潜的地形；采集、基地和潮汐会在后续里程碑加入。",
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
