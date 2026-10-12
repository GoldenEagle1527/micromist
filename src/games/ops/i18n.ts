import type { CropId, CronTaskId, OpsPageId, PlotStatus } from "./types";

export type OpsDict = {
  setupTitle: string;
  setupHint: string;
  setupStart: string;
  setupResume: string;
  setupReset: string;
  brand: string;
  brandSub: string;
  exitPanel: string;
  collapseSidebar: string;
  expandSidebar: string;
  menu: Record<OpsPageId, string>;
  menuHint: Record<OpsPageId, string>;
  statusOnline: string;
  statusUptime: (day: number) => string;
  coins: (n: number) => string;
  dashboardTitle: string;
  cardGrowing: string;
  cardReady: string;
  cardEmpty: string;
  cardWilted: string;
  cardMoisture: string;
  cardSeeds: string;
  cardCoins: string;
  cardDay: string;
  recentLogs: string;
  plotsTitle: string;
  plotsColHost: string;
  plotsColStatus: string;
  plotsColCrop: string;
  plotsColGrowth: string;
  plotsColMoisture: string;
  plotsColAction: string;
  plant: string;
  plantPick: string;
  noSeeds: string;
  shopTitle: string;
  shopBuy: string;
  shopOwned: (n: number) => string;
  shopPrice: (n: number) => string;
  warehouseTitle: string;
  warehouseEmpty: string;
  warehouseColItem: string;
  warehouseColQty: string;
  cronTitle: string;
  cronColName: string;
  cronColEnabled: string;
  cronColLast: string;
  cronColAction: string;
  cronRun: string;
  cronNever: string;
  cronEnabled: string;
  cronDisabled: string;
  terminalTitle: string;
  terminalHint: string;
  terminalClear: string;
  crop: Record<CropId, string>;
  cropBlurb: Record<CropId, string>;
  status: Record<PlotStatus, string>;
  cronName: Record<CronTaskId, string>;
  cronBlurb: Record<CronTaskId, string>;
  toastNeedCoins: string;
};

export const opsZh: OpsDict = {
  setupTitle: "运维",
  setupHint:
    "看起来像服务器面板，其实是种地。侧栏里的「网站」是地块，「应用商店」是种子，「计划任务」负责浇水和收获。摸鱼友好，细看也像在干活。",
  setupStart: "进入面板",
  setupResume: "继续上次",
  setupReset: "新开一局",
  brand: "运维",
  brandSub: "Farm Node",
  exitPanel: "退出",
  collapseSidebar: "收起侧栏",
  expandSidebar: "展开侧栏",
  menu: {
    dashboard: "仪表盘",
    plots: "网站",
    shop: "应用商店",
    warehouse: "文件",
    cron: "计划任务",
    terminal: "终端",
  },
  menuHint: {
    dashboard: "农场概况",
    plots: "地块列表",
    shop: "种子商店",
    warehouse: "仓库",
    cron: "浇水 / 收获",
    terminal: "运行日志",
  },
  statusOnline: "节点在线",
  statusUptime: (day) => `运行第 ${day} 天`,
  coins: (n) => `${n} 币`,
  dashboardTitle: "概览",
  cardGrowing: "生长中",
  cardReady: "可收获",
  cardEmpty: "空闲地块",
  cardWilted: "异常 / 萎蔫",
  cardMoisture: "平均湿度",
  cardSeeds: "种子库存",
  cardCoins: "余额",
  cardDay: "天数",
  recentLogs: "最近事件",
  plotsTitle: "网站 / 地块",
  plotsColHost: "主机名",
  plotsColStatus: "状态",
  plotsColCrop: "作物",
  plotsColGrowth: "进度",
  plotsColMoisture: "湿度",
  plotsColAction: "操作",
  plant: "部署",
  plantPick: "选择种子",
  noSeeds: "没有可用种子，去应用商店安装",
  shopTitle: "应用商店 · 种子",
  shopBuy: "安装",
  shopOwned: (n) => `已拥有 ${n}`,
  shopPrice: (n) => `${n} 币`,
  warehouseTitle: "文件 · 仓库",
  warehouseEmpty: "仓库是空的。收获后作物会出现在这里。",
  warehouseColItem: "物品",
  warehouseColQty: "数量",
  cronTitle: "计划任务",
  cronColName: "任务",
  cronColEnabled: "状态",
  cronColLast: "上次执行",
  cronColAction: "操作",
  cronRun: "立即执行",
  cronNever: "从未",
  cronEnabled: "启用",
  cronDisabled: "停用",
  terminalTitle: "终端",
  terminalHint: "只读日志流 · 假装在 tail -f",
  terminalClear: "清屏（仅显示）",
  crop: {
    lettuce: "生菜",
    tomato: "番茄",
    potato: "土豆",
    chili: "辣椒",
  },
  cropBlurb: {
    lettuce: "轻量包 · 生长快 · 收益稳",
    tomato: "中型服务 · 吃水多 · 收益高",
    potato: "存储型 · 耐旱一点",
    chili: "高负载 · 贵但爆利",
  },
  status: {
    empty: "空闲",
    growing: "运行中",
    ready: "待发布",
    wilted: "告警",
  },
  cronName: {
    "water-all": "全量浇水",
    "harvest-ready": "收获待发布",
    "scan-pests": "病虫害扫描",
  },
  cronBlurb: {
    "water-all": "给所有地块补水并推进生长",
    "harvest-ready": "收割状态为「待发布」的地块",
    "scan-pests": "扫描异常；过干的地块可能萎蔫",
  },
  toastNeedCoins: "余额不足",
};

