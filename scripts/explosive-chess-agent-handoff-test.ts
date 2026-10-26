/**
 * Explosive-chess agent handoff: public guide negotiation, locale copy, and official clients.
 * Run: npm run test:explosive-handoff
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { readFileSync } from "node:fs";
import {
  agentGuideHttpResponse,
  composeAgentGuide,
  explosiveChessClients,
  explosiveChessWsUrl,
  matchAgentGuidePath,
  prefersHtml,
  renderAgentGuideHtml,
  type AgentGuideProtocols,
} from "../shared/explosive-chess/agent-guide";
import {
  freshAgentId,
  promptDualGuest,
  promptDualHost,
  promptHumanOpponent,
  promptInviteAgent,
  type AgentLocale,
  type AgentMatchRules,
} from "../shared/explosive-chess/agent-handoff";
import { explosiveEn, explosiveZh } from "../src/games/explosive-chess/i18n";
import { createChecker } from "./lib/checks";

const c = createChecker();
const protocolEn = readFileSync("docs/agent-ws-explosive-chess.md", "utf8");
const protocolZh = readFileSync("docs/agent-ws-explosive-chess.zh.md", "utf8");
const protocols: AgentGuideProtocols = { en: protocolEn, zh: protocolZh };
const CJK = /[\u3400-\u9fff]/;
const origin = "https://micromist-staging.goldeneaglepersonal.dpdns.org";
const rules: AgentMatchRules = {
  boardSize: 9,
  winMode: "steps",
  winParam: 4,
  hostColor: "red",
};

function assertLocale(text: string, locale: AgentLocale, name: string): void {
  if (locale === "en") {
    c.check(!CJK.test(text), `${name} english has no CJK`);
    c.check(text.includes("Do not poll."), `${name} says not to poll`);
    c.check(text.includes("There is no MCP."), `${name} says no MCP`);
    c.check(text.includes("keeps the WebSocket open"), `${name} says to keep the socket open`);
  } else {
    c.check(CJK.test(text), `${name} chinese has CJK`);
    c.check(!text.includes("Should I create a room?"), `${name} chinese has no english invite question`);
    c.check(!text.includes("You are an explosive-chess agent."), `${name} chinese does not use the english intro`);
    c.check(text.includes("不要轮询"), `${name} says not to poll`);
    c.check(text.includes("没有 MCP"), `${name} says no MCP`);
    c.check(text.includes("不要断开"), `${name} says not to disconnect`);
  }
}

c.section("guide path");
{
  c.check(matchAgentGuidePath("/agent-guide") === "index", "index");
  c.check(matchAgentGuidePath("/agent-guide/") === "index", "index trailing slash");
  c.check(matchAgentGuidePath("/agent-guide/explosive-chess") === "page", "page");
  c.check(matchAgentGuidePath("/agent-guide/explosive-chess/") === "page", "page trailing slash");
  c.check(matchAgentGuidePath("/agent-guide/explosive-chess.md") === "markdown", "markdown path");
  c.check(matchAgentGuidePath("/agent-guide/explosive-chess/en") === "page", "english page");
  c.check(matchAgentGuidePath("/agent-guide/explosive-chess/zh") === "page", "chinese page");
  c.check(matchAgentGuidePath("/agent-guide/explosive-chess/zh/") === "page", "chinese page trailing slash");
  c.check(matchAgentGuidePath("/agent-guide/explosive-chess/en.md") === "markdown", "english markdown path");
  c.check(matchAgentGuidePath("/agent-guide/explosive-chess/zh.md") === "markdown", "chinese markdown path");
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
  const composed = composeAgentGuide(origin, protocolEn, "en");
  c.check(composed.includes(origin), "banner names the request origin");
  c.check(
    composed.includes(`${origin}/agent-guide/explosive-chess/en`),
    "banner names the english guide URL",
  );
  c.check(
    composed.includes("wss://micromist-staging.goldeneaglepersonal.dpdns.org/ws/explosive-chess:<code>"),
    "banner names the websocket shape",
  );
  c.check(composed.includes(`${origin}${explosiveChessClients.node}`), "banner names the node client");
  c.check(composed.includes(`${origin}${explosiveChessClients.python}`), "banner names the python client");
  c.check(composed.includes("--poll"), "banner names the poll fallback");
  c.check(composed.includes("create_room"), "guide documents create_room");
  c.check(composed.includes("join_room"), "guide documents join_room");
  c.check(composed.includes("stdin"), "guide reads moves from stdin");
  c.check(composed.includes("retired"), "one-shot client is retired in the guide");
  c.check(composed.includes("your_turn"), "protocol your_turn kept");
  c.check(composed.includes("legalActions"), "protocol legalActions kept");
  c.check(composed.includes("There is no MCP"), "protocol no-MCP kept");
  c.check(composed.includes("Keep that socket open"), "guide says the socket must stay open");
  c.check(composed.includes("Leave your socket open"), "guide says the host waits connected");
  c.check(composed.includes("Click me to send this to your AI and play together."), "english setup invite line is in the guide");
  c.check(!composed.includes("点我，把内容发给 AI 陪你一起玩吧"), "english guide does not use the chinese invite line");
  c.check(composed.includes("should you create a room"), "guide tells the agent to ask about creating a room");
  c.check(composed.includes("no chess strength"), "guide says the clients have no chess strength");
  c.check(composed.includes("Do not write a solver"), "guide forbids a solver");
  c.check(composed.indexOf("# This host") < composed.indexOf("# explosive"), "english host block is first");

  const composedZh = composeAgentGuide(origin, protocolZh, "zh");
  c.check(composedZh.startsWith("# 当前站点"), "chinese guide starts with the host block");
  c.check(composedZh.includes("点我，把内容发给 AI 陪你一起玩吧"), "chinese setup invite line is in the guide");
  c.check(!composedZh.includes("should you create a room"), "chinese guide does not use the english question");
  c.check(composedZh.includes("它们没有棋力"), "chinese guide says the clients have no chess strength");
  c.check(composedZh.includes("不要编写求解器"), "chinese guide forbids a solver");
  c.check(composedZh.includes(`${origin}/agent-guide/explosive-chess/zh`), "chinese banner names its guide URL");
  c.check(composedZh.indexOf("# 当前站点") < composedZh.indexOf("# 爆炸棋"), "chinese host block is first");

  const html = renderAgentGuideHtml(composed, `${origin}/agent-guide/explosive-chess/en.md`, "en", `${origin}/agent-guide/explosive-chess/zh`);
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
  c.check(html.includes('lang="en"'), "english html language");
  c.check(text.length > protocolEn.length * 0.8, "html text is not a stub", `${text.length} vs ${protocolEn.length}`);

  const mdRes = agentGuideHttpResponse(
    new Request(`${origin}/agent-guide/explosive-chess`, { headers: { accept: "*/*" } }),
    protocols,
  );
  c.check(mdRes?.status === 200, "curl status");
  c.check(mdRes?.headers.get("content-type")?.startsWith("text/markdown"), "curl content-type");
  c.check(mdRes?.headers.get("access-control-allow-origin") === "*", "guide is fetchable cross-origin");
  const mdBody = await mdRes!.text();
  c.check(mdBody.startsWith("# This host"), "curl body starts with the english host block");
  c.check(mdBody.includes("kind"), "curl body has join kind");
  c.check(!mdBody.includes("点我，把内容发给 AI 陪你一起玩吧"), "default curl guide is english");

  const zhRes = agentGuideHttpResponse(
    new Request(`${origin}/agent-guide/explosive-chess/zh`, { headers: { accept: "*/*" } }),
    protocols,
  );
  const zhBody = await zhRes!.text();
  c.check(zhBody.startsWith("# 当前站点"), "zh path is chinese");
  c.check(!zhBody.includes("Should I create a room?"), "zh path has no english invite question");

  const zhBeatsQuery = agentGuideHttpResponse(
    new Request(`${origin}/agent-guide/explosive-chess/zh?lang=en`, { headers: { accept: "*/*" } }),
    protocols,
  );
  c.check((await zhBeatsQuery!.text()).startsWith("# 当前站点"), "path locale wins over query");

  const queryEn = agentGuideHttpResponse(
    new Request(`${origin}/agent-guide/explosive-chess?lang=en`, {
      headers: { accept: "*/*", "accept-language": "zh-CN,zh;q=0.9" },
    }),
    protocols,
  );
  c.check((await queryEn!.text()).startsWith("# This host"), "query locale wins over Accept-Language");

  const acceptZh = agentGuideHttpResponse(
    new Request(`${origin}/agent-guide/explosive-chess`, {
      headers: { accept: "*/*", "accept-language": "zh-CN,zh;q=0.9,en;q=0.5" },
    }),
    protocols,
  );
  c.check((await acceptZh!.text()).startsWith("# 当前站点"), "Accept-Language selects chinese");

  const htmlRes = agentGuideHttpResponse(
    new Request(`${origin}/agent-guide/explosive-chess/en`, {
      headers: { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    }),
    protocols,
  );
  c.check(htmlRes?.headers.get("content-type")?.startsWith("text/html"), "browser content-type");
  const htmlBody = await htmlRes!.text();
  c.check(htmlBody.includes("<h1>"), "browser body is html");
  c.check(htmlBody.includes("your_turn"), "browser body has the protocol");
  c.check(htmlBody.includes('lang="en"'), "browser html is english");
  c.check(htmlBody.includes(`${origin}/agent-guide/explosive-chess/zh`), "browser page links the other language");

  const forcedMd = agentGuideHttpResponse(
    new Request(`${origin}/agent-guide/explosive-chess.md`, {
      headers: { accept: "text/html" },
    }),
    protocols,
  );
  c.check(forcedMd?.headers.get("content-type")?.startsWith("text/markdown"), ".md path stays markdown");

  const local = agentGuideHttpResponse(
    new Request("http://127.0.0.1:8787/agent-guide/explosive-chess"),
    protocols,
  );
  const localBody = await local!.text();
  c.check(localBody.includes("ws://127.0.0.1:8787/ws/explosive-chess:<code>"), "local host uses ws");

  const missing = agentGuideHttpResponse(
    new Request(`${origin}/agent-guide/chroma-slide`),
    protocols,
  );
  c.check(missing?.status === 404, "other slugs 404");
  const missingBody = await missing!.text();
  c.check(missingBody.includes("/agent-guide/explosive-chess"), "404 points at explosive-chess");
  c.check(!missingBody.toLowerCase().includes("blade-break"), "404 does not advertise other games");

  const denied = agentGuideHttpResponse(
    new Request(`${origin}/agent-guide/explosive-chess`, { method: "POST" }),
    protocols,
  );
  c.check(denied?.status === 405, "post is rejected");

  const ignored = agentGuideHttpResponse(new Request(`${origin}/ws/explosive-chess:abc`), protocols);
  c.check(ignored === null, "websocket path is left to the room router");

  const workerSrc = readFileSync("worker/agent-guide.ts", "utf8");
  c.check(
    workerSrc.includes("docs/agent-ws-explosive-chess.md?raw"),
    "worker serves the english docs file",
  );
  c.check(
    workerSrc.includes("docs/agent-ws-explosive-chess.zh.md?raw"),
    "worker serves the chinese docs file",
  );
  const wrangler = readFileSync("wrangler.jsonc", "utf8");
  c.check(wrangler.includes('"/agent-guide/*"'), "worker runs before the SPA for the guide");
  c.check(wrangler.includes('"/mcp/*"'), "worker answers /mcp before the SPA shell");
  c.check(!wrangler.includes("/agent-clients"), "client downloads are static assets, not a worker route");
  const workerSrcIndex = readFileSync("worker/index.ts", "utf8");
  c.check(!workerSrcIndex.includes("routeExplosiveChessMcp"), "worker does not mount the MCP session");
  c.check(workerSrcIndex.includes("No MCP server on this host."), "worker tells /mcp callers there is no MCP server");
}

