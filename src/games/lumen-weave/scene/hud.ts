import type { LumenLabels } from "../types";

export type Hud = {
  root: HTMLDivElement;
  setHud: (score: number, best: number, lives: number) => void;
  setStatus: (text: string) => void;
  pulse: (text: string) => void;
  flash: () => void;
  dispose: () => void;
};

export function createHud(parent: HTMLElement, labels: LumenLabels): Hud {
  const root = document.createElement("div");
  root.className = "lumen-overlay";
  root.innerHTML = `
    <div class="lumen-hud"></div>
    <div class="lumen-status"></div>
    <div class="lumen-float"></div>
    <div class="lumen-flash"></div>
    <div class="lumen-vignette"></div>
  `;
  parent.appendChild(root);

  const hudEl = root.querySelector(".lumen-hud") as HTMLDivElement;
  const statusEl = root.querySelector(".lumen-status") as HTMLDivElement;
  const floatEl = root.querySelector(".lumen-float") as HTMLDivElement;
  const flashEl = root.querySelector(".lumen-flash") as HTMLDivElement;

  let floatTimer = 0;
  let flashTimer = 0;

  const setHud = (score: number, best: number, lives: number) => {
    hudEl.textContent = `${labels.score} ${score}    ${labels.best} ${best}    ${labels.lives} ${lives}`;
  };

  const setStatus = (text: string) => {
    statusEl.textContent = text;
    statusEl.dataset.on = text ? "1" : "0";
  };

  const pulse = (text: string) => {
    floatEl.textContent = text;
    floatEl.dataset.on = "1";
    window.clearTimeout(floatTimer);
    floatTimer = window.setTimeout(() => {
      floatEl.dataset.on = "0";
    }, 720);
  };

  const flash = () => {
    flashEl.dataset.on = "1";
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => {
      flashEl.dataset.on = "0";
    }, 280);
  };

  const dispose = () => {
    window.clearTimeout(floatTimer);
    window.clearTimeout(flashTimer);
    root.remove();
  };

  return { root, setHud, setStatus, pulse, flash, dispose };
}
