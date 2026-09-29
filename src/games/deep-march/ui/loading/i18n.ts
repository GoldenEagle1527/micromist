/** Loading-screen strings (zh / en); plugged into the deep-march dictionary as `loading`. */
import type { StepStatus } from "./loadingModel";

/** Registered loading steps (steps/index.ts) that need a row name. */
export type StepId = "coords" | "regions" | "materials" | "terrain" | "system" | "audio";

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
  /** One-line shader failure for the focus card (the full log is in the diagnostics). */
  shaderErrorShort: string;
  gpuLost: string;
  /** Focus card heading when every step is settled. */
  allReady: string;
  /** Focus card: current step prefix. */
  now: string;
  diagnostics: string;
  /** Audio step. */
  audioCount: (done: number, total: number, kb: string, totalKb: string) => string;
  audioOff: string;
  audioSilent: string;
  audioPartial: (clips: string) => string;
  audioLate: string;
  audioConnecting: string;
  diag: {
    spawn: string;
    texPath: string;
    texError: string;
    gpu: string;
    limits: string;
    limitsValue: (units: number, vectors: number, highp: boolean) => string;
    shaderLog: string;
    audioFormat: string;
    audioMissing: string;
  };
  diveAnyway: string;
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
    audio: "Tuning audio systems",
  },
  status: { pending: "WAIT", active: "RUN", done: "OK", warn: "WARN", error: "ERR" },
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
  shaderErrorShort: "Shader error — see Diagnostics",
  gpuLost: "Graphics context lost (GPU reset) — reload the page",
  allReady: "All systems ready",
  now: "Now",
  diagnostics: "Diagnostics",
  audioCount: (d, t, kb, tkb) => `${d}/${t} sounds · ${kb} / ${tkb} KB`,
  audioOff: "Sound off",
  audioSilent: "Sound files not found — diving silent",
  audioPartial: (clips) => `Some sounds missing (${clips})`,
  audioLate: "Still loading in the background",
  audioConnecting: "Connecting to the sound store…",
  diag: {
    spawn: "Entry point (x, y, z)",
    texPath: "Texture format",
    texError: "Texture error",
    gpu: "GPU",
    limits: "Limits",
    limitsValue: (u, v, h) => `texture units ${u} · fragment uniforms ${v} · highp ${h ? "yes" : "no"}`,
    shaderLog: "Shader log",
    audioFormat: "Sound format",
    audioMissing: "Missing sounds",
  },
  diveAnyway: "Dive anyway",
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
    audio: "调校声学系统",
  },
  status: { pending: "等待", active: "进行", done: "完成", warn: "注意", error: "错误" },
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
  shaderErrorShort: "着色器错误（详见诊断详情）",
  gpuLost: "图形上下文丢失（GPU 重置）— 请刷新页面",
  allReady: "全部系统就绪",
  now: "当前",
  diagnostics: "诊断详情",
  audioCount: (d, t, kb, tkb) => `${d}/${t} 段音效 · ${kb} / ${tkb} KB`,
  audioOff: "声音已关闭",
  audioSilent: "未找到音效文件，静音下潜",
  audioPartial: (clips) => `部分音效缺失（${clips}）`,
  audioLate: "仍在后台加载",
  audioConnecting: "正在连接音效库…",
  diag: {
    spawn: "入水点 (x, y, z)",
    texPath: "纹理格式",
    texError: "纹理错误",
    gpu: "GPU",
    limits: "限制",
    limitsValue: (u, v, h) => `纹理单元 ${u} · 片元 uniform ${v} · highp ${h ? "支持" : "不支持"}`,
    shaderLog: "着色器日志",
    audioFormat: "音效格式",
    audioMissing: "缺失音效",
  },
  diveAnyway: "仍然下潜",
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
