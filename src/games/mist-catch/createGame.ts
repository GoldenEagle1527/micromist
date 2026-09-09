import Phaser from "phaser";
import { readBestScore, writeBestScore } from "../../lib/bestScore";

const WIDTH = 800;
const HEIGHT = 480;

type Mote = Phaser.GameObjects.Arc & { fallSpeed: number };

export function createMistCatchGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: "#070a0f",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    audio: { noAudio: true },
    scene: MistCatchScene,
  });
}

class MistCatchScene extends Phaser.Scene {
  private bowl: Phaser.GameObjects.Arc | undefined;
  private bowlWell: Phaser.GameObjects.Arc | undefined;
  private motes: Mote[] = [];
  private scoreText: Phaser.GameObjects.Text | undefined;
  private statusText: Phaser.GameObjects.Text | undefined;
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | undefined;
  private wasd: { left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key } | undefined;
  private score = 0;
  private best = 0;
  private lives = 3;
  private spawnMs = 0;
  private playing = false;
  private pointerX = WIDTH / 2;

  constructor() {
    super("mist-catch");
  }

  create() {
    this.best = readBestScore();
    this.drawBackdrop();

    this.bowl = this.add.circle(WIDTH / 2, HEIGHT - 56, 28, 0x7ec8c4, 0.95);
    this.bowlWell = this.add.circle(WIDTH / 2, HEIGHT - 56, 16, 0x0b1016, 0.55);
    this.bowl.setDepth(2);
    this.bowlWell.setDepth(3);

    this.scoreText = this.add.text(20, 16, "", {
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
      fontSize: "16px",
      color: "#e8e4dc",
    });
    this.statusText = this.add
      .text(WIDTH / 2, HEIGHT / 2 - 8, "", {
        fontFamily: "Songti SC, Palatino, serif",
        fontSize: "28px",
        color: "#7ec8c4",
        align: "center",
      })
      .setOrigin(0.5);

    this.cursors = this.input.keyboard?.createCursorKeys();
    if (this.input.keyboard) {
      this.wasd = {
        left: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        right: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      };
    }

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      this.pointerX = pointer.x;
    });
    this.input.on("pointerdown", () => {
      if (!this.playing) {
        this.startRun();
      }
    });

    this.showIdle();
    this.refreshHud();
  }

  update(_time: number, delta: number) {
    if (!this.bowl) {
      return;
    }

    const keyboardLeft = Boolean(this.cursors?.left.isDown || this.wasd?.left.isDown);
    const keyboardRight = Boolean(this.cursors?.right.isDown || this.wasd?.right.isDown);
    if (keyboardLeft) {
      this.bowl.x -= 0.42 * delta;
    } else if (keyboardRight) {
      this.bowl.x += 0.42 * delta;
    } else if (this.input.activePointer.primaryDown || this.input.activePointer.isDown) {
      this.bowl.x = Phaser.Math.Linear(this.bowl.x, this.pointerX, 0.18);
    }

    this.bowl.x = Phaser.Math.Clamp(this.bowl.x, 36, WIDTH - 36);
    if (this.bowlWell) {
      this.bowlWell.x = this.bowl.x;
    }

    if (!this.playing) {
      return;
    }

    this.spawnMs += delta;
    const interval = Math.max(420, 980 - this.score * 12);
    if (this.spawnMs >= interval) {
      this.spawnMs = 0;
      this.spawnMote();
    }

    for (const mote of [...this.motes]) {
      mote.y += mote.fallSpeed * (delta / 16.67);
      if (this.bowl && Phaser.Math.Distance.Between(mote.x, mote.y, this.bowl.x, this.bowl.y) < 40) {
        this.catchMote(mote);
      } else if (mote.y > HEIGHT + 16) {
        this.missMote(mote);
      }
    }
  }

  private drawBackdrop() {
    const g = this.add.graphics();
    g.fillGradientStyle(0x0b1016, 0x0b1016, 0x1a2430, 0x142028, 1);
    g.fillRect(0, 0, WIDTH, HEIGHT);
    for (let i = 0; i < 18; i += 1) {
      const fog = this.add.circle(
        Phaser.Math.Between(20, WIDTH - 20),
        Phaser.Math.Between(20, HEIGHT - 20),
        Phaser.Math.Between(28, 80),
        0x7ec8c4,
        Phaser.Math.FloatBetween(0.03, 0.08),
      );
      this.tweens.add({
        targets: fog,
        x: fog.x + Phaser.Math.Between(-40, 40),
        y: fog.y + Phaser.Math.Between(-18, 18),
        duration: Phaser.Math.Between(4000, 8000),
        yoyo: true,
        repeat: -1,
        ease: "sine.inOut",
      });
    }
  }

  private startRun() {
    for (const mote of this.motes) {
      mote.destroy();
    }
    this.motes = [];
    this.score = 0;
    this.lives = 3;
    this.spawnMs = 0;
    this.playing = true;
    if (this.statusText) {
      this.statusText.setText("");
    }
    this.refreshHud();
  }

  private showIdle() {
    this.playing = false;
    this.statusText?.setText("拾雾  ·  点击开始\nMist Catch  ·  click to start");
  }

  private spawnMote() {
    const mote = this.add.circle(
      Phaser.Math.Between(30, WIDTH - 30),
      -12,
      Phaser.Math.Between(5, 8),
      Math.random() > 0.78 ? 0xd4a574 : 0x9ad8d4,
      0.95,
    ) as Mote;
    mote.fallSpeed = Phaser.Math.FloatBetween(2.1, 3.6) + this.score * 0.03;
    this.motes.push(mote);
  }

  private catchMote(mote: Mote) {
    this.score += 1;
    this.best = writeBestScore(this.score);
    this.removeMote(mote);
    this.refreshHud();
  }

  private missMote(mote: Mote) {
    this.removeMote(mote);
    this.lives -= 1;
    this.refreshHud();
    if (this.lives <= 0) {
      this.playing = false;
      this.statusText?.setText(`雾散了  ·  ${this.score}\nclick to try again`);
    }
  }

  private removeMote(mote: Mote) {
    this.motes = this.motes.filter((item) => item !== mote);
    mote.destroy();
  }

  private refreshHud() {
    this.scoreText?.setText(`分 ${this.score}    最高 ${this.best}    命 ${this.lives}`);
  }
}
