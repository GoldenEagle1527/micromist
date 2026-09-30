import { useEffect, useState } from "react";
import type { ExpeditionTelemetry } from "../../scene/expedition/telemetry";
import type { DeepMarchHandle } from "../../scene/world";

/** Polls the expedition HUD data (10 Hz: hold progress reads smoothly); null in the free dive. */
export function useExpedition(game: DeepMarchHandle | null, hz = 10): ExpeditionTelemetry | null {
  const [tel, setTel] = useState<ExpeditionTelemetry | null>(null);
  useEffect(() => {
    if (!game) return;
    const tick = () => setTel(game.expedition());
    tick();
    const id = window.setInterval(tick, 1000 / hz);
    return () => {
      window.clearInterval(id);
      setTel(null);
    };
  }, [game, hz]);
  return tel;
}
