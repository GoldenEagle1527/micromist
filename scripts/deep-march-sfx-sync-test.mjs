/**
 * scripts/sfx-sync.mjs tests on synthetic WAVs (generated sine tones — the real
 * sound pack is licensed and never used here):
 * - Opus WebM + AAC M4A, hashed names, manifest (frames, bytes, priming / padding);
 * - deterministic: a clean re-encode gives identical names and bytes;
 * - codec delays match what a decoder sees (trimmed / untrimmed lengths);
 * - never fails: missing masters, no ffmpeg, no masters at all only warn;
 * - output dir hygiene: stale files removed, a master kept only there left alone;
 * - repo guard: no audio file or manifest is tracked by git, the output dir is ignored.
 * Run: npm run test:sfx
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLIPS = Object.keys(JSON.parse(readFileSync(join(ROOT, "src/games/deep-march/scene/sfxClips.json"), "utf8")).clips);
let fails = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${msg}`);
  if (!ok) fails++;
};
const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

const tmp = mkdtempSync(join(tmpdir(), "dm-sfx-"));
const masters = join(tmp, "masters");
const out = join(tmp, "out");
mkdirSync(masters);

/** 16-bit PCM WAV of a sine tone (mono or stereo). */
function sineWav(file, seconds, hz, channels = 1, rate = 22050) {
  const frames = Math.round(seconds * rate);
  const data = Buffer.alloc(frames * channels * 2);
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 12000), (i * channels + c) * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * channels * 2, 28);
  h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([h, data]));
  return frames;
}
const FRAMES = {};
CLIPS.forEach((id, k) => (FRAMES[id] = sineWav(join(masters, `${id}.wav`), id === "ambience" ? 2.5 : 0.3 + 0.1 * k, 220 + 50 * k, id === "sonar" ? 2 : 1)));

