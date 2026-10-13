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
  settingsTitle: string;
  settingsNote: string;
  settingsColOps: string;
  settingsColFarm: string;
  settingsColHint: string;
  /** Farm↔ops mapping rows — only shown on Settings. */
  mapRows: { ops: string; farm: string; hint: string }[];
};

export const opsZh: OpsDict = {
  setupTitle: "运维",
  setupHint:
    "本机运维面板。侧栏可管理仪表盘、网站、应用商店、文件、计划任务、终端与设置。进度仅保存在本机，不上传账号。",
  setupStart: "进入面板",
  setupResume: "恢复会话",
  setupReset: "重置面板",
  brand: "运维",
  brandSub: "Control Panel",
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
    settings: "设置",
  },
  menuHint: {
    dashboard: "总览与监控",
    plots: "站点列表",
    shop: "安装应用",
    warehouse: "文件管理",
    cron: "定时任务",
    terminal: "运行日志",
    settings: "映射与偏好",
  },
  statusOnline: "节点在线",
  statusUptime: (day) => `运行第 ${day} 天`,
  coins: (n) => `余额 ${n}`,
  dashboardTitle: "概览",
  cardGrowing: "运行中",
  cardReady: "待发布",
  cardEmpty: "空闲站点",
  cardWilted: "异常告警",
  cardMoisture: "平均负载",
  cardSeeds: "待装应用",
  cardCoins: "余额",
  cardDay: "运行天数",
  recentLogs: "最近事件",
  plotsTitle: "网站",
  plotsColHost: "域名 / 主机",
  plotsColStatus: "状态",
  plotsColCrop: "应用",
  plotsColGrowth: "构建进度",
  plotsColMoisture: "负载",
  plotsColAction: "操作",
  plant: "部署",
  plantPick: "选择应用",
  noSeeds: "没有可部署的应用包，请先到应用商店安装",
  shopTitle: "应用商店",
  shopBuy: "安装",
  shopOwned: (n) => `已安装 ${n}`,
  shopPrice: (n) => `${n} 额度`,
  warehouseTitle: "文件",
  warehouseEmpty: "目录为空。备份与导出文件会出现在这里。",
  warehouseColItem: "名称",
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
  terminalHint: "只读日志流 · tail -f",
  terminalClear: "清屏",
  crop: {
    lettuce: "Nginx",
    tomato: "MySQL",
    potato: "Redis",
    chili: "PostgreSQL",
  },
  cropBlurb: {
    lettuce: "高性能反向代理 · 轻量 · 稳定",
    tomato: "关系型数据库 · 常用业务底座",
    potato: "适合缓存与会话",
    chili: "企业级数据库 · 高负载场景",
  },
  status: {
    empty: "空闲",
    growing: "运行中",
    ready: "待发布",
    wilted: "告警",
  },
  cronName: {
    "water-all": "批量健康检查",
    "harvest-ready": "备份并发布",
    "scan-pests": "安全扫描",
  },
  cronBlurb: {
    "water-all": "巡检全部站点并刷新资源指标",
    "harvest-ready": "对「待发布」站点执行备份与发布",
    "scan-pests": "扫描异常；高负载站点可能进入告警",
  },
    toastNeedCoins: "余额不足",
  settingsTitle: "设置",
  settingsNote: "本面板的底层玩法映射（仅设置页可见）。其它页面一律使用运维用语。",
  settingsColOps: "运维术语",
  settingsColFarm: "种地含义",
  settingsColHint: "说明",
  mapRows: [
    { ops: "仪表盘", farm: "农场总览", hint: "地块与资源一览" },
    { ops: "网站", farm: "地块", hint: "每一行主机对应一块田" },
    { ops: "应用商店 / 安装", farm: "种子商店 / 买种子", hint: "用余额兑换可部署的应用包" },
    { ops: "文件", farm: "仓库", hint: "收获后的产物存放处" },
    { ops: "计划任务", farm: "定时农活", hint: "浇水、收获、查虫等自动化" },
    { ops: "终端", farm: "农场日志", hint: "只读事件流" },
    { ops: "部署", farm: "播种", hint: "空闲站点种下应用" },
    { ops: "余额 / 额度", farm: "金币", hint: "买种子与收获结算" },
    { ops: "运行中", farm: "生长中", hint: "作物尚未成熟" },
    { ops: "待发布", farm: "可收获", hint: "构建完成，可备份发布" },
    { ops: "空闲站点", farm: "空地", hint: "尚无作物" },
    { ops: "异常告警", farm: "枯萎", hint: "负载过低等异常" },
    { ops: "负载", farm: "水分", hint: "站点资源指标" },
    { ops: "构建进度", farm: "生长进度", hint: "0–100%" },
    { ops: "应用 / 应用包", farm: "作物 / 种子", hint: "部署到地块上的种类" },
    { ops: "Nginx", farm: "生菜", hint: "轻量作物" },
    { ops: "MySQL", farm: "番茄", hint: "常用作物" },
    { ops: "Redis", farm: "土豆", hint: "缓存向作物" },
    { ops: "PostgreSQL", farm: "辣椒", hint: "高负载作物" },
    { ops: "批量健康检查", farm: "浇水", hint: "提升负载并推进生长" },
    { ops: "备份并发布", farm: "收获", hint: "清空待发布站点并入库/入账" },
    { ops: "安全扫描", farm: "查害虫", hint: "高负载风险可能告警" },
    { ops: "待装应用", farm: "种子库存", hint: "已安装尚未部署的数量" },
    { ops: "运行天数", farm: "天数", hint: "面板开局以来的日计数" },
  ],
};

