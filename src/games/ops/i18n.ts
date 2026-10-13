import type { CropId, CronTaskId, OpsPageId, PlotStatus, SiteTier } from "./types";

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
  alertsTitle: string;
  alertsEmpty: string;
  alertsHandle: string;
  alertsHost: (host: string) => string;
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
  app: Record<CropId, string>;
  appBlurb: Record<CropId, string>;
  status: Record<PlotStatus, string>;
  cronName: Record<CronTaskId, string>;
  cronBlurb: Record<CronTaskId, string>;
  toastNeedCoins: string;
  healthCheck: string;
  releaseSite: string;
  warehouseColAction: string;
  warehouseExport: string;
  warehouseExportValue: (n: number) => string;
  provisionSite: string;
  provisionCost: (n: number) => string;
  provisionFull: string;
  dashQuickTitle: string;
  dashQuickHealth: string;
  dashQuickRelease: string;
  dashQuickScan: string;
  terminalPrompt: string;
  terminalRun: string;
  terminalPlaceholder: string;
  settingsTitle: string;
  settingsSaveTitle: string;
  settingsSaveHint: string;
  settingsExport: string;
  settingsImport: string;
  settingsReset: string;
  settingsResetConfirm: string;
  settingsPrefsTitle: string;
  settingsCompact: string;
  settingsCompactHint: string;
  settingsDebug: string;
  settingsDebugHint: string;
  settingsAboutTitle: string;
  settingsAboutBody: (version: string) => string;
  settingsImportOk: string;
  settingsImportFail: string;
  settingsExportOk: string;
  plotsColTier: string;
  tier: Record<SiteTier, string>;
  upgradeTier: string;
  upgradeTierCost: (n: number) => string;
  upgradeTierMax: string;
  cardPremium: string;
  tickHint: (secs: number) => string;
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
    settings: "存档与偏好",
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
  alertsTitle: "告警",
  alertsEmpty: "暂无未处理告警。",
  alertsHandle: "处理",
  alertsHost: (host) => `${host} · 健康度异常，建议巡检`,
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
  terminalHint: "可交互终端 · 输入 help 查看命令",
  terminalClear: "清屏",
  app: {
    lettuce: "Nginx",
    tomato: "MySQL",
    potato: "Redis",
    chili: "PostgreSQL",
  },
  appBlurb: {
    lettuce: "高性能反向代理 · 轻量 · 稳定",
    tomato: "关系型数据库 · 常用业务底座",
    potato: "内存缓存 · 会话与热点加速",
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
    "water-all": "巡检全部站点并刷新资源指标；启用后随墙钟跨日自动跑",
    "harvest-ready": "对「待发布」站点执行备份与发布；启用后随墙钟跨日自动跑",
    "scan-pests": "扫描异常；超规格软上限的站点可能进入告警；启用后随墙钟跨日自动跑",
  },
  toastNeedCoins: "余额不足",
  healthCheck: "巡检",
  releaseSite: "发布",
  warehouseColAction: "操作",
  warehouseExport: "导出",
  warehouseExportValue: (n) => `+${n} 额度`,
  provisionSite: "开通站点",
  provisionCost: (n) => `${n} 额度`,
  provisionFull: "站点配额已满",
  dashQuickTitle: "快捷操作",
  dashQuickHealth: "批量健康检查",
  dashQuickRelease: "备份并发布",
  dashQuickScan: "安全扫描",
  terminalPrompt: "root@ops",
  terminalRun: "执行",
  terminalPlaceholder: "输入命令，help 查看",
  settingsTitle: "设置",
  settingsSaveTitle: "存档",
  settingsSaveHint: "进度保存在本机 IndexedDB。可导出备份、导入或重置。",
  settingsExport: "导出存档",
  settingsImport: "导入存档",
  settingsReset: "重置面板",
  settingsResetConfirm: "确定清空本机运维进度并重新开局？",
  settingsPrefsTitle: "偏好",
  settingsCompact: "紧凑布局",
  settingsCompactHint: "缩小内边距，一屏多看几行",
  settingsDebug: "显示调试信息",
  settingsDebugHint: "在网站表额外显示站点 id",
  settingsAboutTitle: "关于",
  settingsAboutBody: (version) =>
    `运维面板 ${version} · micromist 单机玩法。装应用、部署、巡检、发布、升配——养成你的微型机房。墙钟会推进天数与计划任务。数据只存本机。`,
  settingsImportOk: "存档已导入",
  settingsImportFail: "导入失败：文件无效",
  settingsExportOk: "存档已下载",
  plotsColTier: "规格",
  tier: {
    basic: "基础",
    standard: "标准",
    premium: "高配",
  },
  upgradeTier: "升配",
  upgradeTierCost: (n) => `${n} 额度`,
  upgradeTierMax: "已是高配",
  cardPremium: "高配站点",
  tickHint: (secs) => `约 ${secs}s 后跨日`,
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
    settings: "Save & preferences",
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
  alertsTitle: "Alerts",
  alertsEmpty: "No open alerts.",
  alertsHandle: "Resolve",
  alertsHost: (host) => `${host} · health anomaly — run a health check`,
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
  terminalHint: "Interactive shell · type help for commands",
  terminalClear: "Clear",
  app: {
    lettuce: "Nginx",
    tomato: "MySQL",
    potato: "Redis",
    chili: "PostgreSQL",
  },
  appBlurb: {
    lettuce: "High-performance reverse proxy · light · stable",
    tomato: "Relational database · common app backbone",
    potato: "In-memory cache · sessions and hot keys",
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
    "water-all": "Inspect all sites and refresh metrics; runs on wall-clock day ticks when enabled",
    "harvest-ready": "Backup and release pending sites; runs on wall-clock day ticks when enabled",
    "scan-pests": "Scan anomalies; sites over plan soft-cap may alert; runs on wall-clock day ticks when enabled",
  },
  toastNeedCoins: "Insufficient balance",
  healthCheck: "Health check",
  releaseSite: "Release",
  warehouseColAction: "Actions",
  warehouseExport: "Export",
  warehouseExportValue: (n) => `+${n} credits`,
  provisionSite: "Provision site",
  provisionCost: (n) => `${n} credits`,
  provisionFull: "Site quota full",
  dashQuickTitle: "Quick actions",
  dashQuickHealth: "Batch health check",
  dashQuickRelease: "Backup & release",
  dashQuickScan: "Security scan",
  terminalPrompt: "root@ops",
  terminalRun: "Run",
  terminalPlaceholder: "Type a command — help for list",
  settingsTitle: "Settings",
  settingsSaveTitle: "Save data",
  settingsSaveHint: "Progress is stored in this device's IndexedDB. Export a backup, import, or reset.",
  settingsExport: "Export save",
  settingsImport: "Import save",
  settingsReset: "Reset panel",
  settingsResetConfirm: "Clear local ops progress and start fresh?",
  settingsPrefsTitle: "Preferences",
  settingsCompact: "Compact layout",
  settingsCompactHint: "Tighter padding so more rows fit on screen",
  settingsDebug: "Show debug info",
  settingsDebugHint: "Show site ids on the Websites table",
  settingsAboutTitle: "About",
  settingsAboutBody: (version) =>
    `Ops panel ${version} · micromist solo. Install, deploy, health-check, release, upgrade — grow your mini datacenter. Wall-clock advances days and enabled cron. Data stays on this device.`,
  settingsImportOk: "Save imported",
  settingsImportFail: "Import failed: invalid file",
  settingsExportOk: "Save downloaded",
  plotsColTier: "Plan",
  tier: {
    basic: "Basic",
    standard: "Standard",
    premium: "Premium",
  },
  upgradeTier: "Upgrade",
  upgradeTierCost: (n) => `${n} credits`,
  upgradeTierMax: "Already premium",
  cardPremium: "Premium sites",
  tickHint: (secs) => `~${secs}s to next day`,
};
