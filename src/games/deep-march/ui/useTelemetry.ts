import { useEffect, useState } from "react";
import type { DeepMarchHandle, Telemetry } from "../scene/world";

/** Polls the running game for HUD data (~10 Hz is plenty for readouts). */
export function useTelemetry(game: DeepMarchHandle | null, hz = 10): Telemetry | null {
  const [tel, setTel] = useState<Telemetry | null>(null);
  useEffect(() => {
    if (!game) return;
    const tick = () => setTel(game.telemetry());
    tick();
    const id = window.setInterval(tick, 1000 / hz);
    return () => window.clearInterval(id);
  }, [game, hz]);
  return tel;
}
