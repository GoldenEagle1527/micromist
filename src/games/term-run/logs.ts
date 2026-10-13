/**
 * Access-log lines for term-run.
 * Terrain is NOT line length — only ground / bump1 / bump2 / gap.
 */

export type CellKind = "ground" | "bump1" | "bump2" | "gap";

export type LogLine = {
  raw: string;
  kind: CellKind;
  /** Obstacle height in rows: bump1→1, bump2→1 per cell (pair makes 2). */
  bump: number;
};

export function makeLogLine(raw: string, kind: CellKind = "ground"): LogLine {
  const trimmed = raw.replace(/\s+$/, "");
  if (kind === "gap" || trimmed.length === 0) {
    return { raw: "", kind: "gap", bump: 0 };
  }
  const bump = kind === "bump1" || kind === "bump2" ? 1 : 0;
  return { raw: trimmed, kind, bump };
}

/** Desensitized uvicorn.access sample — early flat stretch. */
export const SAMPLE_LOGS: string[] = [
  '2026-10-13 13:21:04,112 - INFO - adpilot|uvicorn.access - 127.0.0.1:51234 - "GET /api/v1/health HTTP/1.1" 200 4ms',
  '2026-10-13 13:21:04,188 - INFO - adpilot|uvicorn.access - 127.0.0.1:51234 - "GET /api/v1/platforms HTTP/1.1" 200 17ms',
  '2026-10-13 13:21:04,241 - INFO - adpilot|uvicorn.access - 10.0.0.8:48102 - "GET /api/v1/me HTTP/1.1" 200 9ms',
  '2026-10-13 13:21:04,302 - INFO - adpilot|uvicorn.access - 10.0.0.8:48102 - "GET /api/v1/campaigns?page=1&page_size=20 HTTP/1.1" 200 22ms',
  '2026-10-13 13:21:04,355 - INFO - adpilot|uvicorn.access - 10.0.0.8:48103 - "GET /favicon.ico HTTP/1.1" 204 2ms',
  '2026-10-13 13:21:04,410 - INFO - adpilot|uvicorn.access - 127.0.0.1:51235 - "GET /api/v1/platforms HTTP/1.1" 200 15ms',
  '2026-10-13 13:21:04,468 - INFO - adpilot|uvicorn.access - 203.0.113.44:39011 - "GET /api/v1/ads?page=1&page_size=50&status=active HTTP/1.1" 200 31ms',
  '2026-10-13 13:21:04,520 - INFO - adpilot|uvicorn.access - 203.0.113.44:39011 - "GET /api/v1/reports/summary HTTP/1.1" 200 41ms',
  '2026-10-13 13:21:04,577 - INFO - adpilot|uvicorn.access - 10.0.0.8:48104 - "POST /api/v1/auth/refresh HTTP/1.1" 200 12ms',
  '2026-10-13 13:21:04,630 - INFO - adpilot|uvicorn.access - 198.51.100.7:22001 - "GET /api/v1/campaigns/12/creatives HTTP/1.1" 200 19ms',
  '2026-10-13 13:21:04,688 - INFO - adpilot|uvicorn.access - 198.51.100.7:22001 - "GET /api/v1/campaigns?page=1&page_size=100&sort=-updated_at&q=brand HTTP/1.1" 200 55ms',
  '2026-10-13 13:21:04,740 - INFO - adpilot|uvicorn.access - 10.0.0.8:48105 - "GET /api/v1/settings HTTP/1.1" 200 8ms',
  '2026-10-13 13:21:04,801 - INFO - adpilot|uvicorn.access - 203.0.113.44:39012 - "GET /api/v1/missing HTTP/1.1" 404 6ms',
  '2026-10-13 13:21:04,855 - INFO - adpilot|uvicorn.access - 127.0.0.1:51236 - "GET /api/v1/platforms HTTP/1.1" 200 14ms',
  '2026-10-13 13:21:04,910 - INFO - adpilot|uvicorn.access - 10.0.0.8:48106 - "GET /api/v1/ads/99 HTTP/1.1" 200 11ms',
  '2026-10-13 13:21:04,968 - INFO - adpilot|uvicorn.access - 203.0.113.90:11022 - "GET /api/v1/export?format=csv&from=2026-09-01&to=2026-10-13&tz=Asia/Shanghai HTTP/1.1" 200 128ms',
  '2026-10-13 13:21:05,020 - INFO - adpilot|uvicorn.access - 10.0.0.8:48107 - "GET /api/v1/health HTTP/1.1" 200 3ms',
  '2026-10-13 13:21:05,077 - INFO - adpilot|uvicorn.access - 198.51.100.7:22002 - "PUT /api/v1/campaigns/12 HTTP/1.1" 200 27ms',
  '2026-10-13 13:21:05,130 - INFO - adpilot|uvicorn.access - 203.0.113.44:39013 - "GET /api/v1/login HTTP/1.1" 302 5ms',
  '2026-10-13 13:21:05,188 - INFO - adpilot|uvicorn.access - 10.0.0.8:48108 - "GET /api/v1/platforms HTTP/1.1" 200 16ms',
];

