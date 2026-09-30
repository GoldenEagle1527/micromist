/**
 * The base's commands (keys and HUD buttons → the port and build mode): what
 * each does, the cue it plays and the notice it leaves. Storage moves only at
 * the base (inside the protection radius); 唤潮 too. The lighthouse switch
 * (M9) works from anywhere the panel opens.
 */
import type { BasePort, BaseView } from "../../conserve";
import type { DiveAudio } from "../audio";
import type { BuildMode } from "./buildMode";
import type { BaseCommand, BaseNotice } from "./telemetry";

export type CommandContext = {
  port: BasePort;
  audio: DiveAudio;
  build: BuildMode;
  view: BaseView;
  atBase: boolean;
  panel: boolean;
  /** 唤潮: start the tide's warning (false: not ready or already running). */
  callTide: () => boolean;
};

export type CommandResult = { notice: BaseNotice | null; panel: boolean };

export function runCommand(cmd: BaseCommand, c: CommandContext): CommandResult {
  const { port, audio, build } = c;
  const done = (notice: BaseNotice | null = null, panel = c.panel): CommandResult => ({ notice, panel });
  switch (cmd.type) {
    case "build":
      build.toggle(cmd.on);
      audio.play("switch", { gain: 0.3, rate: build.current().active ? 1.2 : 0.9 });
      return done();
    case "kind":
      build.select(cmd.kind);
      return done();
    case "place": {
      if (!build.current().active) return done();
      const r = build.place();
      audio.play(r.ok ? "mode" : "warn", r.ok ? { gain: 0.5, rate: 0.7 } : { gain: 0.3, rate: 1.2 });
      return done(r.ok ? { kind: "built", structure: r.kind } : { kind: "refused", structure: r.kind, reason: r.reason });
    }
    case "panel":
      return done(null, cmd.open ?? !c.panel);
    case "deposit":
      return done(c.atBase ? { kind: "moved", action: "deposit", total: port.deposit(cmd.kind) } : null);
    case "withdraw":
      return done(c.atBase ? { kind: "moved", action: "withdraw", total: port.withdraw(cmd.kind, cmd.count) } : null);
    case "release":
      return done(c.atBase ? { kind: "moved", action: "release", total: port.release(cmd.kind, cmd.count) } : null);
    case "demolish": {
      const b = c.view.buildings.find((x) => x.id === cmd.id);
      return done(b && port.demolish(cmd.id).ok ? { kind: "demolished", structure: b.kind } : null);
    }
    case "switch": {
      const b = c.view.buildings.find((x) => x.id === cmd.id);
      if (!b || !port.setOn(cmd.id, cmd.on).ok) return done();
      audio.play("switch", { gain: 0.3, rate: cmd.on ? 1.2 : 0.9 });
      return done({ kind: "switched", structure: b.kind, on: cmd.on });
    }
    case "tide": {
      // only at the base (the dome is its protection radius); the panel closes on success
      const ok = c.atBase && c.callTide();
      audio.play(ok ? "mode" : "warn", ok ? { gain: 0.6, rate: 0.5 } : { gain: 0.3, rate: 1.2 });
      return ok ? done({ kind: "tide", ok }, false) : done({ kind: "tide", ok, away: !c.atBase });
    }
  }
}
