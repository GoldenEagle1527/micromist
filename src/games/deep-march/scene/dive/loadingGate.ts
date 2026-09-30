/**
 * The loading gate: every footprint in view drawn + level 0 around the diver,
 * all materials on the GPU, programs compiled, sounds settled (loaded, missing
 * or timed out: audio.ts); then the loading screen starts the dive.
 */
import type * as THREE from "three";
import type { ChunkManager } from "../../terrain/chunks";
import type { AudioStatus, DiveAudio } from "../audio";
import type { GpuHealth } from "./gpuHealth";

/** Sounds are optional: once everything else is in, the gate waits at most this long for them (ms). */
export const AUDIO_GRACE_MS = 5000;
/** Terrain gate radius around the diver (world units). */
const NEAR_RADIUS = 14;
/** The terrain progress walks the column set: refreshed at most this often (ms). */
const PROGRESS_MS = 150;

export class LoadingGate {
  /** The dive started (simulation running). */
  ready = false;
  diveRequested = false;
  terrainReady = false;
  private restReadyAt = -1;
  private progressAt = -1e9;
  private progress = { done: 0, total: 0 };
  private readonly chunks: ChunkManager;
  private readonly audio: DiveAudio;
  private readonly health: GpuHealth;
  private readonly viewer: THREE.Vector3;
  private readonly textures: () => boolean;

  /** `textures`: all seabed materials on the GPU (materialLibrary.ts). */
  constructor(chunks: ChunkManager, audio: DiveAudio, health: GpuHealth, viewer: THREE.Vector3, textures: () => boolean) {
    this.chunks = chunks;
    this.textures = textures;
    this.audio = audio;
    this.health = health;
    this.viewer = viewer;
  }

  /** Per frame before the dive: true on the frame the dive starts. */
  tick(): boolean {
    if (!this.terrainReady) this.terrainReady = this.chunks.nearReady(this.viewer, NEAR_RADIUS) && this.chunks.coverageComplete(this.viewer);
    if (this.diveRequested && this.terrainReady && this.textures() && this.health.shadersReady && this.audioGate().settled) {
      this.ready = true;
      this.chunks.loading = false;
      return true;
    }
    return false;
  }

  /** Slow clips keep loading and play when they arrive; the gate stops waiting after AUDIO_GRACE_MS. */
  audioGate(): AudioStatus {
    const s = this.audio.status();
    if (s.settled) return s;
    const rest = this.terrainReady && this.textures() && this.health.shadersReady;
    if (!rest) {
      this.restReadyAt = -1;
      return s;
    }
    const t = performance.now();
    if (this.restReadyAt < 0) this.restReadyAt = t;
    return t - this.restReadyAt >= AUDIO_GRACE_MS ? { ...s, settled: true, late: true } : s;
  }

  /** Terrain gate items done / total (throttled). */
  terrainProgress(): { done: number; total: number } {
    const t = performance.now();
    if (t - this.progressAt > PROGRESS_MS) {
      this.progressAt = t;
      this.progress = this.chunks.loadProgress(this.viewer, NEAR_RADIUS);
    }
    return this.progress;
  }
}
