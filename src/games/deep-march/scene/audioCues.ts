/**
 * When a sound should play (pure, node-tested): the bump on terrain contact and
 * per-cue rate limits for UI-ish sounds. Keeps world.ts free of timing state.
 *
 * Bump: driven by the impact speed along the contact normal (Diver.impact), not the
 * total speed, so gliding along a wall at full speed is quiet and a head-on hit is
 * loud. Sliding / grinding along rock keeps the contact alive, so after one bump the
 * cue re-arms only once the diver has been clear of the terrain for REARM seconds —
 * or on a clearly harder hit — and never more often than COOLDOWN.
 */
export const BUMP_TUNING = {
  /**
   * Impacts below this normal speed (world units / s) are silent: grazing, resting,
   * and pushing into rock from a standstill (one tick of hover thrust ≈ 1.1 u/s).
   * Full hover ≈ 5.6 u/s, full swim ≈ 9.8 u/s (DIVER).
   */
  minImpact: 1.5,
  /** Normal speed that gives the loudest bump. */
  fullImpact: 8,
  minGain: 0.12,
  maxGain: 0.55,
  /** Seconds between bumps, whatever happens. */
  cooldown: 0.7,
  /** Seconds clear of the terrain before a new contact counts as a new bump. */
  rearm: 0.4,
  /** While still in contact, a hit this much harder than the last bump plays anyway. */
  harder: 1.6,
  rate: 0.82,
  /** ± playback-rate variation so repeated bumps don't sound identical. */
  rateJitter: 0.05,
} as const;

export type BumpSound = { gain: number; rate: number };

export class BumpCue {
  private cooldownLeft = 0;
  private clearFor = Infinity;
  private lastImpact = 0;
  private readonly t: typeof BUMP_TUNING;
  private readonly rng: () => number;

  constructor(tuning: typeof BUMP_TUNING = BUMP_TUNING, rng: () => number = Math.random) {
    this.t = tuning;
    this.rng = rng;
  }

  /**
   * One frame: `impact` = strongest normal speed removed by collisions this frame,
   * `touching` = the diver is (or just was) in contact. Returns the sound to play.
   */
  update(dt: number, impact: number, touching: boolean): BumpSound | null {
    const t = this.t;
    this.cooldownLeft = Math.max(0, this.cooldownLeft - dt);
    const armed = this.clearFor >= t.rearm;
    this.clearFor = touching || impact > 0 ? 0 : this.clearFor + dt;
    if (impact < t.minImpact || this.cooldownLeft > 0) return null;
    if (!armed && impact < this.lastImpact * t.harder) return null;
    this.cooldownLeft = t.cooldown;
    this.lastImpact = impact;
    const k = Math.min(1, (impact - t.minImpact) / (t.fullImpact - t.minImpact));
    return { gain: t.minGain + (t.maxGain - t.minGain) * k, rate: t.rate * (1 + (this.rng() * 2 - 1) * t.rateJitter) };
  }
}

/** Minimum seconds between two plays of the same cue (key mashing, flicker). */
export const CUE_INTERVAL = { switch: 0.12, mode: 0.12, warn: 0.5, sonar: 0.25 } as const;
export type LimitedCue = keyof typeof CUE_INTERVAL;

export class CueLimiter {
  private readonly last = new Map<LimitedCue, number>();
  private readonly interval: Readonly<Record<LimitedCue, number>>;

  constructor(interval: Readonly<Record<LimitedCue, number>> = CUE_INTERVAL) {
    this.interval = interval;
  }

  /** May `cue` play at time `now` (seconds)? Records the play when it may. */
  allow(cue: LimitedCue, now: number): boolean {
    const prev = this.last.get(cue);
    if (prev !== undefined && now - prev < this.interval[cue]) return false;
    this.last.set(cue, now);
    return true;
  }
}
