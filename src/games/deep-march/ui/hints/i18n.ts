/** New-player hint strings (conserve mode, plan M9): one per step, keyboard and touch variants, the card's buttons, the setup switch. */
import type { HintStep } from "./hintModel";

export type HintDict = {
  title: string;
  steps: Record<HintStep, { key: string; touch: string }>;
  gotIt: string;
  /** Keyboard shortcut shown on the 「知道了」 button (desktop). */
  gotItKey: string;
  hideAll: string;
  /** Setup screen switch (conserve mode). */
  setting: string;
  settingHint: string;
};

export const hintsEn: HintDict = {
  title: "Tip",
  steps: {
    absorb: {
      key: "Swim to a glowing node, aim at it and hold E (or the left mouse button) to draw its particles into your tank.",
      touch: "Swim to a glowing node, aim at it and hold ABSORB to draw its particles into your tank.",
    },
    core: {
      key: "Press G to build, aim at flat seabed and press E to place the base core — the lander cargo pays for exactly one.",
      touch: "Tap BUILD in the fan, aim at flat seabed and tap PLACE for the base core — the lander cargo pays for exactly one.",
    },
    deposit: {
      key: "Back inside the base, press Q for the base panel and “Deposit all” to empty the tank into storage.",
      touch: "Back inside the base, tap the Base button and “Deposit all” to empty the tank into storage.",
    },
    tide: {
      key: "With 150 energy and one dive this generation, press “Call the tide” in the base panel. 60 s later the tide remakes the world — stay inside the dome.",
      touch: "With 150 energy and one dive this generation, tap “Call the tide” in the base panel. 60 s later the tide remakes the world — stay inside the dome.",
    },
    rescan: {
      key: "The tide rebuilt the seabed, but your sonar record still shows the old one. Press N for the sonar view, then 3 to ping — each ping overwrites the stale record around you.",
      touch: "The tide rebuilt the seabed, but your sonar record still shows the old one. Hold PING for the sonar view, then tap PING — each ping overwrites the stale record around you.",
    },
    release: {
      key: "The more you take, the emptier the sea and the thinner the ring wall. “Release” in the base panel gives particles back — the next tide steadies the world and can heal cracks.",
      touch: "The more you take, the emptier the sea and the thinner the ring wall. “Release” in the base panel gives particles back — the next tide steadies the world and can heal cracks.",
    },
  },
  gotIt: "Got it",
  gotItKey: "H",
  hideAll: "No more tips",
  setting: "Beginner tips",
  settingHint: "A few short tips in the conservation mode; switching them back on starts them over.",
};

export const hintsZh: HintDict = {
  title: "提示",
  steps: {
    absorb: {
      key: "游向发光的资源节点，对准后按住 E（或鼠标左键），把粒子吸进粒子罐。",
      touch: "游向发光的资源节点，对准后按住「吸取」，把粒子吸进粒子罐。",
    },
    core: {
      key: "按 G 进入建造，对准平坦的海床，按 E 放置基地核心——着陆舱的货舱正好够造一座。",
      touch: "点扇形「建造」，对准平坦的海床，点「放置」建造基地核心——着陆舱的货舱正好够造一座。",
    },
    deposit: {
      key: "回到基地范围内，按 Q 打开基地面板，点「全部存入」把粒子罐存进仓储。",
      touch: "回到基地范围内，点「基地」按钮打开面板，点「全部存入」把粒子罐存进仓储。",
    },
    tide: {
      key: "能量达到 150、本代出航过一次后，在基地面板点「唤潮」。60 秒后潮汐会重塑世界——请留在穹顶内。",
      touch: "能量达到 150、本代出航过一次后，在基地面板点「唤潮」。60 秒后潮汐会重塑世界——请留在穹顶内。",
    },
    rescan: {
      key: "潮汐重塑了海床，但声呐记录还是旧地形。按 N 进入声呐观察模式，再按 3 发射脉冲——每次脉冲都会覆盖周围过时的记录。",
      touch: "潮汐重塑了海床，但声呐记录还是旧地形。长按「声呐」进入声呐观察模式，再点「声呐」发射脉冲——每次脉冲都会覆盖周围过时的记录。",
    },
    release: {
      key: "你带走的粒子越多，海越空、界壁越薄。在基地面板「放流」可以把粒子还给海，下次潮汐世界会回稳，裂缝也可能愈合。",
      touch: "你带走的粒子越多，海越空、界壁越薄。在基地面板「放流」可以把粒子还给海，下次潮汐世界会回稳，裂缝也可能愈合。",
    },
  },
  gotIt: "知道了",
  gotItKey: "H",
  hideAll: "不再提示",
  setting: "新手提示",
  settingHint: "守恒模式里的几条简短提示；关掉后重新打开会从头显示。",
};
