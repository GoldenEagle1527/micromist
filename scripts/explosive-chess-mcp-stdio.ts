/**
 * stdio MCP process for explosive-chess.
 * Holds one room WebSocket. Default origin is staging.
 *
 *   node --experimental-strip-types scripts/explosive-chess-mcp-stdio.ts
 * does not resolve extensionless imports. Bundle it (see npm script mcp:explosive-chess)
 * or run the esbuild outfile. Example for an Agent / MCP client (stdio):
 *
 *   { "mcpServers": { "explosive-chess": { "command": "node", "args": ["node_modules/.cache/ec-mcp-stdio.mjs"], "env": { "MICROMIST_ORIGIN": "https://micromist-staging.goldeneaglepersonal.dpdns.org" } } } }
 */
import { argv, env, exit, stderr, stdin, stdout } from "node:process";
import { explosiveChessMcpTools, dispatchMcpMessage, encodeStdioMessage, stdioHelp, takeStdioMessages } from "../shared/explosive-chess/mcp-rpc";
import { connectWebSocketUrl, ExplosiveChessMcpSession } from "../shared/explosive-chess/mcp-session";

function originFromArgs(): string {
  const flag = argv.indexOf("--origin");
  const fromArg = flag >= 0 ? argv[flag + 1] : "";
  return fromArg || env.MICROMIST_ORIGIN || "https://micromist-staging.goldeneaglepersonal.dpdns.org";
}

if (argv.includes("--help") || argv.includes("-h")) {
  stderr.write(stdioHelp());
  exit(0);
}

const origin = originFromArgs();
stderr.write(
  `explosive-chess mcp stdio origin=${origin} tools=${explosiveChessMcpTools.map((tool) => tool.name).join(",")}\n`,
);

const session = new ExplosiveChessMcpSession({
  origin,
  dial: connectWebSocketUrl,
});

function writeMessage(message: unknown): void {
  stdout.write(encodeStdioMessage(message));
}

let buf = new Uint8Array(0);
let chain: Promise<void> = Promise.resolve();

function append(chunk: Uint8Array): void {
  const next = new Uint8Array(buf.length + chunk.length);
  next.set(buf, 0);
  next.set(chunk, buf.length);
  buf = next;
}

async function drain(): Promise<void> {
  for (;;) {
    const taken = takeStdioMessages(buf);
    buf = taken.rest;
    if (taken.messages.length === 0) return;
    for (const message of taken.messages) {
      const response = await dispatchMcpMessage(session, message);
      if (response) writeMessage(response);
    }
  }
}

stdin.on("data", (chunk: Uint8Array) => {
  append(chunk);
  chain = chain.then(drain, drain);
});

stdin.on("end", () => {
  session.close();
});

stdin.resume();
