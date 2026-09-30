/**
 * Long-range sonar pulses (MVP plan M3): the same pulse scheduler as the diver's
 * sonar (sonar.ts SonarPulses) with a reach across the whole bounded world, for the
 * far proxy ring of the wall (wallRing.ts) and, later, the tide's P1 sweep.
 * While the sonar is on, every second ping also sends a long pulse: its front runs
 * out past the view distance and lights the ring wall kilometres away.
 */
import { SONAR_TUNING, SonarPulses, type SonarTuning } from "./sonar";

export const LONG_SONAR_TUNING: SonarTuning = {
  ...SONAR_TUNING,
  /** Every second diver ping (the schedules start together, so they stay in step). */
  period: SONAR_TUNING.period * 2,
  /** Stylised: the ring 2 km away lights ~5 s after the ping. */
  speed: 420,
  /** Beyond the world's diagonal (5.9 km). */
  range: 6400,
  trail: 2.6,
  /** Wide front band: it is seen from kilometres away. */
  front: 40,
  /** Contour spacing on the ring (m): coarser than the terrain's, it is far away. */
  contour: 12,
  maxPulses: 3,
  maxPulsesLow: 3,
};

export function createLongPulses(): SonarPulses {
  return new SonarPulses(LONG_SONAR_TUNING.maxPulses, LONG_SONAR_TUNING);
}
