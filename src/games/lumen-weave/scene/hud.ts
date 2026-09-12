import type { LumenLabels } from "../types";

export type Hud = {
  root: HTMLDivElement;
  setExplore: (seedLabel: string, biomeLabel: string) => void;
  dispose: () => void;
};

export function createHud(parent: HTMLElement, labels: LumenLabels): Hud {
  const root = document.createElement("div");
  root.className = "lumen-overlay";
  root.innerHTML = `
    <div class="lumen-hud"></div>
    <div class="lumen-vignette"></div>
  `;
  parent.appendChild(root);

  const hudEl = root.querySelector(".lumen-hud") as HTMLDivElement;

  const setExplore = (seedLabel: string, biomeLabel: string) => {
    hudEl.textContent = `${labels.seed}: ${seedLabel}    ${labels.biome}: ${biomeLabel}`;
  };

  const dispose = () => {
    root.remove();
  };

  return { root, setExplore, dispose };
}
