import Phaser from "phaser";
import type { LumenDifficulty } from "./i18n";
import { readBestScore, writeBestScore } from "./scores";

const WIDTH = 800;
const HEIGHT = 480;

export type LumenLabels = {
  score: string;
  best: string;
  lives: string;
  nearMiss: string;
  gameOver: string;
  tryAgain: string;
  hint: string;
};

export type LumenGameOptions = {
  difficulty: LumenDifficulty;
  labels: LumenLabels;
  onBestChange?: (best: number) => void;
  onExitRequest?: () => void;
};

type DiffConfig = {
  baseSpeed: number;
  spawnInterval: number;
  gapWidth: number;
  accel: number;
  maxSpeed: number;
};

const DIFF: Record<LumenDifficulty, DiffConfig> = {
  easy: {
    baseSpeed: 0.55,
    spawnInterval: 1400,
    gapWidth: 0.42,
    accel: 0.000012,
    maxSpeed: 1.35,
  },
  normal: {
    baseSpeed: 0.78,
    spawnInterval: 1100,
    gapWidth: 0.32,
    accel: 0.000018,
    maxSpeed: 1.75,
  },
  hard: {
    baseSpeed: 1.05,
    spawnInterval: 850,
    gapWidth: 0.24,
    accel: 0.000025,
    maxSpeed: 2.2,
  },
};

type BeamKind = "h-bar" | "v-bar" | "ring";

type Beam = {
  kind: BeamKind;
  /** Gap center in world X (-1..1) for h-bar / ring; world Y for v-bar */
  gap: number;
  gapSize: number;
  z: number;
  color: number;
  scoredNear: boolean;
  hit: boolean;
};

type Dust = {
  x: number;
  y: number;
  z: number;
  color: number;
  size: number;
};

const DEFAULT_LABELS: LumenLabels = {
  score: "Score",
  best: "Best",
  lives: "Lives",
  nearMiss: "Near miss +",
  gameOver: "Weave broken",
  tryAgain: "Click to weave again",
  hint: "Steer between the beams.",
};

let activeOpts: LumenGameOptions = {
  difficulty: "normal",
  labels: DEFAULT_LABELS,
};

export function createLumenWeaveGame(
  parent: HTMLElement,
  options: LumenGameOptions,
): Phaser.Game {
  activeOpts = options;
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: "#05060c",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    audio: { noAudio: true },
    scene: LumenWeaveScene,
  });
}

function project(wx: number, wy: number, z: number): { x: number; y: number; s: number } {
  const depth = Math.max(0.08, z);
  const perspective = 1 / depth;
  const s = Phaser.Math.Clamp(perspective * 0.55, 0.05, 8);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.42;
  return {
    x: cx + wx * 220 * perspective,
    y: cy + wy * 160 * perspective + (1 - Math.min(1, perspective * 0.35)) * 40,
    s,
  };
}

class LumenWeaveScene extends Phaser.Scene {
  private gfx: Phaser.GameObjects.Graphics | undefined;
  private glowGfx: Phaser.GameObjects.Graphics | undefined;
  private hudText: Phaser.GameObjects.Text | undefined;
  private statusText: Phaser.GameObjects.Text | undefined;
  private floatText: Phaser.GameObjects.Text | undefined;

  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | undefined;
  private keys:
    | {
        left: Phaser.Input.Keyboard.Key;
        right: Phaser.Input.Keyboard.Key;
        up: Phaser.Input.Keyboard.Key;
        down: Phaser.Input.Keyboard.Key;
      }
    | undefined;

  private playerX = 0;
  private playerY = 0.35;
  private score = 0;
  private best = 0;
  private lives = 3;
  private playing = false;
  private spawnMs = 0;
  private runMs = 0;
  private speed = 1;
  private beams: Beam[] = [];
  private dust: Dust[] = [];
  private ribbonPhase = 0;
  private dragActive = false;
  private dragOriginX = 0;
  private dragOriginY = 0;
  private dragPlayerX = 0;
  private dragPlayerY = 0;
  private invulnMs = 0;
  private flashMs = 0;

  constructor() {
    super("lumen-weave");
  }

