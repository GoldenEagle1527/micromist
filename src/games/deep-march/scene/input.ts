/**
 * Diver input: keyboard (WASD / arrows, Space, Shift, sprint = double-tap W /
 * Ctrl / R), mouse-look via pointer lock (desktop, panel off), drag-look on
 * touch, plus analog state pushed in by the sci-fi control panel.
 */
import type { DiverInput } from "./diver";

const HANDLED = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD", "KeyR", "KeyF",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "ShiftLeft", "ShiftRight", "Space", "ControlLeft", "ControlRight",
]);

/** Minecraft default sensitivity (0.5 → 1 px = 0.15°). */
const MOUSE_DEG_PER_PX = 0.15;
const TOUCH_DEG_PER_PX = 0.3;
/** MC sprintTriggerTime: 7 ticks. */
const DOUBLE_TAP_MS = 350;

export type InputOptions = {
  sensitivity: number;
  invertY: boolean;
  onLockChange?: (locked: boolean) => void;
  onLampToggle?: () => void;
};

export type PanelInput = {
  moveX: number;
  moveY: number;
  swimZone: boolean;
  up: boolean;
  down: boolean;
  swimLatch: boolean;
};

export class InputController {
  private readonly keys = new Set<string>();
  private readonly el: HTMLElement;
  private readonly opts: InputOptions;
  private lookX = 0; // degrees
  private lookY = 0;
  private lastForwardDown = -1e9;
  private sprintPulse = false;
  private touchId: number | null = null;
  private touchX = 0;
  private touchY = 0;
  panelMode = false;
  readonly panel: PanelInput = { moveX: 0, moveY: 0, swimZone: false, up: false, down: false, swimLatch: false };

  constructor(el: HTMLElement, opts: InputOptions) {
    this.el = el;
    this.opts = opts;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("pointerlockchange", this.onLockChange);
    document.addEventListener("mousemove", this.onMouseMove);
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointercancel", this.onPointerUp);
  }

  get locked(): boolean {
    return document.pointerLockElement === this.el;
  }

  private isTyping(): boolean {
    const a = document.activeElement;
    return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || (a as HTMLElement).isContentEditable);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.isTyping() || !HANDLED.has(e.code)) return;
    e.preventDefault();
    if (e.code === "KeyF") {
      if (!e.repeat) this.opts.onLampToggle?.();
      return;
    }
    const isForward = e.code === "KeyW" || e.code === "ArrowUp";
    if (isForward && !e.repeat) {
      const now = performance.now();
      if (now - this.lastForwardDown < DOUBLE_TAP_MS) this.sprintPulse = true;
      this.lastForwardDown = now;
    }
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onBlur = () => {
    this.keys.clear();
    this.touchId = null;
  };

  private onLockChange = () => {
    this.opts.onLockChange?.(this.locked);
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    this.addLookDeg(e.movementX * MOUSE_DEG_PER_PX, e.movementY * MOUSE_DEG_PER_PX);
  };

  private onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse") {
      if (!this.panelMode && !this.locked) {
        const req = this.el.requestPointerLock() as unknown;
        if (req instanceof Promise) req.catch(() => {});
      }
      return;
    }
    // touch / pen with the panel hidden: drag anywhere to look
    if (this.touchId !== null) return;
    this.touchId = e.pointerId;
    this.touchX = e.clientX;
    this.touchY = e.clientY;
    this.el.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerId !== this.touchId) return;
    this.addLookPx(e.clientX - this.touchX, e.clientY - this.touchY, true);
    this.touchX = e.clientX;
    this.touchY = e.clientY;
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.pointerId === this.touchId) this.touchId = null;
  };

  private addLookDeg(dx: number, dy: number) {
    this.lookX += dx * this.opts.sensitivity;
    this.lookY += dy * this.opts.sensitivity * (this.opts.invertY ? -1 : 1);
  }

  /** Drag-look in CSS pixels (panel look pad / touch). */
  addLookPx(dx: number, dy: number, touch: boolean) {
    const k = touch ? TOUCH_DEG_PER_PX : MOUSE_DEG_PER_PX * 1.6;
    this.addLookDeg(dx * k, dy * k);
  }

  releaseLock() {
    if (this.locked) document.exitPointerLock();
  }

  /** Accumulated look since the last call, in radians (yaw right +, pitch down +). */
  takeLook(): [number, number] {
    const r = Math.PI / 180;
    const out: [number, number] = [this.lookX * r, this.lookY * r];
    this.lookX = 0;
    this.lookY = 0;
    return out;
  }

  move(): DiverInput {
    const k = this.keys;
    const p = this.panel;
    const fwd = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const str = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    const sprintKey = k.has("ControlLeft") || k.has("ControlRight") || k.has("KeyR");
    return {
      forward: clamp(fwd + p.moveY),
      strafe: clamp(str + p.moveX),
      up: k.has("Space") || p.up,
      down: k.has("ShiftLeft") || k.has("ShiftRight") || p.down,
      sprint: this.sprintPulse || sprintKey || p.swimZone || p.swimLatch,
    };
  }

  /** Call after a simulation tick consumed the input (double-tap is a one-shot). */
  consumePulse() {
    this.sprintPulse = false;
  }

  dispose() {
    this.releaseLock();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    document.removeEventListener("mousemove", this.onMouseMove);
    this.el.removeEventListener("pointerdown", this.onPointerDown);
    this.el.removeEventListener("pointermove", this.onPointerMove);
    this.el.removeEventListener("pointerup", this.onPointerUp);
    this.el.removeEventListener("pointercancel", this.onPointerUp);
  }
}
