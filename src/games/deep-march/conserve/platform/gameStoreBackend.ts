/** The game's save backend: the platform game-store (IndexedDB behind a sync cache). The only conserve file that touches storage. */
import { gameStoreGet, gameStoreSet } from "../../../../lib/game-store";
import { DEEP_MARCH_GAME } from "../../settings";
import type { SaveBackend } from "../save/saveBackend";

export function createGameStoreBackend(game: string = DEEP_MARCH_GAME): SaveBackend {
  return {
    read: (key) => gameStoreGet<unknown>(game, key),
    write: (key, value) => gameStoreSet(game, key, value),
  };
}
