/** Loading-screen strings (zh / en); plugged into the deep-march dictionary as `loading`. */
import type { StepId, StepStatus } from "./loadingModel";

export type LoadingDict = {
  title: string;
  subtitle: string;
  steps: Record<StepId, string>;
  status: Record<StepStatus, string>;
  seed: (text: string, hash: string) => string;
  locating: string;
  spawnFix: (x: number, z: number, depth: number) => string;
  mapProgress: (pct: number, km: string) => string;
  legend: string;
  spawn: string;
  connecting: string;
  laying: (name: string) => string;
  materialCount: (done: number, total: number, mb: string, totalMb: string) => string;
  uploading: string;
  fallback: string;
  retrying: (files: number) => string;
  failed: (msg: string) => string;
  retry: string;
  terrainPlanning: string;
  terrain: (pct: number) => string;
  battery: (pct: number) => string;
  lamps: (modes: string) => string;
  sonar: string;
  shaders: string;
  overall: string;
  begin: string;
  materialNames: Record<string, string>;
};

export const loadingEn: LoadingDict = {
  title: "PRE-DIVE SEQUENCE",
  subtitle: "Diver systems initializing",
  steps: {
    coords: "Reading sea coordinates",
    regions: "Charting regions",
    materials: "Laying seabed materials",
    terrain: "Surveying terrain around spawn",
    system: "System check",
  },
  status: { pending: "WAIT", active: "RUN", done: "OK", error: "ERR" },
  seed: (text, hash) => `Seed ${text} · #${hash}`,
  locating: "Locating the entry point…",
  spawnFix: (x, z, depth) => `Entry fix X ${x} · Z ${z} · depth ${depth} m`,
  mapProgress: (pct, km) => `${pct}% · ${km} km × ${km} km`,
  legend: "Landforms",
  spawn: "Entry point",
  connecting: "Connecting to the texture store…",
  laying: (name) => `Laying: ${name}`,
  materialCount: (done, total, mb, totalMb) => `${done}/${total} · ${mb} / ${totalMb} MB`,
  uploading: "Uploading to the GPU…",
  fallback: "Compressed textures unavailable — switched to WebP",
  retrying: (n) => `Connection unstable — retrying ${n} file${n === 1 ? "" : "s"}…`,
  failed: (msg) => `Texture download failed (${msg})`,
  retry: "Retry",
  terrainPlanning: "Planning survey grid…",
  terrain: (pct) => `Coverage ${pct}%`,
  battery: (pct) => `Battery ${pct}%`,
  lamps: (modes) => `Lamps: ${modes}`,
  sonar: "Sonar ready",
  shaders: "Seabed shaders compiled",
  overall: "Overall",
  begin: "Begin dive",
  materialNames: {
    sand: "Fine sand",
    gravel: "Gravel",
    rock: "Rock face",
    moss: "Mossy rock",
    basalt: "Basalt",
    darkrock: "Dark rock",
    strata: "Stratified rock",
    seaside: "Sea-worn rock",
    eroded: "Eroded rock",
    porous: "Porous limestone",
    coralcrust: "Coral crust",
    coralrubble: "Coral rubble",
    coralmud: "Coral mud",
    shellsand: "Shell sand",
    ripplesand: "Sand ripples",
    coarsesand: "Coarse sand",
    ooze: "Deep-sea ooze",
    mud: "Silt",
    nodules: "Manganese nodules",
    scree: "Scree",
    algae: "Algae-covered rock",
    lichen: "Encrusted rock",
  },
};

export const loadingZh: LoadingDict = {
  title: "下潜准备程序",
  subtitle: "潜水员系统初始化",
  steps: {
    coords: "读取海域坐标",
    regions: "绘制海域大区图",
    materials: "铺设海床材质",
    terrain: "测绘出生点周边地形",
    system: "系统自检",
  },
  status: { pending: "等待", active: "进行", done: "完成", error: "错误" },
  seed: (text, hash) => `种子 ${text} · #${hash}`,
  locating: "正在定位入水点…",
  spawnFix: (x, z, depth) => `入水点 X ${x} · Z ${z} · 深度 ${depth} 米`,
  mapProgress: (pct, km) => `${pct}% · ${km} 公里 × ${km} 公里`,
  legend: "地貌",
  spawn: "入水点",
  connecting: "正在连接材质库…",
  laying: (name) => `正在铺设：${name}`,
  materialCount: (done, total, mb, totalMb) => `${done}/${total} · ${mb} / ${totalMb} MB`,
  uploading: "正在上传至显卡…",
  fallback: "压缩纹理不可用，已改用 WebP",
  retrying: (n) => `连接不稳定，正在重试 ${n} 个文件…`,
  failed: (msg) => `材质下载失败（${msg}）`,
  retry: "重试",
  terrainPlanning: "正在规划测绘网格…",
  terrain: (pct) => `覆盖 ${pct}%`,
  battery: (pct) => `电池 ${pct}%`,
  lamps: (modes) => `灯光：${modes}`,
  sonar: "声呐就绪",
  shaders: "海床着色器已编译",
  overall: "总进度",
  begin: "开始下潜",
  materialNames: {
    sand: "细沙",
    gravel: "砾石",
    rock: "岩面",
    moss: "苔藓岩",
    basalt: "玄武岩",
    darkrock: "暗色岩",
    strata: "层状岩",
    seaside: "海蚀岩",
    eroded: "侵蚀岩",
    porous: "多孔石灰岩",
    coralcrust: "珊瑚结壳",
    coralrubble: "珊瑚碎砾",
    coralmud: "珊瑚泥",
    shellsand: "贝壳砂",
    ripplesand: "沙纹",
    coarsesand: "粗砂",
    ooze: "深海软泥",
    mud: "淤泥",
    nodules: "锰结核",
    scree: "碎石坡",
    algae: "藻覆岩",
    lichen: "结壳岩",
  },
};
