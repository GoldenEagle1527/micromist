/**
 * Unified agent catalog, homepage prompt, and official local client.
 * Run: npm run test:agent
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFileSync } from "node:fs";
import { agentPlatformHttpResponse } from "../shared/agent/http";
import { promptInviteAgent } from "../shared/agent/handoff";
import { agentGames, DEFAULT_AGENT_PORT } from "../shared/agent/catalog";
import { createChecker } from "./lib/checks";

const c = createChecker();
const origin = "https://micromist-staging.goldeneaglepersonal.dpdns.org";
const CJK = /[\u3400-\u9fff]/;

const library = {
  "explosive-chess": {
    en: readFileSync("docs/agent-ws-explosive-chess.md", "utf8"),
    zh: readFileSync("docs/agent-ws-explosive-chess.zh.md", "utf8"),
  },
  gomoku: {
    en: readFileSync("docs/agent-ws-gomoku.md", "utf8"),
    zh: readFileSync("docs/agent-ws-gomoku.zh.md", "utf8"),
  },
  "chroma-slide": {
    en: readFileSync("docs/agent-ws-chroma-slide.md", "utf8"),
    zh: readFileSync("docs/agent-ws-chroma-slide.zh.md", "utf8"),
  },
};

c.section("catalog");
{
  c.check(agentGames.map((g) => g.slug).join() === "explosive-chess,gomoku,chroma-slide", "three games");
  c.check(agentGames.some((g) => g.slug === "gomoku" && g.seats.join() === "red,blue"), "gomoku uses red/blue");
}

c.section("prompt");
{
  const zh = promptInviteAgent(origin, "zh");
  const en = promptInviteAgent(origin, "en");
  c.check(CJK.test(zh) && !CJK.test(en), "prompts stay in one language");
  c.check(zh.includes(`${origin}/agent-clients/server.mjs`) && en.includes(`${origin}/agent-clients/server.py`), "prompt names the unified clients");
  c.check(zh.includes("$BASE/games") && en.includes("$BASE/games/SLUG"), "prompt fetches the list then a slug");
  c.check(!zh.includes("求解器") && !en.toLowerCase().includes("solver"), "prompt does not ban solvers");
  c.check(zh.includes(String(DEFAULT_AGENT_PORT)) && en.includes(String(DEFAULT_AGENT_PORT)), "prompt names the start port");
}

c.section("guide http");
{
  const indexJson = agentPlatformHttpResponse(
    new Request(`${origin}/agent-guide`, { headers: { accept: "application/json" } }),
    library,
  );
  c.check(indexJson != null && indexJson.status === 200, "index json");
  const payload = JSON.parse(await indexJson!.text()) as { games: { slug: string }[] };
  c.check(payload.games.map((g) => g.slug).join() === "explosive-chess,gomoku,chroma-slide", "json lists games");

  const gomokuZh = agentPlatformHttpResponse(
    new Request(`${origin}/agent-guide/gomoku/zh`, { headers: { accept: "text/markdown" } }),
    library,
  );
  const body = await gomokuZh!.text();
  c.check(gomokuZh!.headers.get("content-type")?.includes("markdown") === true, "gomoku markdown");
  c.check(body.includes("红是黑棋") && body.includes("18780"), "gomoku chinese usage");

  const missing = agentPlatformHttpResponse(new Request(`${origin}/agent-guide/nope`), library);
  c.check(missing?.status === 404, "unknown slug 404");
}

c.section("homepage wiring");
{
  const home = readFileSync("src/pages/HomePage.tsx", "utf8");
  const app = readFileSync("src/App.tsx", "utf8");
  const explosivePlay = readFileSync("src/games/explosive-chess/play.ts", "utf8");
  const chromaPlay = readFileSync("src/games/chroma-slide/play.ts", "utf8");
  c.check(home.includes('to="/agent"'), "home has agent card");
  c.check(app.includes("path=\"agent\""), "app routes /agent");
  c.check(!explosivePlay.includes("invite:") && !chromaPlay.includes("invite:"), "in-game invite removed");
}

c.section("local client");
{
  const help = await run("node", ["public/agent-clients/server.mjs", "--help"]);
  c.check(help.code === 0 && help.stdout.includes("/games") && help.stdout.includes("18780"), "node help");
  const missing = await run("node", ["public/agent-clients/server.mjs"]);
  c.check(missing.code !== 0 && /origin/i.test(missing.stdout + missing.stderr), "origin required");

  const blocker = createServer();
  await new Promise<void>((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(DEFAULT_AGENT_PORT, "127.0.0.1", () => resolve());
  });
  const session = start("node", ["public/agent-clients/server.mjs", "--origin", "http://127.0.0.1:9"]);
  const listening = await waitLine(session, (row) => row.event === "listening", 8000);
  c.check(typeof listening.port === "number" && listening.port > DEFAULT_AGENT_PORT, "skips a taken port");
  session.kill();
  await new Promise<void>((resolve) => blocker.close(() => resolve()));
}

c.section("gomoku observation");
{
  const adapterSrc = readFileSync("worker/games/gomoku/adapter.ts", "utf8");
  c.check(adapterSrc.includes("legalActions"), "gomoku adapter sends legalActions");
}

c.finish();

function run(command: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: child.exitCode, stdout, stderr });
    }, 8000);
  });
}

type Proc = { kill: () => void; stdout: string };

function start(command: string, args: string[]): Proc {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  const proc: Proc = {
    stdout: "",
    kill() {
      child.kill("SIGKILL");
    },
  };
  child.stdout.on("data", (chunk) => {
    proc.stdout += String(chunk);
  });
  return proc;
}

function waitLine(proc: Proc, pred: (row: Record<string, unknown>) => boolean, timeoutMs: number): Promise<Record<string, unknown>> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      for (const line of proc.stdout.split("\n")) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line) as Record<string, unknown>;
          if (pred(row)) {
            resolve(row);
            return;
          }
        } catch {
          /* skip */
        }
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`timeout waiting for line\n${proc.stdout}`));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}
