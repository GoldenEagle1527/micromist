/**
 * The staging debug panel (src/games/deep-march/debug, replaces the URL debug switches):
 *   - teleports (debug/teleport.ts): safe placement, targets, on real terrain;
 *   - the command registry: ids, sections, availability (loading / free dive),
 *     restart commands edit only the draft, runtime commands go through the port;
 *   - every old URL switch has its panel command; the session overrides store;
 *   - no URL parameter is read in the game any more; debug/ files ≤ 200 lines.
 * Run: npm run test:debug
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DEBUG_COMMANDS } from "../src/games/deep-march/debug/commands";
import { debugEn } from "../src/games/deep-march/debug/i18n";
import { SECTIONS, pendingKeys, stepValue, visibleCommands, type DebugCommand, type DebugCtx } from "../src/games/deep-march/debug/registry";
import type { DebugPort, Pose } from "../src/games/deep-march/debug/types";
import { DEFAULT_DIVE_PARAMS, diveParams, setDiveParams, type DiveParams } from "../src/games/deep-march/scene/dive/params";
import { createChecker } from "./lib/checks";
import { syntheticTeleportChecks, terrainTeleportChecks } from "./lib/debugTeleportChecks";

const c = createChecker();
syntheticTeleportChecks(c);
terrainTeleportChecks(c);

/** A port that records what the panel asked of the dive. */
function fakePort(log: string[]): DebugPort {
  let light: "off" | "beam" | "high" = "beam", markers = false, observe = false;
  return {
    conserve: true,
    targets: () => [{ kind: "crack", key: "1", pose: () => ({ x: 1, y: 2, z: 3, yaw: 0, pitch: 0 }) }],
    teleport: (p: Pose) => (log.push(`tp ${p.x},${p.y},${p.z}`), { ...p, y: p.y + 5 }),
    position: () => ({ x: 10.4, y: -3.6, z: 7 }),
    light: () => light,
    lightChoices: () => ["off", "beam", "high"],
    setLight: (m) => void (light = m),
    ping: () => void log.push("ping"),
    observe: () => observe,
    setObserve: (on) => void (observe = on),
    forgetScans: () => void log.push("forget"),
    markers: () => markers,
    setMarkers: (on) => void (markers = on),
    fillBattery: () => void log.push("battery"),
  };
}

function ctxOf(port: DebugPort | null, conserve: boolean): DebugCtx & { draft: DiveParams } {
  const ctx = {
    port,
    conserve,
    draft: { ...DEFAULT_DIVE_PARAMS } as DiveParams,
    setDraft: (p: Partial<DiveParams>) => void (ctx.draft = { ...ctx.draft, ...p }),
    custom: { x: 0, y: 0, z: 0 },
    setCustom: (p: Partial<{ x: number; y: number; z: number }>) => void (ctx.custom = { ...ctx.custom, ...p }),
  };
  return ctx;
}
const byId = (id: string) => DEBUG_COMMANDS.find((k) => k.id === id) as DebugCommand;

c.section("command registry");
{
  const ids = DEBUG_COMMANDS.map((k) => k.id);
  c.check(new Set(ids).size === ids.length && ids.every((id) => SECTIONS.includes(id.split(".")[0] as never)), "unique ids, prefixed by their section", `${ids.length} commands`);
  c.check(DEBUG_COMMANDS.every((k) => debugEn.cmd[k.label] !== undefined) && SECTIONS.every((s) => DEBUG_COMMANDS.some((k) => k.section === s)), "every label in the dictionary, every section has commands");
  const loading = SECTIONS.flatMap((s) => visibleCommands(DEBUG_COMMANDS, s, ctxOf(null, true)));
  c.check(loading.length > 0 && loading.every((k) => k.restart), "dive still loading: only the restart commands show");
  const free = SECTIONS.flatMap((s) => visibleCommands(DEBUG_COMMANDS, s, ctxOf(fakePort([]), false)));
  c.check(!free.some((k) => k.section === "chaos" || k.section === "tide"), "free dive: no chaos preview, no tide");
}

