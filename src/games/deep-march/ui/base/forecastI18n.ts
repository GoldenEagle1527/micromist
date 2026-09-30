/** Tide forecast card strings (conserve mode, plan M6): 「若现在唤潮」 in the base panel. */

export type CrackForecast = { opening: number; healing: number; open: number; through: number };

export type ForecastDict = {
  title: string;
  /** Column heads: after the tide / this generation. */
  next: string;
  now: string;
  m: string;
  wall: string;
  stage: string;
  /** Chaos stages 0 … 5. */
  stages: readonly string[];
  cracks: string;
  metres: (t: number) => string;
  crackLine: (c: CrackForecast) => string;
  note: string;
};

const crackEn = ({ opening, healing, open, through }: CrackForecast): string => {
  if (opening === 0 && healing === 0) return open === 0 ? "none" : `${open} open, unchanged`;
  const parts = [opening ? `${opening} would open` : "", healing ? `${healing} would heal` : "", `${open} open after`].filter(Boolean);
  return parts.join(" · ") + (through ? ` (${through} passable)` : "");
};

const crackZh = ({ opening, healing, open, through }: CrackForecast): string => {
  if (opening === 0 && healing === 0) return open === 0 ? "无" : `${open} 道张开，不变`;
  const parts = [opening ? `将新开 ${opening} 道` : "", healing ? `将愈合 ${healing} 道` : "", `潮后张开 ${open} 道`].filter(Boolean);
  return parts.join(" · ") + (through ? `（可穿过 ${through} 道）` : "");
};

export const forecastEn: ForecastDict = {
  title: "Tide forecast (if called now)",
  next: "after the tide",
  now: "now",
  m: "External share m",
  wall: "Ring wall",
  stage: "Chaos",
  stages: ["0 Calm sea", "1 Echoes", "2 First cracks", "3 Seepage", "4 Erosion", "5 The gaze"],
  cracks: "Cracks",
  metres: (t) => `${Math.round(t)} m`,
  crackLine: crackEn,
  note: "Particles locked in the base or carried thin the wall at the tide; released ones and burnt fuel come back.",
};

export const forecastZh: ForecastDict = {
  title: "潮汐预报（若现在唤潮）",
  next: "潮后",
  now: "本代",
  m: "外部可变比例 m",
  wall: "环壁厚度",
  stage: "混沌阶段",
  stages: ["0 静海", "1 回响", "2 初裂", "3 渗入", "4 侵蚀", "5 直视"],
  cracks: "裂缝",
  metres: (t) => `${Math.round(t)} 米`,
  crackLine: crackZh,
  note: "锁进基地和随身携带的粒子会在潮汐时让环壁变薄；放流的粒子和烧掉的燃料会回到海里。",
};
