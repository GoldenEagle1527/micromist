import type { BiomeId } from "./biomeIds";
import type { LumenCruise } from "./i18n";

export type LumenLabels = {
  seed: string;
  biome: string;
  hint: string;
};

export type LumenGameOptions = {
  seed: string;
  cruise: LumenCruise;
  labels: LumenLabels;
  biomeName: (id: BiomeId) => string;
  onExitRequest?: () => void;
};
