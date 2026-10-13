/**
 * Access-log lines → terrain segments.
 * height from trimmed length; status/ms drive hazards & feel.
 */

export type LogStatusClass = "ok" | "redirect" | "client" | "server" | "none";

export type LogLine = {
  raw: string;
  len: number;
  status: number | null;
  statusClass: LogStatusClass;
  ms: number | null;
  /** Blank / separator → cliff */
  cliff: boolean;
};

const L_REF = 120;
const H_MIN = 0.12;
const H_MAX = 1;

export function statusClassOf(status: number | null): LogStatusClass {
  if (status == null) return "none";
  if (status >= 200 && status < 300) return "ok";
  if (status >= 300 && status < 400) return "redirect";
  if (status >= 400 && status < 500) return "client";
  if (status >= 500) return "server";
  return "none";
}

/** Normalized height 0..1 from line length. */
export function heightOf(line: LogLine): number {
  if (line.cliff) return 0;
  const h = line.len / L_REF;
  return Math.min(H_MAX, Math.max(H_MIN, h));
}

function parseStatusMs(raw: string): { status: number | null; ms: number | null } {
  const m = raw.match(/\b([1-5]\d{2})\b(?:\s+(\d+)ms)?\s*$/);
  if (!m) {
    const onlyMs = raw.match(/\b(\d+)ms\s*$/);
    return { status: null, ms: onlyMs ? Number(onlyMs[1]) : null };
  }
  return {
    status: Number(m[1]),
    ms: m[2] != null ? Number(m[2]) : null,
  };
}

export function makeLogLine(raw: string): LogLine {
  const trimmed = raw.replace(/\s+$/, "");
  const cliff = trimmed.length === 0 || /^[-=_*]{4,}$/.test(trimmed);
  const { status, ms } = cliff ? { status: null, ms: null } : parseStatusMs(trimmed);
  return {
    raw: trimmed,
    len: trimmed.length,
    status,
    statusClass: statusClassOf(status),
    ms,
    cliff,
  };
}

/** Desensitized uvicorn.access-style sample (teaches early terrain). */
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
  "",
  '2026-10-13 13:21:05,255 - INFO - adpilot|uvicorn.access - 203.0.113.44:39014 - "GET /api/v1/ads?page=2&page_size=50 HTTP/1.1" 200 29ms',
  '2026-10-13 13:21:05,310 - ERROR - adpilot|uvicorn.access - 203.0.113.44:39014 - "GET /api/v1/reports/heavy HTTP/1.1" 500 210ms',
  '2026-10-13 13:21:05,366 - INFO - adpilot|uvicorn.access - 127.0.0.1:51237 - "GET /api/v1/health HTTP/1.1" 200 4ms',
  '2026-10-13 13:21:05,420 - INFO - adpilot|uvicorn.access - 10.0.0.8:48109 - "GET /api/v1/campaigns?page=1&page_size=20 HTTP/1.1" 200 21ms',
  '2026-10-13 13:21:05,488 - INFO - adpilot|uvicorn.access - 198.51.100.7:22003 - "POST /api/v1/ads HTTP/1.1" 201 33ms',
  '2026-10-13 13:21:05,540 - INFO - adpilot|uvicorn.access - 10.0.0.8:48110 - "GET /api/v1/forbidden HTTP/1.1" 403 7ms',
  '2026-10-13 13:21:05,599 - INFO - adpilot|uvicorn.access - 203.0.113.44:39015 - "GET /api/v1/platforms HTTP/1.1" 200 18ms',
  '2026-10-13 13:21:05,655 - INFO - adpilot|uvicorn.access - 127.0.0.1:51238 - "GET /api/v1/me HTTP/1.1" 200 10ms',
];

const PATHS_SHORT = [
  "/api/v1/health",
  "/api/v1/me",
  "/api/v1/platforms",
  "/api/v1/settings",
  "/favicon.ico",
  "/api/v1/ads/1",
];

const PATHS_MID = [
  "/api/v1/campaigns?page=1&page_size=20",
  "/api/v1/ads?page=1&page_size=50&status=active",
  "/api/v1/reports/summary",
  "/api/v1/campaigns/12/creatives",
  "/api/v1/auth/refresh",
];

const PATHS_LONG = [
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

export type SynthOpts = {
  seed?: number;
  /** Distance / line index — raises 4xx/5xx and long paths. */
  difficulty?: number;
};

/**
 * Endless synthetic uvicorn.access lines.
 * difficulty 0 = tutorial hills; climbs with distance.
 */
export function* synthLogs(opts: SynthOpts = {}): Generator<LogLine> {
  const rng = mulberry32(opts.seed ?? 20261013);
  let i = 0;
  const dayStart = Date.UTC(2026, 9, 13, 5, 21, 4);

  while (true) {
    const diff = Math.max(0, opts.difficulty ?? 0) + i / 80;
    const roll = rng();

    // Occasional blank cliff after early game
    if (i > 24 && rng() < Math.min(0.08, 0.02 + diff * 0.008)) {
      i += 1;
      yield makeLogLine("");
      continue;
    }

    let path: string;
    const lenRoll = rng();
    if (lenRoll < 0.45 - Math.min(0.15, diff * 0.02)) {
      path = PATHS_SHORT[Math.floor(rng() * PATHS_SHORT.length)]!;
    } else if (lenRoll < 0.78) {
      path = PATHS_MID[Math.floor(rng() * PATHS_MID.length)]!;
    } else {
      path = PATHS_LONG[Math.floor(rng() * PATHS_LONG.length)]!;
    }

    const method = rng() < 0.12 ? (rng() < 0.5 ? "POST" : "PUT") : "GET";
    const ip = IPS[Math.floor(rng() * IPS.length)]!;
    const port = 10000 + Math.floor(rng() * 50000);

    // Status mix
    let status = 200;
    const sRoll = rng();
    const p5 = Math.min(0.14, 0.01 + diff * 0.012);
    const p4 = Math.min(0.18, 0.03 + diff * 0.015);
    const p3 = 0.04;
    if (sRoll < p5) status = rng() < 0.5 ? 500 : 502;
    else if (sRoll < p5 + p4) status = rng() < 0.6 ? 404 : 403;
    else if (sRoll < p5 + p4 + p3) status = 302;
    else if (method === "POST" && rng() < 0.3) status = 201;

    let ms: number;
    if (status >= 500) ms = 80 + Math.floor(rng() * 200);
    else if (path.includes("export") || path.includes("search")) {
      ms = 40 + Math.floor(rng() * 120);
    } else if (rng() < 0.08 + diff * 0.01) {
      ms = 60 + Math.floor(rng() * 180); // spike
    } else {
      ms = 2 + Math.floor(rng() * 28);
    }

    const level = status >= 500 ? "ERROR" : "INFO";
    const raw =
      `${formatTs(dayStart, i)} - ${level} - adpilot|uvicorn.access - ` +
      `${ip}:${port} - "${method} ${path} HTTP/1.1" ${status} ${ms}ms`;

    i += 1;
    // silence unused
    void roll;
    yield makeLogLine(raw);
  }
}

export function sampleAsLines(): LogLine[] {
  return SAMPLE_LOGS.map(makeLogLine);
}
