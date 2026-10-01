import { useEffect, useState } from "react";
import type { DeepMarchHandle } from "../../scene/world";
import type { GazeTelemetry } from "../../scene/gaze/telemetry";

/** Polls the gaze HUD data (4 Hz); null without a gaze. */
export function useGaze(game: DeepMarchHandle | null, hz = 4): GazeTelemetry | null {
  const [tel, setTel] = useState<GazeTelemetry | null>(null);
  useEffect(() => {
    if (!game) return;
    const tick = () => setTel(game.gaze());
    tick();
    const id = window.setInterval(tick, 1000 / hz);
    return () => {
      window.clearInterval(id);
      setTel(null);
    };
  }, [game, hz]);
  return tel;
}
