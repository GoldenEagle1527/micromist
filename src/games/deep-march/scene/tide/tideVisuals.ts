/**
 * The tide's look, per frame from the tide's view (design doc §5.5, §5.6):
 * the dissolve front on the drawn terrain, the dome's glow and edge warning,
 * the particle currents and the diver's burst, the veil (P1's clear water, the
 * murk's darkness, the particle-ized black) and the sounds. Holds no state of
 * the tide itself (that is conserve/tide), only what it drew.
 */
import * as THREE from "three";
import type { TideTimeline, TideView } from "../../conserve";
import type { ChunkManager } from "../../terrain/chunks";
import type { DiveAudio } from "../audio";
import type { WaterLook } from "../dive/waterLook";
import type { SeabedMaterial } from "../seabedMaterial";
import { TIDE_VIEW } from "./config";
import { TideDome } from "./domeMesh";
import { frontRadius, frontReach } from "./frontSchedule";
import { TerrainFront } from "./terrainFront";
import { TideCues } from "./tideCues";
import { TideParticles } from "./tideParticles";

export type VisualsDeps = { scene: THREE.Scene; seabed: SeabedMaterial; look: WaterLook; audio: DiveAudio; lowSpec: boolean; seed: number; timeline: TideTimeline; viewDistance: number };

const smooth = THREE.MathUtils.smoothstep;

export class TideVisuals {
  readonly dome = new TideDome();
  readonly particles: TideParticles;
  readonly front: TerrainFront;
  private readonly d: VisualsDeps;
  private readonly cues: TideCues;
  private burstAt: number | null = null;
  private edge = 0;

  constructor(d: VisualsDeps) {
    this.d = d;
    const { starts, lengths } = d.timeline;
    this.particles = new TideParticles(d.lowSpec, d.seed, { stripStart: starts.strip, stripLen: lengths.strip, gatherStart: starts.gather, gatherLen: lengths.gather });
    this.front = new TerrainFront(d.seabed.tideMaterial());
    this.cues = new TideCues(d.audio);
    d.scene.add(this.dome.mesh, this.particles.points);
  }

  /** Objects with the tide's programs, for the loading screen's warm compile. */
  get warmObjects(): THREE.Object3D[] {
    return [this.dome.mesh, this.particles.points];
  }

  frame(v: TideView, chunks: ChunkManager, diver: THREE.Vector3, time: number, dt: number, pxPerM: number): void {
    const dome = v.dome;
    const reach = dome ? frontReach(dome.radius, this.d.viewDistance, TIDE_VIEW.front.width) : 0;
    const r = dome ? frontRadius(v, dome.radius, reach) : null;
    this.front.apply(chunks, this.d.seabed.material, dome?.x ?? 0, dome?.z ?? 0, r);
    this.edge += ((dome && dome.zone !== "inside" ? 1 : 0) - this.edge) * Math.min(1, dt * 4);
    this.dome.update(dome, this.glow(v), this.edge, diver, time);
    // the particles run on the time since the commit (the show's clock, or the murk's)
    const t = v.state === "show" ? v.showT : v.state === "murk" ? v.t : -1;
    if (v.fate !== "free" && this.burstAt === null && t >= 0) {
      this.burstAt = t;
      this.particles.burst(diver.x, diver.y, diver.z, t);
    }
    this.particles.update(t, v.state === "show", dome, reach, pxPerM);
    this.d.look.setVeil(this.veil(v));
    this.cues.frame(v, dt);
  }

  private glow(v: TideView): number {
    const D = TIDE_VIEW.dome;
    if (v.state === "warning") return D.warnGlow * (0.8 + 0.2 * Math.sin(v.t * 2));
    if (v.state === "murk") return D.warnGlow * (1 - 0.5 * v.dark);
    if (v.state !== "show") return 0;
    if (v.phase === "inhale") return D.warnGlow + (D.showGlow - D.warnGlow) * v.u;
    if (v.phase === "settle") return D.showGlow * (1 - v.u);
    return D.showGlow;
  }

  private veil(v: TideView) {
    const V = TIDE_VIEW.veil;
    const fate = v.fate === "gone" ? 1 : v.fate === "dissolving" ? smooth(v.fateU, 0.3, 1) : 0;
    const clear = v.state !== "show" ? 0 : v.phase === "inhale" ? smooth(v.u, 0, 0.4) : v.phase === "strip" ? 1 - smooth(v.u, 0, 0.3) : 0;
    return { dark: Math.max(v.dark, fate), clear, darkVis: V.darkVisibility, clearVis: V.inhaleVisibility };
  }

  /** The tide is over (or the dive ends): everything back as it was. */
  end(): void {
    this.front.clear(this.d.seabed.material);
    this.dome.mesh.visible = false;
    this.particles.points.visible = false;
    this.particles.burst(0, 0, 0, -1e4);
    this.burstAt = null;
    this.edge = 0;
    this.d.look.setVeil(null);
    this.cues.reset();
  }

  dispose(): void {
    this.dome.mesh.removeFromParent();
    this.particles.points.removeFromParent();
    this.dome.dispose();
    this.particles.dispose();
  }
}