export const opsEn: OpsDict = {
  setupTitle: "Ops",
  setupHint:
    "Local ops panel. Manage Home, Websites, App Store, Files, Cron, Terminal, and Settings. Progress stays on this device — no account upload.",
  setupStart: "Open panel",
  setupResume: "Resume session",
  setupReset: "Reset panel",
  brand: "Ops",
  brandSub: "Control Panel",
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
    settings: "Settings",
  },
  menuHint: {
    dashboard: "Overview & monitors",
    plots: "Site list",
    shop: "Install apps",
    warehouse: "File manager",
    cron: "Scheduled jobs",
    terminal: "Runtime logs",
    settings: "Mapping & prefs",
  },
  statusOnline: "Node online",
  statusUptime: (day) => `Uptime day ${day}`,
  coins: (n) => `Balance ${n}`,
  dashboardTitle: "Overview",
  cardGrowing: "Running",
  cardReady: "Pending release",
  cardEmpty: "Idle sites",
  cardWilted: "Alerts",
  cardMoisture: "Avg load",
  cardSeeds: "Apps ready",
  cardCoins: "Balance",
  cardDay: "Uptime days",
  recentLogs: "Recent events",
  plotsTitle: "Websites",
  plotsColHost: "Domain / host",
  plotsColStatus: "Status",
  plotsColCrop: "App",
  plotsColGrowth: "Build",
  plotsColMoisture: "Load",
  plotsColAction: "Actions",
  plant: "Deploy",
  plantPick: "Select app",
  noSeeds: "No app packages available — install from App Store first",
  shopTitle: "App Store",
  shopBuy: "Install",
  shopOwned: (n) => `Installed ${n}`,
  shopPrice: (n) => `${n} credits`,
  warehouseTitle: "Files",
  warehouseEmpty: "Directory is empty. Backups and exports appear here.",
  warehouseColItem: "Name",
  warehouseColQty: "Qty",
  cronTitle: "Cron jobs",
  cronColName: "Job",
  cronColEnabled: "State",
  cronColLast: "Last run",
  cronColAction: "Actions",
  cronRun: "Run now",
  cronNever: "Never",
  cronEnabled: "Enabled",
  cronDisabled: "Disabled",
  terminalTitle: "Terminal",
  terminalHint: "Read-only log stream · tail -f",
  terminalClear: "Clear",
  crop: {
    lettuce: "Nginx",
    tomato: "MySQL",
    potato: "Redis",
    chili: "PostgreSQL",
  },
  cropBlurb: {
    lettuce: "High-performance reverse proxy · light · stable",
    tomato: "Relational database · common app backbone",
    potato: "Good for cache and sessions",
    chili: "Enterprise database · high-load workloads",
  },
  status: {
    empty: "Idle",
    growing: "Running",
    ready: "Pending release",
    wilted: "Alert",
  },
  cronName: {
    "water-all": "Batch health check",
    "harvest-ready": "Backup & release",
    "scan-pests": "Security scan",
  },
  cronBlurb: {
    "water-all": "Inspect all sites and refresh resource metrics",
    "harvest-ready": "Backup and release sites marked pending",
    "scan-pests": "Scan anomalies; high-load sites may alert",
  },
    toastNeedCoins: "Insufficient balance",
  settingsTitle: "Settings",
  settingsNote:
    "Underlying farm↔ops mapping (visible on this Settings page only). All other pages stay in ops language.",
  settingsColOps: "Ops term",
  settingsColFarm: "Farm meaning",
  settingsColHint: "Notes",
  mapRows: [
    { ops: "Home", farm: "Farm overview", hint: "Plots and resources at a glance" },
    { ops: "Websites", farm: "Plots", hint: "Each host row is a field plot" },
    { ops: "App Store / Install", farm: "Seed shop / buy seeds", hint: "Spend balance for deployable packages" },
    { ops: "Files", farm: "Warehouse", hint: "Harvested goods land here" },
    { ops: "Cron", farm: "Scheduled farm jobs", hint: "Water, harvest, pest scan, etc." },
    { ops: "Terminal", farm: "Farm log", hint: "Read-only event stream" },
    { ops: "Deploy", farm: "Plant", hint: "Sow an app on an idle site" },
    { ops: "Balance / credits", farm: "Coins", hint: "Buy seeds and settle harvests" },
    { ops: "Running", farm: "Growing", hint: "Crop not ready yet" },
    { ops: "Pending release", farm: "Ready to harvest", hint: "Build finished; can backup & release" },
    { ops: "Idle sites", farm: "Empty plot", hint: "No crop planted" },
    { ops: "Alerts", farm: "Wilted", hint: "Low load / anomaly" },
    { ops: "Load", farm: "Moisture", hint: "Site resource metric" },
    { ops: "Build", farm: "Growth progress", hint: "0–100%" },
    { ops: "App / package", farm: "Crop / seed", hint: "What you deploy onto a plot" },
    { ops: "Nginx", farm: "Lettuce", hint: "Light crop" },
    { ops: "MySQL", farm: "Tomato", hint: "Common crop" },
    { ops: "Redis", farm: "Potato", hint: "Cache-oriented crop" },
    { ops: "PostgreSQL", farm: "Chili", hint: "High-load crop" },
    { ops: "Batch health check", farm: "Water all", hint: "Raise load and push growth" },
    { ops: "Backup & release", farm: "Harvest", hint: "Clear pending sites; inventory + balance" },
    { ops: "Security scan", farm: "Pest scan", hint: "High-load sites may alert" },
    { ops: "Apps ready", farm: "Seed stock", hint: "Installed but not yet deployed" },
    { ops: "Uptime days", farm: "Day count", hint: "Days since panel start" },
  ],
};
