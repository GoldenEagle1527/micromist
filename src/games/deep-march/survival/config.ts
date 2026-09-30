/**
 * Survival tuning in one place. Units: battery "charge" (0…capacity, shown as %),
 * rates per second of real play time.
 */
export const SURVIVAL_TUNING = {
  battery: {
    capacity: 100,
    /** Passive trickle charge while every consumer is off. */
    regen: 0.5,
    /** Seconds after the last drain before the trickle starts. */
    regenDelay: 2,
    /** After running dry, lights stay locked until the charge climbs back to this. */
    minToEnable: 5,
    /** HUD warning threshold (fraction of capacity). */
    lowFraction: 0.2,
  },
  /** Drain per light mode (charge / s). Order: beam < high beam. */
  lights: {
    beam: 0.25, // ~6.7 min on a full battery
    high: 0.6, // ~2.8 min
  },
  /** Active sonar (sonarPing.ts): one-shot pings, not a light mode. */
  sonar: {
    /** Charge per ping (the old always-on sonar spent ~3 per 2.5 s pulse). */
    pingCost: 3,
    /** Seconds between pings. */
    cooldown: 2.5,
  },
  /** Drain per held action (charge / s), stacking with the lights. */
  actions: {
    /** Conserve: absorbing a node / retrieving a cache (the suit's pump). */
    absorb: 0.5,
  },
} as const;
