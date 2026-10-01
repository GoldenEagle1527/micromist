/**
 * The tide's sounds from the existing clips, pitched (design doc §5.5: bells in
 * the warning, P1's long pulse, P3's pulse every 2.5 s, P4's chord). No new
 * clip ids, so nothing plays without the sound pack (and no audio in git).
 * The pulses are also real sonar pulses from the base core (`pulses`, taken by
 * the dive loop): the base sends them — free, not the diver's charge — and their
 * long fronts run 2 km out, lighting the far wall and its cracks.
 */
import type { TideView } from "../../conserve";
import type { DiveAudio } from "../audio";

const BELL_S = 6;
const BELL_AWAY_S = 2.5;
const PULSE_S = 2.5;

export class TideCues {
  private readonly audio: DiveAudio;
  private phase: string | null = null;
  private bell = 0;
  private pulse = 0;
  /** Pulses due since the last take (the dive loop sends them from the core). */
  pulses = 0;

  constructor(audio: DiveAudio) {
    this.audio = audio;
  }

  frame(v: TideView, dt: number): void {
    const a = this.audio;
    const key = v.state === "show" ? v.phase : v.state;
    const entered = key !== this.phase;
    this.phase = key;
    if (v.state === "warning") {
      // bells, more urgent outside the dome
      this.bell -= dt;
      if (entered || this.bell <= 0) {
        a.play("mode", { gain: 0.45, rate: 0.42 });
        this.bell = v.dome?.zone === "outside" ? BELL_AWAY_S : BELL_S;
      }
      return;
    }
    if (v.state === "murk") {
      if (entered) a.play("warn", { gain: 0.5, rate: 0.45 });
      return;
    }
    if (v.state !== "show") return;
    if (entered && v.phase === "inhale") {
      a.play("sonar", { gain: 0.9, rate: 0.3 });
      this.pulses++;
    }
    if (entered && v.phase === "strip") a.play("sonar", { gain: 0.5, rate: 0.5 });
    if (v.phase === "currents" && (this.pulse -= dt) <= 0) {
      a.play("sonar", { gain: 0.4, rate: 0.62 });
      this.pulse = PULSE_S;
      this.pulses++;
    }
    if (entered && v.phase === "gather") for (const rate of [0.5, 0.63, 0.75]) a.play("mode", { gain: 0.35, rate });
  }

  reset(): void {
    this.phase = null;
    this.bell = this.pulse = this.pulses = 0;
  }
}
