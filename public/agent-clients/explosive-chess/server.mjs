#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dest = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server.mjs");
const child = spawn(process.execPath, [dest, "--game", "explosive-chess", ...process.argv.slice(2)], {
  stdio: "inherit",
});
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