  create() {
    this.best = readBestScore();
    this.gfx = this.add.graphics().setDepth(1);
    this.glowGfx = this.add.graphics().setDepth(0);

    this.hudText = this.add
      .text(16, 12, "", {
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        fontSize: "15px",
        color: "#d8f6ff",
      })
      .setDepth(10)
      .setShadow(0, 0, "#00e5ff", 6, true, true);

    this.statusText = this.add
      .text(WIDTH / 2, HEIGHT / 2 - 10, "", {
        fontFamily: "Songti SC, Palatino Linotype, Palatino, serif",
        fontSize: "26px",
        color: "#c084fc",
        align: "center",
      })
      .setOrigin(0.5)
      .setDepth(11)
      .setShadow(0, 0, "#a855f7", 10, true, true);

    this.floatText = this.add
      .text(WIDTH / 2, HEIGHT * 0.62, "", {
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        fontSize: "18px",
        color: "#67e8f9",
      })
      .setOrigin(0.5)
      .setDepth(12)
      .setAlpha(0);

    this.cursors = this.input.keyboard?.createCursorKeys();
    if (this.input.keyboard) {
      this.keys = {
        left: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        right: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
        up: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        down: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      };
    }

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!this.playing) {
        this.startRun();
        return;
      }
      this.dragActive = true;
      this.dragOriginX = pointer.x;
      this.dragOriginY = pointer.y;
      this.dragPlayerX = this.playerX;
      this.dragPlayerY = this.playerY;
    });
    this.input.on("pointerup", () => {
      this.dragActive = false;
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!this.playing || !this.dragActive) return;
      const dx = (pointer.x - this.dragOriginX) / (WIDTH * 0.38);
      const dy = (pointer.y - this.dragOriginY) / (HEIGHT * 0.42);
      this.playerX = Phaser.Math.Clamp(this.dragPlayerX + dx, -0.92, 0.92);
      this.playerY = Phaser.Math.Clamp(this.dragPlayerY + dy, -0.55, 0.72);
    });

    this.seedDust();
    this.showIdle();
    this.refreshHud();
  }

  update(_time: number, delta: number) {
    const dt = Math.min(delta, 48);
    this.ribbonPhase += dt * 0.0012;
    this.invulnMs = Math.max(0, this.invulnMs - dt);
    this.flashMs = Math.max(0, this.flashMs - dt);

    this.steerKeyboard(dt);
    this.advanceDust(dt);

    if (this.playing) {
      this.runMs += dt;
      const cfg = DIFF[activeOpts.difficulty];
      this.speed = Math.min(cfg.maxSpeed, cfg.baseSpeed + this.runMs * cfg.accel);
      this.score += Math.floor(this.speed * dt * 0.045);
      this.maybeWriteBest();

      this.spawnMs += dt;
      const interval = Math.max(420, cfg.spawnInterval / (0.75 + this.speed * 0.35));
      if (this.spawnMs >= interval) {
        this.spawnMs = 0;
        this.spawnBeam();
      }

      this.advanceBeams(dt);
    }

    this.drawWorld();
    this.refreshHud();
  }

  private steerKeyboard(dt: number) {
    if (!this.playing) return;
    const rate = 0.00155 * dt;
    const left = Boolean(this.cursors?.left.isDown || this.keys?.left.isDown);
    const right = Boolean(this.cursors?.right.isDown || this.keys?.right.isDown);
    const up = Boolean(this.cursors?.up.isDown || this.keys?.up.isDown);
    const down = Boolean(this.cursors?.down.isDown || this.keys?.down.isDown);
    if (left) this.playerX -= rate;
    if (right) this.playerX += rate;
    if (up) this.playerY -= rate * 0.85;
    if (down) this.playerY += rate * 0.85;
    this.playerX = Phaser.Math.Clamp(this.playerX, -0.92, 0.92);
    this.playerY = Phaser.Math.Clamp(this.playerY, -0.55, 0.72);
  }

  private seedDust() {
    this.dust = [];
    for (let i = 0; i < 70; i += 1) {
      this.dust.push(this.makeDust(Phaser.Math.FloatBetween(0.2, 4.5)));
    }
  }

  private makeDust(z: number): Dust {
    const edgeBias = Math.random() > 0.45;
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const r = edgeBias
      ? Phaser.Math.FloatBetween(0.55, 1.15)
      : Phaser.Math.FloatBetween(0.05, 0.5);
    const palette = [0x22d3ee, 0xe879f9, 0xa78bfa, 0x67e8f9, 0xf0abfc];
    return {
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r * 0.72,
      z,
      color: palette[Phaser.Math.Between(0, palette.length - 1)]!,
      size: Phaser.Math.FloatBetween(1.2, 3.4),
    };
  }

  private advanceDust(dt: number) {
    const rush = this.playing ? this.speed : 0.35;
    for (const d of this.dust) {
      d.z -= rush * 0.0022 * dt;
      if (d.z < 0.12) {
        Object.assign(d, this.makeDust(Phaser.Math.FloatBetween(3.8, 5.2)));
      }
    }
  }

  private spawnBeam() {
    const cfg = DIFF[activeOpts.difficulty];
    const roll = Math.random();
    const kind: BeamKind = roll < 0.38 ? "h-bar" : roll < 0.72 ? "v-bar" : "ring";
    const colors = [0x22d3ee, 0xe879f9, 0xc084fc, 0x67e8f9];
    this.beams.push({
      kind,
      gap: Phaser.Math.FloatBetween(-0.55, 0.55),
      gapSize: cfg.gapWidth * Phaser.Math.FloatBetween(0.9, 1.12),
      z: 4.6,
      color: colors[Phaser.Math.Between(0, colors.length - 1)]!,
      scoredNear: false,
      hit: false,
    });
  }

  private advanceBeams(dt: number) {
    const dz = this.speed * 0.00235 * dt;
    for (const beam of [...this.beams]) {
      beam.z -= dz;
      if (beam.z < 0.55 && beam.z > 0.32 && !beam.hit) {
        if (this.collides(beam)) {
          this.onHit(beam);
        } else if (!beam.scoredNear && this.isNearMiss(beam)) {
          beam.scoredNear = true;
          const bonus = 25 + Math.floor(this.speed * 8);
          this.score += bonus;
          this.maybeWriteBest();
          this.pulseFloat(`${activeOpts.labels.nearMiss}${bonus}`);
        }
      }
      if (beam.z < 0.18) {
        this.beams = this.beams.filter((b) => b !== beam);
      }
    }
  }

  private collides(beam: Beam): boolean {
    if (this.invulnMs > 0) return false;
    const half = beam.gapSize * 0.5;
    if (beam.kind === "h-bar") {
      // Horizontal bar with gap along X; solid above/below mid band except gap in X
      const inGapX = Math.abs(this.playerX - beam.gap) < half;
      const inBandY = Math.abs(this.playerY - 0.05) < 0.22;
      return inBandY && !inGapX;
    }
    if (beam.kind === "v-bar") {
      const inGapY = Math.abs(this.playerY - beam.gap) < half * 0.85;
      // Vertical pillar with a gap along Y
      const stripX = Math.abs(this.playerX - beam.gap) < 0.18;
      return stripX && !inGapY;
    }
    // ring: solid ring; safe inside radius gapSize
    const dist = Math.hypot(this.playerX - beam.gap * 0.2, this.playerY - 0.05);
    const inner = half * 0.75;
    const outer = half * 0.75 + 0.16;
    return dist >= inner && dist <= outer;
  }

  private isNearMiss(beam: Beam): boolean {
    const half = beam.gapSize * 0.5;
    if (beam.kind === "h-bar") {
      const edgeDist = Math.abs(Math.abs(this.playerX - beam.gap) - half);
      const inBandY = Math.abs(this.playerY - 0.05) < 0.28;
      return inBandY && edgeDist < 0.09 && Math.abs(this.playerX - beam.gap) < half + 0.08;
    }
    if (beam.kind === "v-bar") {
      const edgeDist = Math.abs(Math.abs(this.playerY - beam.gap) - half * 0.85);
      const stripX = Math.abs(this.playerX - beam.gap) < 0.26;
      return stripX && edgeDist < 0.1;
    }
    const dist = Math.hypot(this.playerX - beam.gap * 0.2, this.playerY - 0.05);
    const inner = half * 0.75;
    return Math.abs(dist - inner) < 0.08;
  }

  private onHit(beam: Beam) {
    beam.hit = true;
    this.lives -= 1;
    this.invulnMs = 900;
    this.flashMs = 280;
    this.cameras.main.shake(120, 0.006);
    if (this.lives <= 0) {
      this.endRun();
    }
  }

  private maybeWriteBest() {
    const prev = this.best;
    this.best = writeBestScore(this.score);
    if (this.best !== prev) {
      activeOpts.onBestChange?.(this.best);
    }
  }

  private startRun() {
    this.beams = [];
    this.score = 0;
    this.lives = 3;
    this.spawnMs = 400;
    this.runMs = 0;
    this.speed = DIFF[activeOpts.difficulty].baseSpeed;
    this.playerX = 0;
    this.playerY = 0.35;
    this.invulnMs = 0;
    this.flashMs = 0;
    this.playing = true;
    this.statusText?.setText("");
    this.refreshHud();
  }

  private endRun() {
    this.playing = false;
    this.maybeWriteBest();
    const L = activeOpts.labels;
    this.statusText?.setText(`${L.gameOver}  ·  ${this.score}\n${L.tryAgain}`);
  }

  private showIdle() {
    this.playing = false;
    const L = activeOpts.labels;
    this.statusText?.setText(`织光 / Lumen Weave\n${L.tryAgain}\n${L.hint}`);
    this.statusText?.setStyle({ fontSize: "20px" });
  }

  private pulseFloat(msg: string) {
    if (!this.floatText) return;
    this.floatText.setText(msg);
    this.floatText.setAlpha(1);
    this.floatText.setY(HEIGHT * 0.58);
    this.tweens.killTweensOf(this.floatText);
    this.tweens.add({
      targets: this.floatText,
      y: HEIGHT * 0.5,
      alpha: 0,
      duration: 700,
      ease: "Cubic.easeOut",
    });
  }

  private refreshHud() {
    const L = activeOpts.labels;
    this.hudText?.setText(
      `${L.score} ${this.score}    ${L.best} ${this.best}    ${L.lives} ${this.lives}`,
    );
  }

  private drawWorld() {
    const g = this.gfx;
    const glow = this.glowGfx;
    if (!g || !glow) return;
    g.clear();
    glow.clear();

    // Void gradient backdrop via stacked rects
    glow.fillStyle(0x05060c, 1);
    glow.fillRect(0, 0, WIDTH, HEIGHT);
    glow.fillStyle(0x0b1020, 0.55);
    glow.fillCircle(WIDTH * 0.5, HEIGHT * 0.42, 220);
    glow.fillStyle(0x1a0a2e, 0.25);
    glow.fillCircle(WIDTH * 0.5, HEIGHT * 0.5, 320);

    // Woven ribbon walls (denser near edges)
    for (let i = 0; i < 10; i += 1) {
      const t = (i / 10 + this.ribbonPhase * 0.15) % 1;
      const z = 0.35 + t * 4.2;
      const sway = Math.sin(this.ribbonPhase * 2 + i) * 0.08;
      this.drawRibbon(glow, -0.95 + sway, z, 0x22d3ee, 0.35);
      this.drawRibbon(glow, 0.95 - sway, z, 0xe879f9, 0.35);
    }

    // Dust / particles (far → near)
    const sortedDust = [...this.dust].sort((a, b) => b.z - a.z);
    for (const d of sortedDust) {
      const p = project(d.x, d.y, d.z);
      const alpha = Phaser.Math.Clamp(1.1 - d.z * 0.18, 0.08, 0.85);
      g.fillStyle(d.color, alpha);
      g.fillCircle(p.x, p.y, d.size * Math.min(p.s, 2.2));
    }

    // Beams far → near
    const sortedBeams = [...this.beams].sort((a, b) => b.z - a.z);
    for (const beam of sortedBeams) {
      this.drawBeam(g, glow, beam);
    }

    // Player craft
    this.drawPlayer(g, glow);

    if (this.flashMs > 0) {
      g.fillStyle(0xff4d6d, (this.flashMs / 280) * 0.28);
      g.fillRect(0, 0, WIDTH, HEIGHT);
    }
  }

  private drawRibbon(
    glow: Phaser.GameObjects.Graphics,
    wx: number,
    z: number,
    color: number,
    alpha: number,
  ) {
    const top = project(wx, -0.85, z);
    const bot = project(wx, 0.9, z);
    glow.lineStyle(Math.max(1, 3 * top.s * 0.15), color, alpha);
    glow.beginPath();
    glow.moveTo(top.x, top.y);
    glow.lineTo(bot.x, bot.y);
    glow.strokePath();
  }

  private drawBeam(
    g: Phaser.GameObjects.Graphics,
    glow: Phaser.GameObjects.Graphics,
    beam: Beam,
  ) {
    const alpha = Phaser.Math.Clamp(1.15 - beam.z * 0.16, 0.15, 0.95);
    const half = beam.gapSize * 0.5;

    if (beam.kind === "h-bar") {
      const y = 0.05;
      const left = project(-1.1, y, beam.z);
      const gapL = project(beam.gap - half, y, beam.z);
      const gapR = project(beam.gap + half, y, beam.z);
      const right = project(1.1, y, beam.z);
      const thick = Math.max(2, 10 * left.s * 0.12);
      glow.lineStyle(thick + 6, beam.color, alpha * 0.25);
      glow.beginPath();
      glow.moveTo(left.x, left.y);
      glow.lineTo(gapL.x, gapL.y);
      glow.moveTo(gapR.x, gapR.y);
      glow.lineTo(right.x, right.y);
      glow.strokePath();
      g.lineStyle(thick, beam.color, alpha);
      g.beginPath();
      g.moveTo(left.x, left.y);
      g.lineTo(gapL.x, gapL.y);
      g.moveTo(gapR.x, gapR.y);
      g.lineTo(right.x, right.y);
      g.strokePath();
      return;
    }

    if (beam.kind === "v-bar") {
      const x = beam.gap;
      const top = project(x, -0.95, beam.z);
      const gapT = project(x, beam.gap - half * 0.85, beam.z);
      const gapB = project(x, beam.gap + half * 0.85, beam.z);
      const bot = project(x, 0.95, beam.z);
      const thick = Math.max(2, 9 * top.s * 0.12);
      glow.lineStyle(thick + 5, beam.color, alpha * 0.25);
      glow.beginPath();
      glow.moveTo(top.x, top.y);
      glow.lineTo(gapT.x, gapT.y);
      glow.moveTo(gapB.x, gapB.y);
      glow.lineTo(bot.x, bot.y);
      glow.strokePath();
      g.lineStyle(thick, beam.color, alpha);
      g.beginPath();
      g.moveTo(top.x, top.y);
      g.lineTo(gapT.x, gapT.y);
      g.moveTo(gapB.x, gapB.y);
      g.lineTo(bot.x, bot.y);
      g.strokePath();
      return;
    }

    // ring
    const c = project(beam.gap * 0.2, 0.05, beam.z);
    const radius = Math.max(8, half * 210 * (1 / Math.max(0.2, beam.z)));
    glow.lineStyle(Math.max(3, 8 * c.s * 0.1), beam.color, alpha * 0.3);
    glow.strokeCircle(c.x, c.y, radius);
    g.lineStyle(Math.max(2, 4 * c.s * 0.12), beam.color, alpha);
    g.strokeCircle(c.x, c.y, radius);
  }

  private drawPlayer(g: Phaser.GameObjects.Graphics, glow: Phaser.GameObjects.Graphics) {
    const p = project(this.playerX, this.playerY, 0.55);
    const blink = this.invulnMs > 0 && Math.floor(this.invulnMs / 80) % 2 === 0;
    if (blink) return;

    const s = 1.1;
    glow.fillStyle(0x67e8f9, 0.2);
    glow.fillCircle(p.x, p.y, 18 * s);
    glow.fillStyle(0xe879f9, 0.12);
    glow.fillCircle(p.x, p.y + 4, 26 * s);

    // craft diamond + core
    g.fillStyle(0xa5f3fc, 0.95);
    g.fillTriangle(
      p.x,
      p.y - 14 * s,
      p.x - 11 * s,
      p.y + 8 * s,
      p.x + 11 * s,
      p.y + 8 * s,
    );
    g.fillStyle(0xf0abfc, 0.9);
    g.fillCircle(p.x, p.y + 1, 4.5 * s);
    g.lineStyle(1.5, 0xffffff, 0.7);
    g.strokeCircle(p.x, p.y + 1, 7 * s);

    // exhaust motes
    g.fillStyle(0x22d3ee, 0.55);
    g.fillCircle(p.x - 5, p.y + 14 * s, 2);
    g.fillCircle(p.x + 5, p.y + 15 * s, 1.6);
    g.fillStyle(0xe879f9, 0.45);
    g.fillCircle(p.x, p.y + 17 * s, 2.2);
  }
}
