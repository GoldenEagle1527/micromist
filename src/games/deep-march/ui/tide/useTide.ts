import { useEffect, useState } from "react";
import type { DeepMarchHandle } from "../../scene/world";
import type { TideTelemetry } from "../../scene/tide/telemetry";

/** Polls the tide HUD data (4 Hz); null in the free dive. */
export function useTide(game: DeepMarchHandle | null, hz = 4): TideTelemetry | null {
  const [tel, setTel] = useState<TideTelemetry | null>(null);
  useEffect(() => {
    if (!game) return;
    const tick = () => setTel(game.tide());
    tick();
    const id = window.setInterval(tick, 1000 / hz);
    return () => {
      window.clearInterval(id);
      setTel(null);
    };
  }, [game, hz]);
  return tel;
}
