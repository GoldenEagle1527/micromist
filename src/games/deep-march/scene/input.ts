/** Keyboard + pointer-drag steering + wheel throttle + on-screen throttle buttons. */
import type { SubInput } from "./submarine";

const HANDLED = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight", "Space",
]);

export type InputOptions = {
  invertPitch: boolean;
};

export class InputController {
  private readonly keys = new Set<string>();
  private readonly el: HTMLElement;
  private readonly reticle: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly opts: InputOptions;
  private pointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private steerX = 0;
  private steerY = 0;
  private impulse = 0;
  throttleHold = 0;
  boostHold = false;

  constructor(el: HTMLElement, overlay: HTMLElement, opts: InputOptions) {
    this.el = el;
    this.opts = opts;
    this.reticle = document.createElement("div");
    this.reticle.className = "dm-reticle";
    this.knob = document.createElement("div");
    this.knob.className = "dm-reticle-knob";
    this.reticle.appendChild(this.knob);
    overlay.appendChild(this.reticle);

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointercancel", this.onPointerUp);
    el.addEventListener("wheel", this.onWheel, { passive: false });
  }

  private isTyping(): boolean {
    const a = document.activeElement;
    return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || (a as HTMLElement).isContentEditable);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.isTyping() || !HANDLED.has(e.code)) return;
    e.preventDefault();
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onBlur = () => {
    this.keys.clear();
    this.releasePointer();
  };

  private radius(): number {
    const r = this.el.getBoundingClientRect();
    return Math.max(40, Math.min(r.width, r.height) * 0.2);
  }

  private onPointerDown = (e: PointerEvent) => {
    if (this.pointerId !== null) return;
    if ((e.target as HTMLElement).closest("button")) return;
    this.pointerId = e.pointerId;
    this.el.setPointerCapture(e.pointerId);
    const r = this.el.getBoundingClientRect();
    this.originX = e.clientX;
    this.originY = e.clientY;
    this.reticle.style.left = `${e.clientX - r.left}px`;
    this.reticle.style.top = `${e.clientY - r.top}px`;
    this.reticle.classList.add("on");
    this.knob.style.transform = "translate(-50%, -50%)";
  };

  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    const R = this.radius();
    let dx = (e.clientX - this.originX) / R;
    let dy = (e.clientY - this.originY) / R;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    this.steerX = dx;
    this.steerY = dy;
    const knobR = 34;
    this.knob.style.transform = `translate(calc(-50% + ${dx * knobR}px), calc(-50% + ${dy * knobR}px))`;
  };

  private releasePointer() {
    this.pointerId = null;
    this.steerX = 0;
    this.steerY = 0;
    this.reticle.classList.remove("on");
  }

  private onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.releasePointer();
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.impulse += -Math.sign(e.deltaY) * 0.4;
  };

  read(): SubInput {
    const k = this.keys;
    const up = k.has("KeyW") || k.has("ArrowUp") ? 1 : 0;
    const down = k.has("KeyS") || k.has("ArrowDown") ? 1 : 0;
    const left = k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0;
    const right = k.has("KeyD") || k.has("ArrowRight") ? 1 : 0;
    const faster = k.has("KeyE") ? 1 : 0;
    const slower = k.has("KeyQ") ? 1 : 0;
    // Drag up = nose up (same sense as W, like the reference's Vertical axis).
    let pitch = up - down - this.steerY;
    if (this.opts.invertPitch) pitch = -pitch;
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    const impulse = this.impulse;
    this.impulse = 0;
    return {
      pitch: clamp(pitch),
      yaw: clamp(right - left + this.steerX),
      throttle: clamp(faster - slower + this.throttleHold),
      boost: k.has("ShiftLeft") || k.has("ShiftRight") || k.has("Space") || this.boostHold,
      throttleImpulse: impulse,
    };
  }

  dispose() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.el.removeEventListener("pointerdown", this.onPointerDown);
    this.el.removeEventListener("pointermove", this.onPointerMove);
    this.el.removeEventListener("pointerup", this.onPointerUp);
    this.el.removeEventListener("pointercancel", this.onPointerUp);
    this.el.removeEventListener("wheel", this.onWheel);
    this.reticle.remove();
  }
}