c.section("copy prompts");
{
  const code = "ab12cd";
  const ws = explosiveChessWsUrl(origin, code);
  for (const locale of ["en", "zh"] as const) {
    const guest = promptHumanOpponent({
      origin,
      roomCode: code,
      playerId: "agent-human1",
      humanSeated: true,
      rules,
      locale,
    });
    const host = promptDualHost({
      origin,
      roomCode: code,
      playerId: "agent-a-host01",
      rules,
      locale,
    });
    const join = promptDualGuest({
      origin,
      roomCode: code,
      playerId: "agent-b-join01",
      rules,
      locale,
    });
    for (const [name, text] of [
      ["human", guest],
      ["host", host],
      ["guest", join],
    ] as const) {
      const label = `${locale} ${name}`;
      c.check(text.includes(`${origin}/agent-guide/explosive-chess/${locale}`), `${label} has the locale guide URL`);
      c.check(text.includes(ws), `${label} has the websocket URL`);
      c.check(text.includes(code), `${label} has the room code`);
      c.check(text.includes("your_turn"), `${label} waits for your_turn`);
      c.check(text.includes("legalActions"), `${label} plays from legalActions`);
      c.check(text.includes("game_over"), `${label} states the goal`);
      c.check(text.includes('kind "agent"'), `${label} join kind is agent`);
      c.check(text.includes('"explosive-chess"'), `${label} join names the game`);
      c.check(text.includes(`${origin}${explosiveChessClients.node}`), `${label} downloads the node client`);
      c.check(text.includes(`${origin}${explosiveChessClients.python}`), `${label} downloads the python client`);
      c.check(text.includes("--poll"), `${label} names the poll fallback`);
      c.check(text.includes("--move ROW,COL"), `${label} shows the poll move flag`);
      c.check(text.includes("stdin"), `${label} reads moves from stdin`);
      c.check(text.includes("create_room") || text.includes("join_room"), `${label} uses an interactive command`);
      c.check(!text.includes("ws-wait"), `${label} does not document the retired one-shot client`);
      c.check(text.includes("minimax"), `${label} forbids a search engine`);
      assertLocale(text, locale, label);
    }
    c.check(guest.includes("--player-id 'agent-human1'"), `${locale} human prompt uses the given playerId`);
    c.check(host.includes("--player-id 'agent-a-host01'"), `${locale} host prompt uses the given playerId`);
    c.check(join.includes("--player-id 'agent-b-join01'"), `${locale} guest prompt uses the given playerId`);
    c.check(guest.includes("set_config"), `${locale} human prompt can set_config when it is host`);
    c.check(host.includes(`"winMode":"steps"`), `${locale} host prompt sends the UI rules`);
    c.check(host.includes(`"winParam":4`), `${locale} host prompt sends winParam`);
    c.check(!join.includes("set_config"), `${locale} guest prompt does not send set_config`);
    c.check(join.includes("You are Agent B") || join.includes("你是 Agent B"), `${locale} guest prompt names B`);
  }
  c.check(
    explosiveChessWsUrl("http://127.0.0.1:8787", "Ab12CD") === "ws://127.0.0.1:8787/ws/explosive-chess:ab12cd",
    "local websocket lowercases the code and uses ws",
  );
  let threw = false;
  try {
    promptHumanOpponent({ origin, roomCode: "  ", playerId: "x", humanSeated: false, rules, locale: "en" });
  } catch {
    threw = true;
  }
  c.check(threw, "empty room code is rejected");
  c.check(/^agent-[a-z0-9]{8}$/.test(freshAgentId("agent")), "fresh id shape");
  c.check(freshAgentId("Agent A") !== freshAgentId("Agent A"), "fresh ids differ");
}

