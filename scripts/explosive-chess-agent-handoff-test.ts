/**
 * Explosive-chess agent handoff: public guide negotiation and copy prompts.
 * Run: npm run test:explosive-handoff
 */
import { readFileSync } from "node:fs";
import {
  agentGuideHttpResponse,
  composeAgentGuide,
  explosiveChessWsUrl,
  matchAgentGuidePath,
  prefersHtml,
  renderAgentGuideHtml,
} from "../shared/explosive-chess/agent-guide";
import {
  freshAgentId,
  promptDualGuest,
  promptDualHost,
  promptHumanOpponent,
  promptInviteAgent,
  type AgentMatchRules,
} from "../shared/explosive-chess/agent-handoff";
import { explosiveEn, explosiveZh } from "../src/games/explosive-chess/i18n";
import { createChecker } from "./lib/checks";

const c = createChecker();
const protocol = readFileSync("docs/agent-ws-explosive-chess.md", "utf8");
const origin = "https://micromist-staging.goldeneaglepersonal.dpdns.org";
const rules: AgentMatchRules = {
  boardSize: 9,
  winMode: "steps",
  winParam: 4,
  hostColor: "red",
};

function jsonLine(text: string, type: string): unknown {
  const line = text.split("\n").find((l) => l.includes(`"type":"${type}"`) && l.startsWith("{"));
  c.check(!!line, `prompt has a ${type} JSON line`);
  return line ? JSON.parse(line) : null;
}

c.section("guide path");
{
  c.check(matchAgentGuidePath("/agent-guide") === "index", "index");
  c.check(matchAgentGuidePath("/agent-guide/") === "index", "index trailing slash");
  c.check(matchAgentGuidePath("/agent-guide/explosive-chess") === "page", "page");
  c.check(matchAgentGuidePath("/agent-guide/explosive-chess/") === "page", "page trailing slash");
  c.check(matchAgentGuidePath("/agent-guide/explosive-chess.md") === "markdown", "markdown path");
  c.check(matchAgentGuidePath("/agent-guide/other") === "unknown", "unknown slug");
  c.check(matchAgentGuidePath("/ws/explosive-chess:abc") === null, "ws is not a guide");
  c.check(matchAgentGuidePath("/play/explosive-chess") === null, "play page is not a guide");
}

c.section("accept negotiation");
{
  const browser = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
  c.check(prefersHtml(null, null) === false, "missing accept is markdown");
  c.check(prefersHtml("*/*", null) === false, "curl */* is markdown");
  c.check(prefersHtml(browser, null) === true, "browser accept is html");
  c.check(prefersHtml(browser, "md") === false, "format=md overrides html");
  c.check(prefersHtml("*/*", "html") === true, "format=html overrides curl");
  c.check(prefersHtml("text/markdown, text/html;q=0.5", null) === false, "markdown wins on q");
}

