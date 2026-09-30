/**
 * The dive's sound cues (audioCues.ts timing): battery low / flat warnings,
 * the bump by impact with cooldown, rate-limited UI sounds for the lights,
 * sonar pings, and the ambience / swim loops.
 */
import { SURVIVAL_TUNING, type LightMode, type Survival } from "../../survival";
import type { DiveAudio } from "../audio";
import { BumpCue, CueLimiter } from "../audioCues";
import type { DiverController } from "../diver";

export class DiveCues {
  readonly limiter = new CueLimiter();
  private readonly bumpCue = new BumpCue();
  private readonly audio: DiveAudio;

  constructor(survival: Survival, audio: DiveAudio) {
    this.audio = audio;
    const lowCut = SURVIVAL_TUNING.battery.lowFraction * SURVIVAL_TUNING.battery.capacity;
    survival.resources.on("changed", "battery", (e) => {
      if (e.prev > lowCut && e.value <= lowCut && this.limiter.allow("warn", this.now())) audio.play("warn", { gain: 0.4, rate: 0.92 });
    });
    survival.resources.on("depleted", "battery", () => {
      if (this.limiter.allow("warn", this.now())) audio.play("warn", { gain: 0.55, rate: 0.72 });
    });
  }

  now(): number {
    return performance.now() / 1000;
  }

  /** After a simulated diver step. */
  bump(dt: number, diver: DiverController): void {
    const b = this.bumpCue.update(dt, diver.impact, diver.contact !== null);
    if (b) this.audio.play("bump", { gain: b.gain, rate: b.rate, lowpass: 480 });
  }

  /** A sonar ping went out (`nowS`: seconds, the pulse clock). */
  ping(nowS: number): void {
    if (this.limiter.allow("sonar", nowS)) this.audio.play("sonar", { gain: 0.48 });
  }

  /** Ambience and swim loops, then the audio tick. */
  loops(dt: number, ready: boolean, diver: DiverController): void {
    const moving = Math.min(1, Math.max(0, (diver.speed - 0.6) / 6));
    this.audio.setLoop("ambience", 0.4);
    this.audio.setLoop("swim", ready ? moving * (diver.state === "swim" ? 0.5 : 0.2) : 0);
    this.audio.tick(dt);
  }
}

/** F / L / 1–3 and the HUD buttons, with their switch / mode / refusal cues. */
export function lightControls(survival: Survival, audio: DiveAudio, cues: DiveCues) {
  const lights = survival.lights;
  const allow = (id: "switch" | "mode" | "warn") => cues.limiter.allow(id, cues.now());
  return {
    toggleLamp: (): boolean => {
      const before = lights.state();
      const on = lights.toggle();
      if (on !== before.on) {
        if (allow("switch")) audio.play("switch", { gain: on ? 0.5 : 0.32, rate: on ? 1 : 0.88 });
      } else if (before.locked && allow("warn")) audio.play("warn", { gain: 0.28, rate: 1.2 });
      return on;
    },
    cycleLight: (): LightMode => {
      const before = lights.state().mode;
      const mode = lights.cycle();
      if (mode !== before && allow("mode")) audio.play("mode", { gain: 0.42 });
      return mode;
    },
    selectLight: (i: number): void => {
      const m = lights.available()[i];
      if (!m) return;
      const before = lights.state().mode;
      lights.select(m);
      if (lights.state().mode !== before && allow("mode")) audio.play("mode", { gain: 0.42 });
    },
  };
}
