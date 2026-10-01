/**
 * The gaze as the scene drives it (stage 5; gaze/port.ts): the session's
 * controller, one object for the whole dive — idle while the generation has no
 * gaze, so it follows the tide's switch to gen + 1 without rebinding.
 */
import type { GazePort } from "../gaze/port";
import type { ConserveSession } from "../session/conserveSession";

export function gazePortOf(session: ConserveSession): GazePort {
  return session.gaze;
}