c.section("served guide");
{
  const composed = composeAgentGuide(origin, protocol);
  c.check(composed.includes(origin), "banner names the request origin");
  c.check(
    composed.includes(`${origin}/agent-guide/explosive-chess`),
    "banner names the guide URL",
  );
  c.check(
    composed.includes("wss://micromist-staging.goldeneaglepersonal.dpdns.org/ws/explosive-chess:<code>"),
    "banner names the websocket shape",
  );
  c.check(composed.includes("your_turn"), "protocol your_turn kept");
  c.check(composed.includes("legalActions"), "protocol legalActions kept");
  c.check(composed.includes("There is no MCP"), "protocol no-MCP kept");
  c.check(composed.includes("把下面内容复制，让你的 AI 一起玩"), "setup invite line is in the guide");
  c.check(composed.includes("should you create a room"), "guide tells the agent to ask about creating a room");
  c.check(composed.indexOf("# 当前站点") < composed.indexOf("# 爆炸棋"), "host block is first");

  const html = renderAgentGuideHtml(composed, `${origin}/agent-guide/explosive-chess.md`);
  const text = html.replace(/<[^>]+>/g, " ");
  for (const needle of [
    "your_turn",
    "legalActions",
    "explosive-chess",
    "set_config",
    "game_over",
    "websocat",
    "Ready is disabled",
    "Needs Node 22+",
    origin,
    "no MCP",
  ]) {
    c.check(text.includes(needle), `html text keeps ${needle}`);
  }
  c.check(text.length > protocol.length * 0.8, "html text is not a stub", `${text.length} vs ${protocol.length}`);

  const mdRes = agentGuideHttpResponse(
    new Request(`${origin}/agent-guide/explosive-chess`, { headers: { accept: "*/*" } }),
    protocol,
  );
  c.check(mdRes?.status === 200, "curl status");
  c.check(mdRes?.headers.get("content-type")?.startsWith("text/markdown"), "curl content-type");
  c.check(mdRes?.headers.get("access-control-allow-origin") === "*", "guide is fetchable cross-origin");
  const mdBody = await mdRes!.text();
  c.check(mdBody.startsWith("# 当前站点"), "curl body starts with the host block");
  c.check(mdBody.includes("kind"), "curl body has join kind");

  const htmlRes = agentGuideHttpResponse(
    new Request(`${origin}/agent-guide/explosive-chess`, {
      headers: { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    }),
    protocol,
  );
  c.check(htmlRes?.headers.get("content-type")?.startsWith("text/html"), "browser content-type");
  const htmlBody = await htmlRes!.text();
  c.check(htmlBody.includes("<h1>"), "browser body is html");
  c.check(htmlBody.includes("your_turn"), "browser body has the protocol");

  const forcedMd = agentGuideHttpResponse(
    new Request(`${origin}/agent-guide/explosive-chess.md`, {
      headers: { accept: "text/html" },
    }),
    protocol,
  );
  c.check(forcedMd?.headers.get("content-type")?.startsWith("text/markdown"), ".md path stays markdown");

  const local = agentGuideHttpResponse(
    new Request("http://127.0.0.1:8787/agent-guide/explosive-chess"),
    protocol,
  );
  const localBody = await local!.text();
  c.check(localBody.includes("ws://127.0.0.1:8787/ws/explosive-chess:<code>"), "local host uses ws");

  const missing = agentGuideHttpResponse(
    new Request(`${origin}/agent-guide/chroma-slide`),
    protocol,
  );
  c.check(missing?.status === 404, "other slugs 404");
  const missingBody = await missing!.text();
  c.check(missingBody.includes("/agent-guide/explosive-chess"), "404 points at explosive-chess");
  c.check(!missingBody.toLowerCase().includes("blade-break"), "404 does not advertise other games");

  const denied = agentGuideHttpResponse(
    new Request(`${origin}/agent-guide/explosive-chess`, { method: "POST" }),
    protocol,
  );
  c.check(denied?.status === 405, "post is rejected");

  const ignored = agentGuideHttpResponse(new Request(`${origin}/ws/explosive-chess:abc`), protocol);
  c.check(ignored === null, "websocket path is left to the room router");

  const workerSrc = readFileSync("worker/agent-guide.ts", "utf8");
  c.check(
    workerSrc.includes("docs/agent-ws-explosive-chess.md?raw"),
    "worker serves the docs file",
  );
  const wrangler = readFileSync("wrangler.jsonc", "utf8");
  c.check(wrangler.includes('"/agent-guide/*"'), "worker runs before the SPA for the guide");
}

c.section("copy prompts");
{
  const code = "ab12cd";
  const guest = promptHumanOpponent({
    origin,
    roomCode: code,
    playerId: "agent-human1",
    humanSeated: true,
    rules,
  });
  const host = promptDualHost({
    origin,
    roomCode: code,
    playerId: "agent-a-host01",
    rules,
  });
  const join = promptDualGuest({
    origin,
    roomCode: code,
    playerId: "agent-b-join01",
    rules,
  });
  const ws = explosiveChessWsUrl(origin, code);
  for (const [name, text] of [
    ["human", guest],
    ["host", host],
    ["guest", join],
  ] as const) {
    c.check(text.includes(`${origin}/agent-guide/explosive-chess`), `${name} has the guide URL`);
    c.check(text.includes(ws), `${name} has the websocket URL`);
    c.check(text.includes(`room code: ${code}`), `${name} has the room code`);
    c.check(text.includes("your_turn"), `${name} waits for your_turn`);
    c.check(text.includes("legalActions"), `${name} plays from legalActions`);
    c.check(text.includes("不要轮询"), `${name} says not to poll`);
    c.check(text.includes("no MCP") || text.includes("没有 MCP"), `${name} says no MCP`);
    c.check(text.includes("game_over"), `${name} states the goal`);
    const parsed = jsonLine(text, "join") as { payload?: { kind?: string; playerId?: string; game?: string } };
    c.check(parsed?.payload?.kind === "agent", `${name} join kind is agent`);
    c.check(parsed?.payload?.game === "explosive-chess", `${name} join names the game`);
  }
  const guestJoin = jsonLine(guest, "join") as { payload?: { playerId?: string } };
  const hostJoin = jsonLine(host, "join") as { payload?: { playerId?: string } };
  const joinJoin = jsonLine(join, "join") as { payload?: { playerId?: string } };
  c.check(guestJoin?.payload?.playerId === "agent-human1", "human prompt uses the given playerId");
  c.check(hostJoin?.payload?.playerId === "agent-a-host01", "host prompt uses the given playerId");
  c.check(joinJoin?.payload?.playerId === "agent-b-join01", "guest prompt uses the given playerId");
  c.check(guest.includes("set_config"), "human prompt can set_config when it is host");
  c.check(host.includes(`"winMode":"steps"`), "host prompt sends the UI rules");
  c.check(host.includes(`"winParam":4`), "host prompt sends winParam");
  c.check(!join.includes("set_config"), "guest prompt does not send set_config");
  c.check(join.includes("you are B") || join.includes("You are Agent B"), "guest prompt names B");
  c.check(join.includes(code), "guest prompt repeats the room code");
  c.check(
    explosiveChessWsUrl("http://127.0.0.1:8787", "Ab12CD") === "ws://127.0.0.1:8787/ws/explosive-chess:ab12cd",
    "local websocket lowercases the code and uses ws",
  );
  let threw = false;
  try {
    promptHumanOpponent({ origin, roomCode: "  ", playerId: "x", humanSeated: false, rules });
  } catch {
    threw = true;
  }
  c.check(threw, "empty room code is rejected");
  c.check(/^agent-[a-z0-9]{8}$/.test(freshAgentId("agent")), "fresh id shape");
  c.check(freshAgentId("Agent A") !== freshAgentId("Agent A"), "fresh ids differ");
}

c.section("setup invite");
{
  const invite = promptInviteAgent(origin);
  c.check(invite.includes(`${origin}/agent-guide/explosive-chess`), "invite uses the absolute guide URL");
  c.check(invite.includes("Play against me"), "invite asks about playing the human");
  c.check(invite.includes("Should I create a room?"), "invite asks who creates the room");
  c.check(invite.includes("do you already have a room code?"), "invite asks for an existing room code");
  c.check(invite.includes("要和我对下吗"), "invite asks in Chinese");
  c.check(invite.includes("需要我建房吗"), "invite asks about creating a room in Chinese");
  c.check(invite.includes("已经有房间码"), "invite asks for a room code in Chinese");
  c.check(invite.includes("No MCP") || invite.includes("没有 MCP"), "invite says no MCP");
  c.check(!invite.includes("/ws/explosive-chess:"), "invite does not prefill a room socket");
  const local = promptInviteAgent("http://127.0.0.1:8787");
  c.check(
    local.includes("http://127.0.0.1:8787/agent-guide/explosive-chess"),
    "local invite uses the page origin",
  );
  c.check(!local.includes(origin), "local invite does not leak another host");

  const home = readFileSync("src/pages/HomePage.tsx", "utf8");
  c.check(!home.includes("AgentInvite") && !home.includes("agentInviteLine"), "catalog home has no invite");
  c.check(!home.includes("promptInviteAgent") && !home.includes("HomeAgentInvite"), "catalog home does not copy a prompt");
  const setup = readFileSync("src/games/explosive-chess/ExplosiveChessSetup.tsx", "utf8");
  c.check(setup.includes("AgentInvite"), "setup page renders the invite");
  c.check(setup.includes("agentInviteLine"), "setup page shows the one sentence");
  c.check(!setup.includes("AgentHandoff") && !setup.includes("invite-agent"), "complex handoff UI stays removed");
  let handoffUi = false;
  try {
    readFileSync("src/games/explosive-chess/AgentHandoff.tsx", "utf8");
    handoffUi = true;
  } catch {
    handoffUi = false;
  }
  c.check(!handoffUi, "complex handoff component is removed");
}

c.section("setup copy strings");
{
  const enKeys = Object.keys(explosiveEn).sort();
  const zhKeys = Object.keys(explosiveZh).sort();
  c.check(enKeys.join() === zhKeys.join(), "en and zh explosive strings match", enKeys.filter((k) => !zhKeys.includes(k)).join(","));
  c.check(explosiveZh.agentInviteLine === "把下面内容复制，让你的 AI 一起玩", "chinese one-liner");
  c.check(explosiveEn.agentInviteLine.length > 0, "english one-liner");
  c.check(explosiveZh.agentInviteCopy === "复制" && explosiveEn.agentInviteCopy === "Copy", "one copy button label");
  for (const gone of ["agentHandoffTitle", "copyForAgent", "copyAgentA", "dualTitle", "copyWsOnly"]) {
    c.check(!(gone in explosiveEn) && !(gone in explosiveZh), `${gone} removed`);
  }
}

c.finish();
