export type GlyphMatrixLabels = {
  hint: string;
};

export type GlyphMatrixOptions = {
  labels: GlyphMatrixLabels;
  /** Gentle forward drift along the corridor (world units / sec). */
  driftSpeed?: number;
};

export type GlyphMatrixHandle = {
  destroy: (removeCanvas?: boolean) => void;
};
