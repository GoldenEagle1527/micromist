/**
 * The deep-march sound effects are a purchased, licensed pack and are not in git.
 * Runs before every build (npm run build → deploy / deploy:staging):
 *
 *   masters  $MICROMIST_PRIVATE_SFX (default /home/box/micromist-private/deep-march/sfx)
 *            <id>.wav for every clip in src/games/deep-march/scene/sfxClips.json
 *   cache    <masters>/enc/  compressed files, named by content hash
 *   output   public/deep-march/sfx/  (git-ignored, fully generated):
 *            <id>.<hash>.webm (Opus, primary), <id>.<hash>.m4a (AAC, fallback for
 *            Safari < 17.4 / Lockdown mode) and manifest.json (files, bytes, source
 *            frame counts and codec priming / padding for gapless loop points).
 *
 * Encoding needs ffmpeg (libopus + aac) and is deterministic (bit-exact flags, no
 * metadata), so rebuilding gives identical bytes and names. Without ffmpeg the WAV
 * masters are shipped instead (manifest lists them). Never fails the build: missing
 * masters or tools only warn (those sounds are then silent).
 *
 * Env (tests): MICROMIST_PRIVATE_SFX, SFX_OUT (output dir), SFX_FFMPEG / SFX_FFPROBE
 * (tool paths, "none" = pretend missing).
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLIPS = JSON.parse(readFileSync(join(ROOT, "src/games/deep-march/scene/sfxClips.json"), "utf8")).clips;
const SRC = process.env.MICROMIST_PRIVATE_SFX || "/home/box/micromist-private/deep-march/sfx";
const OUT = resolve(process.env.SFX_OUT || join(ROOT, "public/deep-march/sfx"));
const CACHE = join(SRC, "enc");
const FFMPEG = process.env.SFX_FFMPEG || "ffmpeg";
const FFPROBE = process.env.SFX_FFPROBE || "ffprobe";

/** Encoder settings per output format (part of the content hash). */
const FORMATS = {
  webm: { rate: 48000, args: (ch) => ["-c:a", "libopus", "-b:a", ch > 1 ? "64k" : "48k", "-vbr", "on", "-application", "audio"] },
  m4a: { rate: 44100, args: (ch) => ["-c:a", "aac", "-b:a", ch > 1 ? "96k" : "64k", "-movflags", "+faststart"] },
};
const BITEXACT = ["-fflags", "+bitexact", "-flags:a", "+bitexact", "-map_metadata", "-1", "-map_chapters", "-1"];
const warn = (msg) => console.warn(`\x1b[33mWARNING sfx-sync: ${msg}\x1b[0m`);

const has = (tool) => tool !== "none" && spawnSync(tool, ["-version"], { stdio: "ignore" }).status === 0;
const run = (tool, args) => {
  const r = spawnSync(tool, args, { encoding: "buffer", maxBuffer: 256 << 20 });
  if (r.status !== 0) throw new Error(`${tool} ${args.join(" ")}: ${r.stderr?.toString().trim().split("\n").pop()}`);
  return r.stdout;
};

/** RIFF/WAVE header: sample rate, channels, frame count (PCM data chunk). */
function wavInfo(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAV file");
  let off = 12, fmt = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") fmt = { channels: buf.readUInt16LE(off + 10), sampleRate: buf.readUInt32LE(off + 12), blockAlign: buf.readUInt16LE(off + 20) };
    if (id === "data" && fmt) return { ...fmt, frames: Math.floor(size / fmt.blockAlign) };
    off += 8 + size + (size & 1);
  }
  throw new Error("WAV without fmt/data chunk");
}

/** Decoded frame count of `file` (mono s16 at `rate`), with or without the container's trimming. */
function decodedFrames(file, rate, raw) {
  const pre = raw ? (file.endsWith(".m4a") ? ["-ignore_editlist", "1"] : ["-flags2", "+skip_manual"]) : [];
  return run(FFMPEG, ["-v", "error", ...pre, "-i", file, "-f", "s16le", "-ac", "1", "-ar", String(rate), "-"]).length / 2;
}

/** Codec priming (leading frames a decoder may keep) and end padding, in seconds. */
function codecDelay(file, rate, srcFrames, srcRate) {
  const raw = decodedFrames(file, rate, true);
  const trimmed = decodedFrames(file, rate, false);
  let priming = raw - trimmed;
  if (file.endsWith(".webm") && has(FFPROBE)) {
    const pad = Number(run(FFPROBE, ["-v", "error", "-show_entries", "stream=initial_padding", "-of", "csv=p=0", file]).toString().trim());
    if (pad > 0) priming = pad;
  }
  const exact = Math.round((srcFrames * rate) / srcRate);
  return { priming: priming / rate, padding: Math.max(0, raw - exact - priming) / rate };
}

