/**
 * Explosive-chess agent handoff: public guide negotiation and locale MCP copy.
 * Run: npm run test:explosive-handoff
 */
import { existsSync, readFileSync } from "node:fs";
import {
  agentGuideHttpResponse,
  composeAgentGuide,
  explosiveChessMcpUrl,
  explosiveChessPlayUrl,
  explosiveChessWsUrl,
  matchAgentGuidePath,
  matchExplosiveChessMcpPath,
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
    c.check(text.includes("no_update"), `${name} restacks wait_for_turn`);
    c.check(text.includes(explosiveChessMcpUrl(origin)), `${name} names the MCP url`);
    c.check(text.includes("keeps the WebSocket open"), `${name} says the MCP keeps the socket open`);
    c.check(!text.includes("ws-wait"), `${name} does not name the removed wait script`);
  } else {
    c.check(CJK.test(text), `${name} chinese has CJK`);
    c.check(!text.includes("Should I create a room?"), `${name} chinese has no english invite question`);
    c.check(!text.includes("You are an explosive-chess agent."), `${name} chinese does not use the english intro`);
    c.check(text.includes("no_update"), `${name} restacks wait_for_turn`);
    c.check(text.includes(explosiveChessMcpUrl(origin)), `${name} names the MCP url`);
    c.check(text.includes("不要断开"), `${name} says not to disconnect`);
    c.check(!text.includes("ws-wait"), `${name} does not name the removed wait script`);
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
  c.check(matchExplosiveChessMcpPath("/mcp/explosive-chess") === "stream", "mcp stream path");
  c.check(matchExplosiveChessMcpPath("/mcp/explosive-chess/sse") === "sse", "mcp sse path");
  c.check(matchExplosiveChessMcpPath("/mcp/chroma-slide") === null, "chroma-slide has no mcp path");
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
  c.check(composed.includes(explosiveChessMcpUrl(origin)), "banner names the MCP url");
  c.check(composed.includes("https://micromist-staging.goldeneaglepersonal.dpdns.org/mcp/explosive-chess"), "guide names the staging MCP url");
  c.check(!composed.includes("/agent-clients/"), "guide does not advertise client downloads");
  c.check(!composed.includes("ws-wait"), "guide does not name the removed wait script");
  c.check(!composed.includes("There is no MCP"), "guide no longer says there is no MCP");
  c.check(composed.includes("your_turn"), "protocol your_turn kept");
  c.check(composed.includes("legalActions"), "protocol legalActions kept");
  c.check(composed.includes("Keep that socket open"), "guide says the socket must stay open");
  c.check(composed.includes("Leave the MCP session connected"), "guide says the host waits connected");
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
  c.check(composedZh.includes("没有棋力"), "chinese guide says the server has no chess strength");
  c.check(composedZh.includes(explosiveChessMcpUrl(origin)), "chinese banner names the MCP url");
  c.check(!composedZh.includes("/agent-clients/"), "chinese guide does not advertise client downloads");
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
    "Ready is disabled",
    "Needs Node 22+",
    "wait_for_turn",
    origin,
    explosiveChessMcpUrl(origin),
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
  c.check(wrangler.includes('"/mcp/*"'), "worker runs before the SPA for MCP");
  c.check(wrangler.includes("ExplosiveChessMcp"), "wrangler binds the MCP session object");
  c.check(!wrangler.includes("/agent-clients"), "removed client downloads are not a worker route");
  const workerSrcIndex = readFileSync("worker/index.ts", "utf8");
  c.check(workerSrcIndex.includes("routeExplosiveChessMcp"), "worker routes the MCP facade");
  c.check(workerSrcIndex.includes("export { GameRoom, ExplosiveChessMcp }"), "worker exports the MCP session class");
}

c.section("copy prompts");
{
  const code = "ab12cd";
  const play = explosiveChessPlayUrl(origin, code);
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
      c.check(text.includes(explosiveChessMcpUrl(origin)), `${label} names the MCP url`);
      c.check(!text.includes("/ws/explosive-chess:"), `${label} does not hand out a room socket`);
      c.check(!text.includes("ws-wait") && !text.includes("/agent-clients/"), `${label} has no client download`);
      c.check(text.includes(play), `${label} has the human play URL`);
      c.check(text.includes(code), `${label} has the room code`);
      c.check(text.includes("your_turn"), `${label} waits for your_turn`);
      c.check(text.includes("legalActions"), `${label} plays from legalActions`);
      c.check(text.includes("game_over"), `${label} states the goal`);
      c.check(text.includes('kind "agent"'), `${label} join kind is agent`);
      c.check(text.includes('"explosive-chess"'), `${label} join names the game`);
      c.check(text.includes("take_turn"), `${label} names take_turn`);
      c.check(text.includes("minimax"), `${label} forbids a search engine`);
      assertLocale(text, locale, label);
    }
    c.check(guest.includes("playerId：agent-human1") || guest.includes("playerId: agent-human1"), `${locale} human prompt uses the given playerId`);
    c.check(host.includes("playerId：agent-a-host01") || host.includes("playerId: agent-a-host01"), `${locale} host prompt uses the given playerId`);
    c.check(join.includes("playerId：agent-b-join01") || join.includes("playerId: agent-b-join01"), `${locale} guest prompt uses the given playerId`);
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
  c.check(invite.includes(explosiveChessMcpUrl(origin)), "english invite names the staging MCP url");
  c.check(inviteZh.includes(explosiveChessMcpUrl(origin)), "chinese invite names the staging MCP url");
  c.check(invite.includes("create_room"), "english invite names create_room");
  c.check(inviteZh.includes("join_room"), "chinese invite names join_room");
  c.check(!invite.includes("There is no MCP."), "english invite no longer says there is no MCP");
  c.check(!inviteZh.includes("没有 MCP"), "chinese invite no longer says there is no MCP");
  c.check(!invite.includes("/ws/explosive-chess:"), "invite does not prefill a room socket");
  c.check(!inviteZh.includes("/ws/explosive-chess:"), "chinese invite does not prefill a room socket");
  c.check(!invite.includes("ws-wait") && !inviteZh.includes("/agent-clients/"), "invites do not download clients");
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


c.section("client downloads removed");
{
  for (const file of [
    "public/agent-clients/explosive-chess/ws-wait.mjs",
    "public/agent-clients/explosive-chess/ws-poll.mjs",
    "public/agent-clients/explosive-chess/ws_wait.py",
    "public/agent-clients/explosive-chess/ws_poll.py",
  ]) {
    c.check(!existsSync(file), `${file} is removed`);
  }
  const docs = readFileSync("docs/agent-ws-explosive-chess.md", "utf8") + readFileSync("docs/agent-ws-explosive-chess.zh.md", "utf8");
  c.check(!docs.includes("ws-wait") && !docs.includes("ws_wait") && !docs.includes("/agent-clients/"), "docs do not publish client downloads");
  c.check(docs.includes("/mcp/explosive-chess"), "docs name the MCP path");
}

c.finish();