const PATHS = [
  "/api/v1/health",
  "/api/v1/me",
  "/api/v1/platforms",
  "/api/v1/settings",
  "/favicon.ico",
  "/api/v1/ads/1",
  "/api/v1/campaigns?page=1&page_size=20",
  "/api/v1/ads?page=1&page_size=50&status=active",
  "/api/v1/reports/summary",
  "/api/v1/campaigns/12/creatives",
  "/api/v1/auth/refresh",
  "/api/v1/campaigns?page=1&page_size=100&sort=-updated_at&q=brand&locale=zh-CN",
  "/api/v1/export?format=csv&from=2026-09-01&to=2026-10-13&tz=Asia/Shanghai&cols=id,name,spend",
  "/api/v1/ads?page=3&page_size=100&status=active&platform=meta&q=summer_sale_2026",
  "/api/v1/search?q=performance+max&filters=channel:search,bid:auto&expand=creatives,stats",
];

const IPS = [
  "127.0.0.1",
  "10.0.0.8",
  "10.0.0.12",
  "203.0.113.44",
  "203.0.113.90",
  "198.51.100.7",
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatTs(dayStart: number, index: number): string {
  const ms = dayStart + index * 47;
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())},` +
    String(d.getMilliseconds()).padStart(3, "0")
  );
}

function buildAccessLine(rng: () => number, dayStart: number, i: number): string {
  const path = PATHS[Math.floor(rng() * PATHS.length)]!;
  const method = rng() < 0.12 ? (rng() < 0.5 ? "POST" : "PUT") : "GET";
  const ip = IPS[Math.floor(rng() * IPS.length)]!;
  const port = 10000 + Math.floor(rng() * 50000);
  let status = 200;
  const sRoll = rng();
  if (sRoll < 0.03) status = rng() < 0.5 ? 500 : 502;
  else if (sRoll < 0.08) status = rng() < 0.6 ? 404 : 403;
  else if (sRoll < 0.11) status = 302;
  else if (method === "POST" && rng() < 0.3) status = 201;
  const ms =
    status >= 500
      ? 80 + Math.floor(rng() * 200)
      : path.includes("export") || path.includes("search")
        ? 40 + Math.floor(rng() * 120)
        : 2 + Math.floor(rng() * 28);
  const level = status >= 500 ? "ERROR" : "INFO";
  return (
    `${formatTs(dayStart, i)} - ${level} - adpilot|uvicorn.access - ` +
    `${ip}:${port} - "${method} ${path} HTTP/1.1" ${status} ${ms}ms`
  );
}

export type SynthOpts = {
  seed?: number;
  /** Climbs with distance — more bumps/gaps. */
  difficulty?: number;
};

/**
 * Endless lines with obstacle pattern:
 * ground · bump1 (1 row) · bump2 (2 rows) · gap (blank).
 */
export function* synthLogs(opts: SynthOpts = {}): Generator<LogLine> {
  const rng = mulberry32(opts.seed ?? 20261013);
  let i = 0;
  const dayStart = Date.UTC(2026, 9, 13, 5, 21, 4);
  let sinceObstacle = 0;

  while (true) {
    const diff = Math.max(0, opts.difficulty ?? 0) + i / 90;
    sinceObstacle += 1;

    // Cooldown so obstacles aren't stacked too tight
    const minGap = Math.max(3, 6 - Math.floor(diff * 0.4));
    if (sinceObstacle >= minGap && i > 18) {
      const pBump1 = Math.min(0.12, 0.04 + diff * 0.01);
      const pBump2 = Math.min(0.08, 0.015 + diff * 0.008);
      const pGap = Math.min(0.1, 0.025 + diff * 0.009);
      const roll = rng();
      if (roll < pGap) {
        sinceObstacle = 0;
        i += 1;
        yield makeLogLine("", "gap");
        // Rare double gap
        if (rng() < 0.25 + diff * 0.02) {
          i += 1;
          yield makeLogLine("", "gap");
        }
        continue;
      }
      if (roll < pGap + pBump2) {
        sinceObstacle = 0;
        const a = buildAccessLine(rng, dayStart, i++);
        const b = buildAccessLine(rng, dayStart, i++);
        yield makeLogLine(a, "bump2");
        yield makeLogLine(b, "bump2");
        continue;
      }
      if (roll < pGap + pBump2 + pBump1) {
        sinceObstacle = 0;
        const a = buildAccessLine(rng, dayStart, i++);
        yield makeLogLine(a, "bump1");
        continue;
      }
    }

    const raw = buildAccessLine(rng, dayStart, i++);
    yield makeLogLine(raw, "ground");
  }
}

/** Sample with a few teaching obstacles after a flat runway. */
export function sampleAsLines(): LogLine[] {
  const base = SAMPLE_LOGS.map((s) => makeLogLine(s, "ground"));
  // Teach with space: bump1 → flats → bump2×2 → flats → gap
  base.push(makeLogLine(SAMPLE_LOGS[0]!, "bump1"));
  for (const i of [1, 2, 3, 4]) base.push(makeLogLine(SAMPLE_LOGS[i]!, "ground"));
  base.push(makeLogLine(SAMPLE_LOGS[5]!, "bump2"));
  base.push(makeLogLine(SAMPLE_LOGS[6]!, "bump2"));
  for (const i of [7, 8, 9]) base.push(makeLogLine(SAMPLE_LOGS[i]!, "ground"));
  base.push(makeLogLine("", "gap"));
  base.push(makeLogLine(SAMPLE_LOGS[10]!, "ground"));
  base.push(makeLogLine(SAMPLE_LOGS[11]!, "ground"));
  return base;
}