c.section("setup invite");
{
  const invite = promptInviteAgent(origin, "en");
  const inviteZh = promptInviteAgent(origin, "zh");
  c.check(invite.includes(`${origin}/agent-guide/explosive-chess/en`), "english invite uses the english guide URL");
  c.check(inviteZh.includes(`${origin}/agent-guide/explosive-chess/zh`), "chinese invite uses the chinese guide URL");
  c.check(invite.includes("Play against me"), "invite asks about playing the human");
  c.check(invite.includes("Should I create a room?"), "invite asks who creates the room");
  c.check(invite.includes("do you already have a room code?"), "invite asks for an existing room code");
  c.check(inviteZh.includes("要和我对下吗"), "invite asks in Chinese");
  c.check(inviteZh.includes("需要我建房吗"), "invite asks about creating a room in Chinese");
  c.check(inviteZh.includes("已经有房间码"), "invite asks for a room code in Chinese");
  c.check(invite.includes("There is no MCP."), "english invite says no MCP");
  c.check(inviteZh.includes("没有 MCP"), "chinese invite says no MCP");
  c.check(!invite.includes("/ws/explosive-chess:"), "invite does not prefill a room socket");
  c.check(!inviteZh.includes("/ws/explosive-chess:"), "chinese invite does not prefill a room socket");
  c.check(invite.includes(`${origin}${explosiveChessClients.node}`), "english invite downloads the node client");
  c.check(inviteZh.includes(`${origin}${explosiveChessClients.python}`), "chinese invite downloads the python client");
  c.check(invite.includes("create_room") && invite.includes("join_room"), "english invite shows both commands");
  c.check(inviteZh.includes("create_room") && inviteZh.includes("join_room"), "chinese invite shows both commands");
  c.check(invite.includes("stdin"), "english invite types moves on stdin");
  c.check(!invite.includes("ws-wait") && !inviteZh.includes("ws-wait"), "invite does not document the retired client");
  c.check(invite.includes("Do not write a solver"), "english invite forbids a solver");
  c.check(inviteZh.includes("不要编写求解器"), "chinese invite forbids a solver");
  assertLocale(invite, "en", "invite");
  assertLocale(inviteZh, "zh", "invite");
  const local = promptInviteAgent("http://127.0.0.1:8787", "en");
  c.check(
    local.includes("http://127.0.0.1:8787/agent-guide/explosive-chess/en"),
    "local invite uses the page origin",
  );
  c.check(!local.includes(origin), "local invite does not leak another host");

  const home = readFileSync("src/pages/HomePage.tsx", "utf8");
  c.check(!home.includes("AgentInvite") && !home.includes("agentInviteLine"), "catalog home has no invite");
  c.check(!home.includes("promptInviteAgent") && !home.includes("HomeAgentInvite"), "catalog home does not copy a prompt");
  const setup = readFileSync("src/games/explosive-chess/ExplosiveChessSetup.tsx", "utf8");
  c.check(setup.includes("AgentInvite"), "setup page renders the invite");
  c.check(setup.includes("agentInviteLine"), "setup page shows the one sentence");
  c.check(!setup.includes("agentInviteCopy"), "setup page has no separate copy label");
  const headingAt = setup.indexOf("ex.setupTitle");
  const inviteAt = setup.indexOf("<AgentInvite");
  const panelCloseAt = setup.indexOf("</div>", inviteAt);
  c.check(headingAt >= 0 && inviteAt > headingAt, "invite sits under the match setup heading");
  c.check(panelCloseAt > inviteAt, "invite is inside the match setup panel");
  c.check(!setup.includes("AgentHandoff") && !setup.includes("invite-agent"), "complex handoff UI stays removed");
  const inviteUi = readFileSync("src/games/explosive-chess/AgentInvite.tsx", "utf8");
  c.check(!inviteUi.includes("<pre") && !inviteUi.includes("<textarea") && !inviteUi.includes("explosive-agent-prompt"), "prompt body is not shown");
  c.check(!inviteUi.includes("copyLabel"), "invite has no separate copy button");
  c.check(inviteUi.includes("promptInviteAgent"), "click copies the handoff prompt");
  c.check(inviteUi.includes("promptInviteAgent(origin, locale)"), "click copies the prompt for the current locale");
  c.check(setup.includes("locale={locale}"), "setup page passes the UI locale");
  const game = readFileSync("src/games/explosive-chess/ExplosiveChessGame.tsx", "utf8");
  c.check(game.includes("const { locale, t } = useLocale();"), "game reads the UI locale");
  c.check(game.includes("locale={locale}"), "game passes locale into setup");
  const inviteCss = readFileSync("src/games/explosive-chess/explosive-chess.css", "utf8");
  c.check(!inviteCss.includes("explosive-agent-prompt"), "prompt preview style is removed");
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
  c.check(explosiveZh.agentInviteLine === "点我，把内容发给 AI 陪你一起玩吧", "chinese one-liner");
  c.check(explosiveEn.agentInviteLine.length > 0 && !explosiveEn.agentInviteLine.includes("\n"), "english one-liner");
  c.check(!("agentInviteCopy" in explosiveEn) && !("agentInviteCopy" in explosiveZh), "no separate copy button label");
  for (const gone of ["agentHandoffTitle", "copyForAgent", "copyAgentA", "dualTitle", "copyWsOnly"]) {
    c.check(!(gone in explosiveEn) && !(gone in explosiveZh), `${gone} removed`);
  }
}

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const CLIENT_DIR = "public/agent-clients/explosive-chess";

function encodeTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const len = payload.length;
  let header: Buffer;
  if (len < 126) header = Buffer.from([0x81, len]);
  else if (len < 65536) header = Buffer.from([0x81, 126, (len >> 8) & 0xff, len & 0xff]);
  else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function decodeFrames(buf: Buffer): { frames: string[]; rest: Buffer } {
  const frames: string[] = [];
  let offset = 0;
  while (offset + 2 <= buf.length) {
    const b0 = buf[offset] ?? 0;
    const b1 = buf[offset + 1] ?? 0;
    const opcode = b0 & 0x0f;
    let len = b1 & 0x7f;
    let pos = offset + 2;
    if (len === 126) {
      if (pos + 2 > buf.length) break;
      len = buf.readUInt16BE(pos);
      pos += 2;
    } else if (len === 127) {
      if (pos + 8 > buf.length) break;
      len = Number(buf.readBigUInt64BE(pos));
      pos += 8;
    }
    const masked = (b1 & 0x80) !== 0;
    const maskLen = masked ? 4 : 0;
    if (pos + maskLen + len > buf.length) break;
    const raw = buf.subarray(pos + maskLen, pos + maskLen + len);
    const payload = Buffer.alloc(len);
    if (masked) {
      const mask = buf.subarray(pos, pos + 4);
      for (let i = 0; i < len; i += 1) payload[i] = (raw[i] ?? 0) ^ (mask[i % 4] ?? 0);
    } else {
      raw.copy(payload);
    }
    offset = pos + maskLen + len;
    if (opcode === 0x1) frames.push(payload.toString("utf8"));
  }
  return { frames, rest: Buffer.from(buf.subarray(offset)) };
}