function main() {
  mkdirSync(OUT, { recursive: true });
  const ids = Object.keys(CLIPS);
  const canEncode = has(FFMPEG);
  if (!canEncode) warn(`ffmpeg not found: shipping the WAV masters uncompressed (~10× larger). Install ffmpeg (libopus + aac) for Opus / AAC.`);
  const manifest = { version: 1, clips: {} };
  const keep = new Set(["manifest.json"]);
  const missing = [];
  for (const id of ids) {
    let master = join(SRC, `${id}.wav`);
    if (!existsSync(master)) {
      // earlier setups kept the masters in the output dir
      const legacy = join(OUT, `${id}.wav`);
      if (existsSync(legacy)) {
        warn(`${id}.wav found only in ${OUT}; move it to ${SRC}`);
        master = legacy;
      } else {
        missing.push(`${id}.wav`);
        continue;
      }
    }
    const wav = readFileSync(master);
    let info;
    try {
      info = wavInfo(wav);
    } catch (e) {
      warn(`${master}: ${e.message}; skipped`);
      missing.push(`${id}.wav`);
      continue;
    }
    const entry = { loop: !!CLIPS[id].loop, frames: info.frames, sampleRate: info.sampleRate, channels: info.channels, files: {} };
    if (canEncode) {
      mkdirSync(CACHE, { recursive: true });
      for (const [fmt, spec] of Object.entries(FORMATS)) {
        const args = [...spec.args(info.channels), "-ar", String(spec.rate), ...BITEXACT];
        const hash = createHash("sha256").update(wav).update(JSON.stringify([fmt, args])).digest("hex").slice(0, 10);
        const name = `${id}.${hash}.${fmt}`;
        const cached = join(CACHE, name);
        if (!existsSync(cached)) {
          const tmp = `${cached}.tmp.${fmt}`;
          try {
            run(FFMPEG, ["-v", "error", "-y", "-i", master, ...args, "-f", fmt === "m4a" ? "mp4" : "webm", tmp]);
            renameSync(tmp, cached);
          } catch (e) {
            rmSync(tmp, { force: true });
            warn(`${name}: encode failed (${e.message}); format skipped`);
            continue;
          }
        }
        const meta = join(CACHE, `${name}.json`);
        let delay;
        if (existsSync(meta)) delay = JSON.parse(readFileSync(meta, "utf8"));
        else {
          delay = codecDelay(cached, spec.rate, info.frames, info.sampleRate);
          writeFileSync(meta, JSON.stringify(delay));
        }
        copyIfChanged(cached, join(OUT, name));
        keep.add(name);
        entry.files[fmt] = { file: name, bytes: statSync(cached).size, priming: delay.priming, padding: delay.padding };
      }
    }
    if (!Object.keys(entry.files).length) {
      // no encoder (or every encode failed): the master itself
      const name = `${id}.wav`;
      if (master !== join(OUT, name)) copyIfChanged(master, join(OUT, name));
      keep.add(name);
      entry.files.wav = { file: name, bytes: wav.length, priming: 0, padding: 0 };
    }
    manifest.clips[id] = entry;
  }
  // the output dir is generated: drop stale hashed files and WAVs that are not shipped
  for (const f of readdirSync(OUT)) {
    if (keep.has(f)) continue;
    const isOurs = /\.(webm|m4a|wav)$/.test(f);
    // a WAV master kept only here (not in SRC) is left alone
    if (f.endsWith(".wav") && !existsSync(join(SRC, f))) continue;
    if (isOurs) rmSync(join(OUT, f), { force: true });
  }
  const n = Object.keys(manifest.clips).length;
  if (n) writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
  else rmSync(join(OUT, "manifest.json"), { force: true });
  if (missing.length) {
    warn(`${missing.length} deep-march sound master(s) missing (${missing.join(", ")}).\n  Put the licensed clips in ${SRC} (or set MICROMIST_PRIVATE_SFX). This build ships WITHOUT those sounds.`);
  }
  const bytes = Object.values(manifest.clips).reduce((s, c) => s + Object.values(c.files).reduce((a, f) => a + f.bytes, 0), 0);
  const fmts = [...new Set(Object.values(manifest.clips).flatMap((c) => Object.keys(c.files)))].join(" + ") || "none";
  console.log(`sfx-sync: ${n}/${ids.length} clips → ${OUT} (${fmts}, ${(bytes / 1024).toFixed(0)} KB)`);
}

function copyIfChanged(from, to) {
  if (existsSync(to) && statSync(to).size === statSync(from).size && readFileSync(to).equals(readFileSync(from))) return;
  copyFileSync(from, to);
}

try {
  main();
} catch (e) {
  warn(`unexpected error (${e?.message ?? e}); sounds may be missing from this build`);
}
