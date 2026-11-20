import type { GamePlayModule, GameSession } from "../../platform/play";
import { preview } from "./play-preview";

export const playModule: GamePlayModule = {
  createSession: (ctx) => {
    const session: GameSession = {
      snapshot: () => preview(ctx),
      subscribe: () => () => {},
      choose: () => {},
      back: () => {},
      setParam: () => {},
      dispatch: () => {},
      bindBoard: () => ({ destroy: () => {} }),
      syncContext: () => {},
      destroy: () => {},
    };
    return session;
  },
};
