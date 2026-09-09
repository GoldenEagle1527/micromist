import { useEffect, useRef } from "react";
import { createMistCatchGame } from "./createGame";

export function MistCatchGame() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const game = createMistCatchGame(host);
    return () => {
      game.destroy(true);
    };
  }, []);

  return <div ref={hostRef} className="game-stage" aria-label="Mist Catch" />;
}
