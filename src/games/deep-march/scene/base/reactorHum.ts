/**
 * The volt reactor's hum (伏晶反应堆): a quiet loop near a reactor while it runs
 * (运行, BaseBuilding.working); silent on 待机 (standby) and 停机 (switched off or
 * out of fuel). The gain follows the distance from the camera to the nearest
 * working reactor's crystal (REACTOR_HUM), so it rises as the diver swims up to
 * it and is gone across the base. A slow ease keeps the reactor's standby cycling
 * from clicking the sound on and off. The loop goes through the dive's master
 * (audio.ts), so mute, volume and the ≡ menu's pause hold silence it too.
 */
import type { BaseBuilding } from "../../conserve";
import type { DiveAudio } from "../audio";
import { REACTOR_HUM } from "./config";

type Point = { x: number; y: number; z: number };

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Hum strength 0 … 1 at `eye` from the working reactors among `buildings` (pure). */
export function reactorHumLevel(buildings: readonly BaseBuilding[], eye: Point): number {
  const H = REACTOR_HUM;
  let best = Infinity;
  for (const b of buildings) {
    if (b.kind !== "reactor" || !b.working) continue;
    const d = Math.hypot(b.pos[0] - eye.x, b.pos[1] + H.crystalY - eye.y, b.pos[2] - eye.z);
    if (d < best) best = d;
  }
  if (!Number.isFinite(best)) return 0;
  // a soft square-law fall-off between near and far
  const k = 1 - smooth((best - H.near) / (H.far - H.near));
  return k * k;
}

export class ReactorHum {
  private readonly audio: DiveAudio;
  private level = 0;

  constructor(audio: DiveAudio) {
    this.audio = audio;
  }

  /** Per frame, after the base view is current. */
  update(dt: number, buildings: readonly BaseBuilding[], eye: Point): void {
    const target = reactorHumLevel(buildings, eye);
    if (target === 0 && this.level === 0) return;
    this.level += (target - this.level) * (1 - Math.exp(-dt / REACTOR_HUM.easeS));
    if (this.level < 1e-3 && target === 0) this.level = 0;
    this.audio.setLoop("reactor", this.level * REACTOR_HUM.gain);
  }

  dispose(): void {
    this.level = 0;
    this.audio.setLoop("reactor", 0);
  }
}
