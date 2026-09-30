/**
 * The tide on top of the session (design doc §5.1, §5.5, §5.6; plan M7): the
 * state machine, the plan made at the call, the commit (gen + 1 on disk before
 * the show) and the dome's rule for the diver. Absorbing and retrieving are
 * locked from the call to the end, so R' stays available (commit.ts).
 * Pure: the host (ConserveSession) owns the save, the ledger and the writes.
 */
import type { TideReadiness } from "../base/port";
import type { ParticleLedger } from "../ledger/particleLedger";
import type { WorldSave } from "../save/schema";
import { commitTide } from "./commit";
import { DiverFate, domeZone } from "./dome";
import { TideMachine, type TideStart } from "./machine";
import { planTide, type GenerationSummary, type TidePlan } from "./plan";
import type { TideControlPort, TideInput, TideView } from "./port";

export type TideHost = {
  readonly ledger: ParticleLedger;
  /** The save as it would be written now. */
  snapshot(): WorldSave;
  /** The generation being played. */
  gen(): number;
  siteHarvest(): readonly number[];
  readiness(): TideReadiness;
  /** The base core's ground point and protection radius (null before the founding). */
  dome(): { x: number; y: number; z: number; radius: number } | null;
  /** Refuse absorbing / retrieving (the current generation's expedition, and each new one). */
  lockExpedition(on: boolean): void;
  /** Take `next` as the save (gen + 1), rebuild the generation's objects, write it now. */
  advance(next: WorldSave): void;
};

export class TideController implements TideControlPort {
  private readonly host: TideHost;
  private readonly machine = new TideMachine();
  private readonly fate = new DiverFate();
  private plan: TidePlan | null = null;
  private last: GenerationSummary | null = null;

  constructor(host: TideHost) {
    this.host = host;
  }

  readiness(): TideReadiness {
    return this.host.readiness();
  }

  active(): boolean {
    return this.machine.active;
  }

  /** The plan of the running tide (gen + 1's table and chaos), null when idle. */
  get pending(): TidePlan | null {
    return this.plan;
  }

  call(o: TideStart): boolean {
    if (this.machine.active || !this.host.readiness().ready) return false;
    this.plan = planTide(this.host.snapshot(), this.host.siteHarvest());
    this.host.lockExpedition(true);
    return this.machine.start(o);
  }

  step(i: TideInput): TideView {
    const f = this.machine.step(i);
    if (f.events.includes("commit")) this.commit();
    const d = this.host.dome();
    const dome = d && { ...d, zone: domeZone(Math.hypot(i.diver.x - d.x, i.diver.z - d.z), d.radius) };
    const r = f.state === "idle" || !dome ? null : this.fate.step(i.dt, f, dome.zone);
    const dissolved = r === "dissolve" ? this.dissolve() : 0;
    if (f.events.includes("done")) {
      this.host.lockExpedition(false);
      this.plan = null;
    }
    return { ...f, gen: this.host.gen(), dome, fate: this.fate.state, fateU: this.fate.progress, dissolved, wake: r === "wake" };
  }

  summary(): GenerationSummary | null {
    return this.last;
  }

  private commit(): void {
    const plan = this.plan;
    if (!plan) return;
    this.host.advance(commitTide(this.host.ledger, this.host.snapshot(), plan));
    this.host.lockExpedition(true);
    this.last = plan.summary;
  }

  /** The tide took the diver: everything carried joins the new generation's suspended pool (no lost cache, D4). */
  private dissolve(): number {
    const ledger = this.host.ledger;
    const carried = ledger.pool("player");
    const n = carried.reduce((a, b) => a + b, 0);
    if (n > 0) ledger.transferVector("player", "suspended", carried);
    return n;
  }
}