export const opsEn: OpsDict = {
  setupTitle: "Ops",
  setupHint:
    "Looks like a server panel; it's a farm. Sidebar “Websites” are plots, “App Store” is seeds, “Cron” waters and harvests. Slack-friendly, still looks like work.",
  setupStart: "Open panel",
  setupResume: "Resume",
  setupReset: "New farm",
  brand: "Ops",
  brandSub: "Farm Node",
  exitPanel: "Exit",
  collapseSidebar: "Collapse sidebar",
  expandSidebar: "Expand sidebar",
  menu: {
    dashboard: "Home",
    plots: "Websites",
    shop: "App Store",
    warehouse: "Files",
    cron: "Cron",
    terminal: "Terminal",
  },
  menuHint: {
    dashboard: "Farm overview",
    plots: "Plot list",
    shop: "Seed shop",
    warehouse: "Warehouse",
    cron: "Water / harvest",
    terminal: "Runtime logs",
  },
  statusOnline: "Node online",
  statusUptime: (day) => `Day ${day}`,
  coins: (n) => `${n} coins`,
  dashboardTitle: "Overview",
  cardGrowing: "Growing",
  cardReady: "Ready",
  cardEmpty: "Idle plots",
  cardWilted: "Alerts / wilted",
  cardMoisture: "Avg moisture",
  cardSeeds: "Seed stock",
  cardCoins: "Balance",
  cardDay: "Day",
  recentLogs: "Recent events",
  plotsTitle: "Websites / plots",
  plotsColHost: "Hostname",
  plotsColStatus: "Status",
  plotsColCrop: "Crop",
  plotsColGrowth: "Progress",
  plotsColMoisture: "Moisture",
  plotsColAction: "Actions",
  plant: "Deploy",
  plantPick: "Pick a seed",
  noSeeds: "No seeds — install some in App Store",
  shopTitle: "App Store · seeds",
  shopBuy: "Install",
  shopOwned: (n) => `Owned ${n}`,
  shopPrice: (n) => `${n} coins`,
  warehouseTitle: "Files · warehouse",
  warehouseEmpty: "Warehouse is empty. Harvests land here.",
  warehouseColItem: "Item",
  warehouseColQty: "Qty",
  cronTitle: "Cron jobs",
  cronColName: "Job",
  cronColEnabled: "State",
  cronColLast: "Last run",
  cronColAction: "Actions",
  cronRun: "Run now",
  cronNever: "Never",
  cronEnabled: "On",
  cronDisabled: "Off",
  terminalTitle: "Terminal",
  terminalHint: "Read-only log stream · pretend you're tail -f",
  terminalClear: "Clear view",
  crop: {
    lettuce: "Lettuce",
    tomato: "Tomato",
    potato: "Potato",
    chili: "Chili",
  },
  cropBlurb: {
    lettuce: "Lightweight · fast grow · steady yield",
    tomato: "Mid service · thirsty · high yield",
    potato: "Storage-ish · a bit drought-tolerant",
    chili: "High load · pricey, spicy profit",
  },
  status: {
    empty: "Idle",
    growing: "Running",
    ready: "Ready to ship",
    wilted: "Alert",
  },
  cronName: {
    "water-all": "Water all",
    "harvest-ready": "Harvest ready",
    "scan-pests": "Pest scan",
  },
  cronBlurb: {
    "water-all": "Irrigate every plot and push growth",
    "harvest-ready": "Ship plots marked ready",
    "scan-pests": "Scan anomalies; dry plots may wilt",
  },
  toastNeedCoins: "Not enough coins",
};
