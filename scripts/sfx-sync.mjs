/**
 * The deep-march sound effects are a purchased, licensed pack and are not in git.
 * Before a build/deploy, copy any missing clips from the private store on this
 * machine into public/deep-march/sfx/. Never fails: missing clips only warn (the
 * game then runs silent for those sounds).
 *
 * Source dir: $MICROMIST_PRIVATE_SFX or /home/box/micromist-private/deep-march/sfx
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const CLIPS = ["ambience", "swim", "sonar", "switch", "mode", "bump", "warn"].map((c) => `${c}.wav`);
const src = process.env.MICROMIST_PRIVATE_SFX || "/home/box/micromist-private/deep-march/sfx";
const dst = resolve("public/deep-march/sfx");
mkdirSync(dst, { recursive: true });

const copied = [];
const missing = [];
for (const f of CLIPS) {
  if (existsSync(join(dst, f))) continue;
  if (existsSync(join(src, f))) {
    copyFileSync(join(src, f), join(dst, f));
    copied.push(f);
  } else missing.push(f);
}
if (copied.length) console.log(`sfx-sync: copied ${copied.join(", ")} from ${src}`);
if (missing.length) {
  console.warn(
    `\x1b[33mWARNING sfx-sync: ${missing.length} deep-march sound file(s) missing (${missing.join(", ")}).\n` +
      `  Put the licensed clips in ${dst} or ${src}. This build will ship WITHOUT those sounds.\x1b[0m`,
  );
} else if (!copied.length) console.log("sfx-sync: all deep-march sound files present");