c.section("restart commands edit the draft only");
{
  const ctx = ctxOf(null, true);
  const set = (id: string, v: string | boolean) => {
    const k = byId(id);
    if (k.kind === "choice") k.set(ctx, v as string);
    else if (k.kind === "toggle") k.set(ctx, v as boolean);
  };
  set("render.ktx2", false);
  set("render.dpr", "0.75");
  set("render.wasm", "wasm");
  set("chaos.stage", "2");
  set("chaos.cracks", "2");
  set("chaos.scar", true);
  set("audio.on", false);
  set("tide.simple", true);
  const d = ctx.draft;
  c.check(d.webp && d.dpr === 0.75 && d.wasm === true && d.noAudio && d.tideSimple && JSON.stringify(d.chaos) === '{"stage":2,"cracks":2,"scar":true}', "KTX2 off → webp, 0.75×, WASM, stage 2 with 2 cracks + scar, sound off, simple tide");
  c.check(pendingKeys(d, DEFAULT_DIVE_PARAMS).sort().join() === "chaos,dpr,noAudio,tideSimple,wasm,webp", "pending restart lists exactly those overrides", pendingKeys(d, DEFAULT_DIVE_PARAMS).join());
  c.check(diveParams() === DEFAULT_DIVE_PARAMS, "the running dive's overrides stay untouched until the restart");
  set("chaos.stage", "");
  set("render.wasm", "");
  c.check(d !== ctx.draft && ctx.draft.chaos === null && ctx.draft.wasm === undefined, "'this generation' / 'default' clear the override");
  setDiveParams(ctx.draft);
  c.check(diveParams().webp && pendingKeys(ctx.draft, diveParams()).length === 0 && DEFAULT_DIVE_PARAMS.webp === false, "restart applies the draft (session store); defaults stay frozen");
  setDiveParams({ ...DEFAULT_DIVE_PARAMS });
}

c.section("runtime commands go through the port");
{
  const log: string[] = [];
  const ctx = ctxOf(fakePort(log), true);
  const k = byId("teleport.targets");
  if (k.kind === "targets") k.go(ctx, k.items(ctx)[0]);
  const here = byId("teleport.custom.here");
  if (here.kind === "action") here.apply(ctx);
  const x = byId("teleport.custom.x");
  if (x.kind === "stepper") x.set(ctx, stepValue(x, x.get(ctx), 100));
  const go = byId("teleport.custom.go");
  if (go.kind === "action") go.apply(ctx);
  const light = byId("light.mode");
  if (light.kind === "choice") light.set(ctx, "off");
  const ping = byId("light.ping");
  if (ping.kind === "action") ping.apply(ctx);
  const obs = byId("light.observe");
  if (obs.kind === "toggle") obs.set(ctx, true);
  const forget = byId("light.forgetScans");
  if (forget.kind === "action") forget.apply(ctx);
  const bat = byId("resources.battery");
  if (bat.kind === "action") bat.apply(ctx);
  const mk = byId("overlay.markers");
  if (mk.kind === "toggle") mk.set(ctx, true);
  c.check(log.join(" | ") === "tp 1,2,3 | tp 110,-4,7 | ping | forget | battery", "crack teleport, current position + 100 m east, a free ping, forget the scans, battery", log.join(" | "));
  c.check(ctx.custom.y === 1 && ctx.port!.light() === "off" && ctx.port!.observe() && ctx.port!.markers() && JSON.stringify(ctx.draft) === JSON.stringify(DEFAULT_DIVE_PARAMS), "custom y follows the safe placement; light off; observation on; markers on; the draft untouched");
  c.check(light.kind === "choice" && light.options(ctx).map((o) => o.value).join() === "off,beam,high", "light choices: off + the gear's modes");
  c.check(x.kind === "stepper" && stepValue(x, 5990, 100) === x.max && stepValue(x, -5990, -100) === x.min, "steppers clamp to their range");
}

c.section("every old URL switch has a panel command");
{
  const LEGACY: Record<string, string> = {
    "?chaos=": "chaos.stage", "&cracks=": "chaos.cracks", "&scar=": "chaos.scar", "?at=x,y,z": "teleport.custom.go", "?at=crack": "teleport.targets",
    "?light=": "light.mode", "?tide=simple": "tide.simple", "?ktx2=0": "render.ktx2", "?audio=0": "audio.on", "?dpr=": "render.dpr", "?lodNear=": "render.lodNear",
    "?refine=0": "render.refine", "?bricks=0": "render.bricks", "?wasm=": "render.wasm", "?fog=": "render.fog", "?detail=0": "render.detail", "?occ=0": "render.occlusion", "?debugSpawns=1": "overlay.markers",
  };
  const missing = Object.entries(LEGACY).filter(([, id]) => !byId(id)).map(([q]) => q);
  c.check(missing.length === 0, `${Object.keys(LEGACY).length} switches mapped`, missing.join(", ") || "all present");
}

c.section("source");
{
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : /\.(ts|tsx)$/.test(n) ? [join(dir, n)] : []));
  const game = files("src/games/deep-march");
  const reads = game.filter((f) => /URLSearchParams|location\.search|searchParams/.test(readFileSync(f, "utf8")));
  c.check(reads.length === 0, "the game reads no URL parameter", reads.join(", ") || `${game.length} files`);
  const long = files("src/games/deep-march/debug").map((f) => [f, readFileSync(f, "utf8").split("\n").length] as const).filter(([, n]) => n > 200);
  c.check(long.length === 0, "every debug/ file ≤ 200 lines", long.map(([f, n]) => `${f} ${n}`).join(", ") || "ok");
}
c.finish();
