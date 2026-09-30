import { useEffect, useState } from "react";
import type { BaseTelemetry } from "../../scene/base/telemetry";
import type { DeepMarchHandle } from "../../scene/world";

/** Polls the base HUD data (8 Hz: the build check reads live); null in the free dive. */
export function useBase(game: DeepMarchHandle | null, hz = 8): BaseTelemetry | null {
  const [tel, setTel] = useState<BaseTelemetry | null>(null);
  useEffect(() => {
    if (!game) return;
    const tick = () => setTel(game.base());
    tick();
    const id = window.setInterval(tick, 1000 / hz);
    return () => {
      window.clearInterval(id);
      setTel(null);
    };
  }, [game, hz]);
  return tel;
}

/** What the diver can spend on a building: storage + tank, per kind index. */
export function fundsOf(base: BaseTelemetry): number[] {
  return base.view.storage.map((n, k) => n + (base.view.tank[k] ?? 0));
}
