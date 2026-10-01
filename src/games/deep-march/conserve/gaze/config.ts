/**
 * 直视 (stage 5) tuning (design doc §7.3, §9.1; G1): the 45-minute sequence of
 * game time, what each phase does to the base, the 封界 conditions and the
 * four anchors in the gap beyond the main breach. Data only.
 */
import type { ParticleCounts } from "../particles/particleVector";

export const GAZE = {
  /** The sequence: game seconds from the tide that opened the eye (only while playing). */
  duration: 2700,
  /** Phase starts (s): ① 躁动 0 · ② 围拢 10 min · ③ 侵袭 25 min · ④ 崩塌 40 min. */
  phases: [0, 600, 1500, 2400] as const,
  /** ② on: the swarm drains the base's energy (per second, on top of its own rate). */
  sapPerSec: 0.15,
  seal: {
    /** 归还: the forecast m must be back at stage 3's threshold. */
    m: 0.84,
  },
  anchors: {
    count: 4,
    /**
     * Each anchor's price, paid from the tank (P → S: consumed, not destroyed).
     * Design: resonite 75 + abyssal 50; the MVP has no resonite, so its share is lumen's
     * (as genesis folds the missing kinds into lumen and ferro, §12).
     */
    cost: { abyssal: 50, lumen: 75 } satisfies ParticleCounts,
    /** Placement on the wall's outer face: share of the breach width along it, height (m). */
    along: [-0.32, -0.12, 0.12, 0.32] as const,
    heights: [4, 24, 4, 24] as const,
    /** Beyond the outer face (m; inside the passage's reach of T + one terrain column). */
    beyond: 12,
    /** The diver within this distance (m) holds interact for `hold` s to light one. */
    reach: 10,
    hold: 2,
  },
  assault: {
    /** ③: the first squeeze this long after the phase starts, then one at a time. */
    firstDelay: 8,
    /** Tentacles wrap the building first (heard and on the sonar): the telegraph (s). */
    telegraph: 5,
    /** Durability lost per second while squeezed (STRUCTURES.durability, §9.1 −8/s). */
    hpPerSec: 8,
    /** The last crumble before its particles scatter (s), and the lull before the next one. */
    collapse: 2.5,
    pause: 30,
    /** How far a squeeze bends the building before it gives (0 … 1 of its height). */
    bend: 0.55,
  },
} as const;

export type GazePhase = 0 | 1 | 2 | 3;
