/** Why 唤潮 is not possible yet, and what to do (ui/base/tideAdvice.ts; M9, the volt reactor). */
export type AdviceDict = {
  cap: string;
  drain: string;
  /** No working reactor and the energy is not rising. */
  reactor: string;
  /** Reactors stand, but there is no voltite in storage. */
  fuel: string;
  charging: (minutes: number) => string;
  dive: string;
};

export const adviceEn: AdviceDict = {
  cap: "Energy capacity is below 150 — build an energy tower",
  drain: "Energy is falling — switch the lighthouses off to save up for the tide",
  reactor: "Energy isn't rising — build a volt reactor (ferro 100, voltite 30). Voltite glows amber on terrace ledges",
  fuel: "The reactor is out of voltite — deposit voltite into storage",
  charging: (min) => `Enough energy in about ${min} min`,
  dive: "Make one dive first: leave the base and come back",
};

export const adviceZh: AdviceDict = {
  cap: "能量上限不足 150 · 先建一座储能塔",
  drain: "能量在下降 · 关闭灯塔来为唤潮攒能量",
  reactor: "能量没有上涨 · 建一座伏晶反应堆（铁锰 100、伏晶 30）；伏晶在崖台边缘发出琥珀色的光",
  fuel: "反应堆没有伏晶了 · 把伏晶存入仓储",
  charging: (min) => `约 ${min} 分钟后能量足够`,
  dive: "先出航一次：离开基地再回来",
};
