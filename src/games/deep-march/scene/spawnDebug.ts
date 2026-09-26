/**
 * Debug view of generation-time spawn candidates: small coloured markers by
 * surface type (instanced, one draw call) plus a DOM legend. Off by default;
 * toggled with B on desktop or enabled by ?debugSpawns=1. Never used in normal play.
 * Legend strings come from the game i18n (setLabels on language change).
 */
import * as THREE from "three";
import { SURFACE_TYPES, type SurfaceType, type TerrainInfoStore } from "../terrain/terrainInfo";

export const SURFACE_COLORS: Record<SurfaceType, string> = {
  "floor-flat": "#38e05a",
  "floor-slope": "#d6e23a",
  wall: "#ff9a2e",
  ceiling: "#ff3fd2",
  "ledge-top": "#2ee6ff",
  crevice: "#ff3030",
  ridge: "#ffffff",
  "cave-floor": "#8a5cff",
};

export type SpawnDebugLabels = { spawnDebugTitle: string; surfaceTypes: Record<SurfaceType, string> };

export class SpawnDebugView {
  private mesh: THREE.InstancedMesh | null = null;
  private readonly geo = new THREE.OctahedronGeometry(0.11, 0);
  private readonly mat = new THREE.MeshBasicMaterial({ fog: false, depthTest: true });
  private readonly scene: THREE.Scene;
  private readonly store: TerrainInfoStore;
  private readonly legend: HTMLDivElement;
  private builtVersion = -1;
  private readonly colors = SURFACE_TYPES.map((t) => new THREE.Color(SURFACE_COLORS[t]));
  visible = false;

  constructor(scene: THREE.Scene, store: TerrainInfoStore, overlay: HTMLElement, labels: SpawnDebugLabels) {
    this.scene = scene;
    this.store = store;
    this.legend = document.createElement("div");
    this.legend.className = "dm-spawn-legend";
    this.legend.style.display = "none";
    this.setLabels(labels);
    overlay.appendChild(this.legend);
  }

  setLabels(labels: SpawnDebugLabels) {
    const title = document.createElement("b");
    title.textContent = labels.spawnDebugTitle;
    const rows = SURFACE_TYPES.map((t) => {
      const row = document.createElement("span");
      const sw = document.createElement("i");
      sw.style.background = SURFACE_COLORS[t];
      row.append(sw, labels.surfaceTypes[t]);
      return row;
    });
    this.legend.replaceChildren(title, ...rows);
  }

  setVisible(on: boolean) {
    this.visible = on;
    this.legend.style.display = on ? "" : "none";
    if (this.mesh) this.mesh.visible = on;
    if (on) this.builtVersion = -1;
  }

  /** Rebuild markers when the loaded columns changed (cheap: runs only when visible). */
  update() {
    if (!this.visible || this.builtVersion === this.store.version) return;
    this.builtVersion = this.store.version;
    let total = 0;
    this.store.forEachSpawn(() => total++);
    if (!this.mesh || this.mesh.instanceMatrix.count < total) {
      if (this.mesh) {
        this.scene.remove(this.mesh);
        this.mesh.dispose();
      }
      this.mesh = new THREE.InstancedMesh(this.geo, this.mat, Math.max(1024, Math.ceil(total * 1.3)));
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = 5;
      this.scene.add(this.mesh);
    }
    const m = new THREE.Matrix4();
    let i = 0;
    this.store.forEachSpawn((info, k) => {
      const p = info.spawn.pos;
      const s = info.spawn.nrm;
      // lift a little off the surface along the normal so markers aren't buried
      m.makeTranslation(p[k * 3] + (s[k * 3] / 127) * 0.08, p[k * 3 + 1] + (s[k * 3 + 1] / 127) * 0.08, p[k * 3 + 2] + (s[k * 3 + 2] / 127) * 0.08);
      this.mesh!.setMatrixAt(i, m);
      this.mesh!.setColorAt(i, this.colors[info.spawn.type[k]]);
      i++;
    });
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.visible = true;
  }

  dispose() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.dispose();
    }
    this.geo.dispose();
    this.mat.dispose();
    this.legend.remove();
  }
}