function sync(env = {}) {
  const r = spawnSync(process.execPath, [join(ROOT, "scripts/sfx-sync.mjs")], { env: { ...process.env, MICROMIST_PRIVATE_SFX: masters, SFX_OUT: out, ...env }, encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}
const manifest = () => JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
const snapshot = () => Object.fromEntries(readdirSync(out).sort().map((f) => [f, readFileSync(join(out, f)).toString("base64")]));

console.log(`sfx-sync (ffmpeg ${hasFfmpeg ? "available" : "MISSING — encode checks skipped"})`);
if (hasFfmpeg) {
  const r = sync();
  check(r.code === 0, `runs cleanly (${r.out.trim().split("\n").pop()})`);
  const m = manifest();
  check(m.version === 1 && CLIPS.every((id) => m.clips[id]), "manifest lists every clip");
  const names = readdirSync(out);
  check(CLIPS.every((id) => /^[\w]+\.[0-9a-f]{10}\.webm$/.test(m.clips[id].files.webm.file) && /\.[0-9a-f]{10}\.m4a$/.test(m.clips[id].files.m4a.file)), "hashed names: <id>.<10 hex>.webm / .m4a");
  check(!names.some((f) => f.endsWith(".wav")), "no WAV shipped when encoding works");
  check(CLIPS.every((id) => Object.values(m.clips[id].files).every((f) => statSync(join(out, f.file)).size === f.bytes)), "manifest bytes = file sizes");
  check(CLIPS.every((id) => m.clips[id].frames === FRAMES[id] && m.clips[id].sampleRate === 22050), "source frame counts + rate recorded");
  check(m.clips.ambience.loop === true && m.clips.bump.loop === false && m.clips.sonar.channels === 2, "loop flags and channels from the clip list / WAV");
  // decoder view: trimmed = source + padding (± a frame); raw = + priming
  const frames = (file, rate, raw) => {
    const pre = raw ? (file.endsWith(".m4a") ? ["-ignore_editlist", "1"] : ["-flags2", "+skip_manual"]) : [];
    return spawnSync("ffmpeg", ["-v", "error", ...pre, "-i", file, "-f", "s16le", "-ac", "1", "-ar", String(rate), "-"], { maxBuffer: 64 << 20 }).stdout.length / 2;
  };
  const amb = m.clips.ambience;
  for (const [fmt, rate] of [["m4a", 44100], ["webm", 48000]]) {
    const f = amb.files[fmt];
    const src = amb.frames / amb.sampleRate;
    const raw = frames(join(out, f.file), rate, true) / rate;
    check(f.priming > 0 && Math.abs(raw - (src + f.priming + f.padding)) < 2 / rate, `${fmt}: untrimmed length = source + priming + padding (${(f.priming * 1000).toFixed(2)} + ${(f.padding * 1000).toFixed(2)} ms)`);
  }
  const trimmed = frames(join(out, amb.files.m4a.file), 44100, false) / 44100;
  check(Math.abs(trimmed - (amb.frames / amb.sampleRate + amb.files.m4a.padding)) < 2 / 44100, "m4a: edit-list-trimmed length = source + padding");
  // deterministic: same names and bytes from the cache and from a clean encode
  const first = snapshot();
  sync();
  const second = snapshot();
  rmSync(join(masters, "enc"), { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
  sync();
  const third = snapshot();
  check(JSON.stringify(first) === JSON.stringify(second), "re-run from cache: identical output");
  check(JSON.stringify(first) === JSON.stringify(third), "clean re-encode: identical names and bytes (bit-exact)");
  // a changed master gets a new name; the stale file is removed
  const oldName = manifest().clips.bump.files.webm.file;
  sineWav(join(masters, "bump.wav"), 0.5, 900);
  sync();
  const newName = manifest().clips.bump.files.webm.file;
  check(newName !== oldName && existsSync(join(out, newName)) && !existsSync(join(out, oldName)), "changed master → new hashed name, stale file removed");
  // a master that only lives in the output dir is used and kept (earlier setups)
  rmSync(join(masters, "warn.wav"));
  sineWav(join(out, "warn.wav"), 0.4, 700);
  const legacy = sync();
  check(legacy.code === 0 && /move it/.test(legacy.out) && manifest().clips.warn && existsSync(join(out, "warn.wav")), "master only in the output dir: used, warned, kept");
  rmSync(join(out, "warn.wav"));
  // missing master: warning, clip left out, no failure
  const miss = sync();
  check(miss.code === 0 && /missing \(warn\.wav\)/.test(miss.out) && !manifest().clips.warn && manifest().clips.bump, "missing master → warning, clip omitted, exit 0");
  sineWav(join(masters, "warn.wav"), 0.4, 700);
}
// no ffmpeg: ship the WAV masters
{
  rmSync(out, { recursive: true, force: true });
  const r = sync({ SFX_FFMPEG: "none", SFX_FFPROBE: "none" });
  const m = manifest();
  check(r.code === 0 && /ffmpeg not found/.test(r.out), "no ffmpeg → warning, exit 0");
  check(CLIPS.every((id) => m.clips[id]?.files.wav?.file === `${id}.wav` && existsSync(join(out, `${id}.wav`))), "no ffmpeg → WAV masters shipped and listed");
}
// no masters at all: no manifest (game runs silent), exit 0
{
  const empty = join(tmp, "none");
  mkdirSync(empty);
  rmSync(out, { recursive: true, force: true });
  const r = spawnSync(process.execPath, [join(ROOT, "scripts/sfx-sync.mjs")], { env: { ...process.env, MICROMIST_PRIVATE_SFX: empty, SFX_OUT: out }, encoding: "utf8" });
  check(r.status === 0 && /7 deep-march sound master\(s\) missing/.test(r.stdout + r.stderr) && !existsSync(join(out, "manifest.json")), "no masters → warning, no manifest, exit 0");
}
// repo guard
{
  const tracked = spawnSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).stdout.split("\n");
  const audio = tracked.filter((f) => /\.(wav|webm|m4a|mp3|ogg|opus|caf|aac)$/i.test(f) || /deep-march\/sfx\//.test(f));
  check(audio.length === 0, `no audio / sfx files tracked by git${audio.length ? ` (${audio.join(", ")})` : ""}`);
  const ignored = ["manifest.json", "x.0123456789.webm", "x.0123456789.m4a", "x.wav"].every((f) => spawnSync("git", ["check-ignore", "-q", `public/deep-march/sfx/${f}`], { cwd: ROOT }).status === 0);
  check(ignored, "public/deep-march/sfx/ (manifest, webm, m4a, wav) is git-ignored");
}
rmSync(tmp, { recursive: true, force: true });

if (fails) {
  console.log(`${fails} sfx-sync check(s) FAILED`);
  process.exit(1);
}
console.log("all sfx-sync checks passed");
