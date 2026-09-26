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
  /** Drain per light mode (charge / s). Order: beam < high beam < night vision. */
  lights: {
    beam: 0.25, // ~6.7 min on a full battery
    high: 0.6, // ~2.8 min
    night: 1.2, // ~1.4 min
  },
} as const;