type Inbound = { type?: string; payload?: { row?: number; col?: number; playerId?: string; kind?: string } };

function runClient(command: string, args: string[], timeoutMs = 8000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`client hung\n${stderr}\n${stdout}`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function listenMock(onMessage: (msg: Inbound, send: (obj: unknown) => void, path: string) => void): Promise<{ port: number; inbound: Inbound[]; paths: string[]; close: () => Promise<void> }> {
  const inbound: Inbound[] = [];
  const paths: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer();
  server.on("connection", (sock) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    sock.on("error", () => {});
  });
  server.on("upgrade", (req: IncomingMessage, socket) => {
    const path = req.url || "";
    paths.push(path);
    const keyHeader = req.headers["sec-websocket-key"];
    const key = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    let buf = Buffer.alloc(0);
    const send = (obj: unknown) => {
      try {
        socket.write(encodeTextFrame(JSON.stringify(obj)));
      } catch {
        /* closed */
      }
    };
    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const decoded = decodeFrames(buf);
      buf = decoded.rest;
      for (const text of decoded.frames) {
        let msg: Inbound;
        try {
          msg = JSON.parse(text) as Inbound;
        } catch {
          continue;
        }
        inbound.push(msg);
        try {
          onMessage(msg, send, path);
        } catch (err) {
          console.error(err);
        }
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        port,
        inbound,
        paths,
        close: () =>
          new Promise((done) => {
            for (const sock of sockets) sock.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

const seat = {
  playerId: "agent-1",
  name: "Agent",
  seat: "blue",
  role: "guest",
  kind: "agent",
  color: "blue",
};

function joinedMessage(role: "guest" | "host" = "guest") {
  return {
    type: "joined",
    payload: {
      roomCode: "abc",
      phase: "lobby",
      reclaimed: false,
      you: { ...seat, role, seat: role === "host" ? "red" : "blue", color: role === "host" ? "red" : "blue" },
    },
  };
}

function yourTurnMessage(actions = [
  { type: "move", row: 1, col: 1 },
  { type: "move", row: 4, col: 5 },
]) {
  return {
    type: "your_turn",
    payload: {
      observation: {
        phase: "playing",
        you: seat,
        publicState: { turn: "blue", fullState: { gameOver: false }, board: [] },
        legalActions: actions,
      },
    },
  };
}

type EventLine = {
  event?: string;
  ok?: boolean;
  error?: string;
  legalActions?: Array<{ row?: number; col?: number }>;
  yourTurn?: boolean;
  lastOpponentMove?: { row?: number; col?: number } | null;
  mode?: string;
  roomCode?: string;
  board?: unknown;
  result?: { winnerColor?: string };
};

function startSession(command: string, args: string[]) {
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  const lines: EventLine[] = [];
  let exited = false;
  let exitCode: number | null = null;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    const parts = stdout.split("\n");
    stdout = parts.pop() ?? "";
    for (const part of parts) {
      if (!part.trim()) continue;
      lines.push(JSON.parse(part) as EventLine);
    }
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exitP = new Promise<{ code: number | null }>((resolve) => {
    child.on("close", (code) => {
      exited = true;
      exitCode = code;
      resolve({ code });
    });
  });
  return {
    lines,
    stderr: () => stderr,
    exited: () => exited,
    write(text: string) {
      child.stdin.write(text.endsWith("\n") ? text : `${text}\n`);
    },
    async waitFor(pred: (rows: EventLine[]) => boolean, ms = 4000) {
      const start = Date.now();
      while (Date.now() - start < ms) {
        if (pred(lines)) return;
        if (exited) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      if (!pred(lines)) {
        throw new Error(`timed out waiting\nstderr=${stderr}\nlines=${JSON.stringify(lines)}\nexit=${String(exitCode)}`);
      }
    },
    untilExit(ms = 4000) {
      return Promise.race([
        exitP,
        new Promise<{ code: number | null }>((_resolve, reject) => {
          setTimeout(() => reject(new Error(`no exit\n${stderr}\n${JSON.stringify(lines)}`)), ms);
        }),
      ]);
    },
    async close() {
      if (!exited) child.kill("SIGKILL");
      return exitP;
    },
  };
}

c.section("official clients");
{
  const nodeSrc = readFileSync(`${CLIENT_DIR}/cli.mjs`);
  const pySrc = readFileSync(`${CLIENT_DIR}/cli.py`);
  let legacy = false;
  try {
    readFileSync(`${CLIENT_DIR}/ws-wait.mjs`);
    legacy = true;
  } catch {
    legacy = false;
  }
  c.check(!legacy, "retired one-shot client is not shipped");
  for (const [name, src] of [
    ["node", nodeSrc.toString("utf8")],
    ["python", pySrc.toString("utf8")],
  ] as const) {
    c.check(src.includes("create_room") && src.includes("join_room"), `${name} has create_room and join_room`);
    c.check(src.includes("kind") && src.includes('"agent"'), `${name} joins as kind agent`);
    c.check(!src.includes("minimax") && !src.includes("mcts") && !src.includes("Math.random"), `${name} has no move search`);
    c.check(!src.includes("legalActions[0]") && !src.includes("random.choice"), `${name} does not pick a legal action`);
    c.check(!src.includes("from websockets") && !src.includes('require("ws")'), `${name} has no third-party websocket package`);
  }
  c.check(pySrc.toString("utf8").includes("hashlib"), "python client speaks websocket with the standard library");

  const nodeHelp = await runClient(process.execPath, [`${CLIENT_DIR}/cli.mjs`, "--help"]);
  c.check(nodeHelp.code === 0 && nodeHelp.stdout.includes("no chess strength"), "node help");
  c.check(nodeHelp.stdout.includes("create_room") && nodeHelp.stdout.includes("join_room"), "node help shows the commands");
  const pyHelp = await runClient("python3", [`${CLIENT_DIR}/cli.py`, "--help"]);
  c.check(pyHelp.code === 0 && pyHelp.stdout.includes("no chess strength"), "python help");
  const nodeUsage = await runClient(process.execPath, [`${CLIENT_DIR}/cli.mjs`, "--player-id", "agent-1"]);
  const nodeUsageJson = JSON.parse(nodeUsage.stdout) as { ok?: boolean; error?: string };
  c.check(nodeUsage.code === 1 && nodeUsageJson.ok === false && (nodeUsageJson.error ?? "").includes("create_room"), "node usage error is json");
  const nodeJoin = await runClient(process.execPath, [`${CLIENT_DIR}/cli.mjs`, "--origin", "http://127.0.0.1:9", "join_room"]);
  const nodeJoinJson = JSON.parse(nodeJoin.stdout) as { error?: string };
  c.check(nodeJoin.code === 1 && (nodeJoinJson.error ?? "").includes("-c"), "join_room requires a code");
  const nodeMove = await runClient(process.execPath, [
    `${CLIENT_DIR}/cli.mjs`,
    "--origin",
    "http://127.0.0.1:9",
    "--move",
    "1,1",
    "join_room",
    "-c",
    "abc",
  ]);
  const nodeMoveJson = JSON.parse(nodeMove.stdout) as { error?: string };
  c.check(nodeMove.code === 1 && (nodeMoveJson.error ?? "").includes("--poll"), "interactive client rejects a one-shot --move");

  const base = (port: number) => ["--origin", `http://127.0.0.1:${port}`, "--player-id", "agent-1", "--name", "Agent", "--timeout", "5"];

  {
    const mock = await listenMock((msg, send) => {
      if (msg.type === "join") {
        send(joinedMessage());
        send(yourTurnMessage());
      }
      if (msg.type === "move" && msg.payload?.row === 1) {
        send({
          type: "move_applied",
          payload: { action: { type: "move", row: 1, col: 1 }, by: { playerId: "agent-1" }, gameOver: false },
        });
        setTimeout(() => {
          send({
            type: "move_applied",
            payload: { action: { type: "move", row: 2, col: 3 }, by: { playerId: "human-1" }, gameOver: false },
          });
          send(yourTurnMessage([{ type: "move", row: 0, col: 2 }]));
        }, 200);
      }
      if (msg.type === "move" && msg.payload?.row === 0) {
        send({ type: "game_over", payload: { winner: 2, winnerColor: "blue", winReason: "steps" } });
      }
    });
    const session = startSession(process.execPath, [`${CLIENT_DIR}/cli.mjs`, ...base(mock.port), "join_room", "-c", "abc"]);
    try {
      await session.waitFor((rows) => rows.some((row) => row.event === "your_turn"));
      const first = session.lines.find((row) => row.event === "your_turn");
      c.check(session.lines[0]?.event === "joined", "node prints joined before the turn");
      c.check(first != null && !("board" in first), "node your_turn omits the board");
      c.check((first?.legalActions ?? []).length === 2, "node copies every legal action");
      c.check(mock.inbound.every((msg) => msg.type !== "move"), "node does not send a move before stdin");
      c.check(mock.inbound.some((msg) => msg.payload?.kind === "agent"), "node join kind is agent");
      c.check(!session.exited(), "node stays up after your_turn");
      const started = Date.now();
      session.write("1,1");
      await session.waitFor((rows) => rows.filter((row) => row.event === "your_turn").length >= 2);
      c.check(Date.now() - started >= 150, "node blocked until the opponent push");
      const opponent = session.lines.find((row) => row.event === "opponent");
      c.check(opponent?.lastOpponentMove?.row === 2 && opponent.lastOpponentMove?.col === 3, "node prints the opponent update");
      session.write('{"row":0,"col":2}');
      const done = await session.untilExit();
      const over = session.lines.find((row) => row.event === "game_over");
      c.check(done.code === 0 && over?.result?.winnerColor === "blue", "node exits only on game_over", session.stderr());
    } finally {
      await session.close();
      await mock.close();
    }
  }

  {
    const mock = await listenMock((msg, send) => {
      if (msg.type === "join") {
        send(joinedMessage());
        send(yourTurnMessage());
      }
      if (msg.type === "move") send({ type: "error", payload: { message: "Invalid move" } });
    });
    const session = startSession(process.execPath, [`${CLIENT_DIR}/cli.mjs`, ...base(mock.port), "join_room", "-c", "abc"]);
    try {
      await session.waitFor((rows) => rows.some((row) => row.event === "your_turn"));
      session.write("1,1");
      await session.waitFor((rows) => rows.some((row) => row.event === "error"));
      const rejected = session.lines.find((row) => row.event === "error");
      c.check((rejected?.error ?? "").includes("Invalid move"), "node surfaces a rejected move", session.stderr());
      c.check((rejected?.legalActions ?? []).length === 2, "rejected move still lists the legal actions");
      c.check(!session.exited(), "a rejected move does not end the session");
      c.check(mock.inbound.some((msg) => msg.type === "move" && msg.payload?.row === 1 && msg.payload?.col === 1), "node sends the chosen cell");
    } finally {
      await session.close();
      await mock.close();
    }
  }

  {
    const mock = await listenMock((msg, send) => {
      if (msg.type === "join") send(joinedMessage("host"));
      if (msg.type === "set_config") {
        send({ type: "room", payload: { phase: "lobby" } });
        setTimeout(() => send(yourTurnMessage()), 40);
      }
    });
    const session = startSession(process.execPath, [
      `${CLIENT_DIR}/cli.mjs`,
      ...base(mock.port),
      "--config",
      '{"boardSize":9,"winMode":"steps","winParam":4,"hostColor":"red"}',
      "create_room",
      "-c",
      "abc",
    ]);
    try {
      await session.waitFor((rows) => rows.some((row) => row.event === "your_turn"));
      c.check(mock.inbound.some((msg) => msg.type === "set_config"), "node host sends set_config");
      c.check(mock.inbound.every((msg) => msg.type !== "move"), "node host does not invent a move");
      c.check(!session.exited(), "node host stays up after config");
    } finally {
      await session.close();
      await mock.close();
    }
  }

  {
    const mock = await listenMock((msg, send) => {
      if (msg.type === "join") {
        send(joinedMessage());
        send(yourTurnMessage());
      }
    });
    const session = startSession(process.execPath, [`${CLIENT_DIR}/cli.mjs`, ...base(mock.port), "--verbose", "join_room", "-c", "abc"]);
    try {
      await session.waitFor((rows) => rows.some((row) => row.event === "your_turn"));
      const turn = session.lines.find((row) => row.event === "your_turn");
      c.check(Array.isArray(turn?.board), "verbose your_turn includes the board");
    } finally {
      await session.close();
      await mock.close();
    }
  }

  {
    const mock = await listenMock((msg, send, path) => {
      if (msg.type === "join") {
        const code = (path.split(":").pop() || "").split("?")[0];
        send({
          type: "joined",
          payload: {
            roomCode: code,
            phase: "lobby",
            reclaimed: false,
            you: { ...seat, role: "host", seat: "red", color: "red" },
          },
        });
        send(yourTurnMessage());
      }
    });
    const session = startSession(process.execPath, [`${CLIENT_DIR}/cli.mjs`, ...base(mock.port), "create_room"]);
    try {
      await session.waitFor((rows) => rows.some((row) => row.event === "joined"));
      const path = (mock.paths[0] || "").split("?")[0];
      const code = path.split(":").pop() || "";
      c.check(/^\/ws\/explosive-chess:[a-z0-9]{6}$/.test(path), "create_room without -c opens a generated code", path);
      c.check(session.lines[0]?.roomCode === code, "joined line reports that generated code");
    } finally {
      await session.close();
      await mock.close();
    }
  }

  {
    const mock = await listenMock((msg, send) => {
      if (msg.type === "join") send(joinedMessage("host"));
    });
    const session = startSession(process.execPath, [`${CLIENT_DIR}/cli.mjs`, ...base(mock.port), "create_room", "-c", "Ab12CD"]);
    try {
      await session.waitFor((rows) => rows.some((row) => row.event === "joined"));
      c.check((mock.paths[0] || "").split("?")[0] === "/ws/explosive-chess:ab12cd", "create_room -c uses that code", mock.paths[0] || "");
    } finally {
      await session.close();
      await mock.close();
    }
  }

  {
    const mock = await listenMock((msg, send) => {
      if (msg.type === "join") send(joinedMessage());
      if (msg.type === "move") {
        send({
          type: "move_applied",
          payload: { action: { type: "move", row: 0, col: 2 }, by: { playerId: "agent-1" }, gameOver: false },
        });
      }
      if (msg.type === "observe") {
        send({
          type: "observation",
          payload: {
            observation: {
              phase: "playing",
              you: seat,
              publicState: { turn: "red", fullState: { gameOver: false } },
              legalActions: [],
            },
          },
        });
      }
    });
    try {
      const result = await runClient(process.execPath, [`${CLIENT_DIR}/cli.mjs`, ...base(mock.port), "--poll", "join_room", "-c", "abc", "--move", "0,2"]);
      const json = JSON.parse(result.stdout) as { event?: string; mode?: string; yourTurn?: boolean };
      c.check(result.code === 0 && json.event === "observation" && json.mode === "poll", "node poll returns without waiting for your_turn", result.stderr);
      c.check(json.yourTurn === false, "node poll reports that it is not your turn");
      c.check(mock.inbound.some((msg) => msg.type === "observe"), "node poll sends one observe");
    } finally {
      await mock.close();
    }
  }

  {
    const mock = await listenMock((msg, send) => {
      if (msg.type === "join") {
        send(joinedMessage());
        send(yourTurnMessage());
      }
      if (msg.type === "move") {
        send({ type: "game_over", payload: { winner: 1, winnerColor: "red", winReason: "steps" } });
      }
    });
    const session = startSession("python3", [`${CLIENT_DIR}/cli.py`, ...base(mock.port), "join_room", "-c", "abc"]);
    try {
      await session.waitFor((rows) => rows.some((row) => row.event === "your_turn"));
      c.check((session.lines.find((row) => row.event === "your_turn")?.legalActions ?? []).length === 2, "python copies every legal action");
      c.check(mock.inbound.every((msg) => msg.type !== "move"), "python does not send a move before stdin");
      c.check(!session.exited(), "python stays up after your_turn");
      session.write("3,4");
      const done = await session.untilExit();
      c.check(done.code === 0 && session.lines.some((row) => row.event === "game_over"), "python exits on game_over", session.stderr());
      c.check(mock.inbound.some((msg) => msg.type === "move" && msg.payload?.row === 3 && msg.payload?.col === 4), "python sends the typed cell");
    } finally {
      await session.close();
      await mock.close();
    }
  }

  {
    const mock = await listenMock((msg, send) => {
      if (msg.type === "join") send(joinedMessage());
      if (msg.type === "move") {
        send({
          type: "move_applied",
          payload: { action: { type: "move", row: 3, col: 4 }, by: { playerId: "agent-1" }, gameOver: false },
        });
      }
      if (msg.type === "observe") {
        send({
          type: "observation",
          payload: {
            observation: {
              phase: "playing",
              you: seat,
              publicState: { turn: "red", fullState: { gameOver: false } },
              legalActions: [],
            },
          },
        });
      }
    });
    try {
      const result = await runClient("python3", [`${CLIENT_DIR}/cli.py`, ...base(mock.port), "--poll", "join_room", "-c", "abc", "--move", "3,4"]);
      const json = JSON.parse(result.stdout) as { event?: string; mode?: string; yourTurn?: boolean };
      const pyPollOk = result.code === 0 && json.event === "observation" && json.mode === "poll";
      c.check(pyPollOk, "python poll returns an observation", pyPollOk ? "" : `${result.stderr}\n${result.stdout}`);
      c.check(json.yourTurn === false, "python poll does not claim the turn");
    } finally {
      await mock.close();
    }
  }
}

c.finish();
