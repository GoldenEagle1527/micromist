/**
 * Debug view of generation-time spawn candidates: small coloured markers by
 * surface type (instanced, one draw call) plus a DOM legend. Off by default;
 * toggled with B on desktop or enabled by ?debugSpawns=1. Never used in normal play.
 * Legend strings come from the game i18n (setLabels on language change).
 * Also shows the macro region under the diver (name, blend weight, distance to
 * the border) and a small top-down region map (±128 units, north up).
 */
import * as THREE from "three";
import { SURFACE_TYPES, type SurfaceType, type TerrainInfoStore } from "../terrain/terrainInfo";
import { REGION_COLORS, REGION_COUNT, REGION_KEYS, createRegionSample, type RegionField, type RegionKey } from "../terrain/regions";

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

export type SpawnDebugLabels = {
  spawnDebugTitle: string;
  surfaceTypes: Record<SurfaceType, string>;
  regionDebugTitle: string;
  regionNames: Record<RegionKey, string>;
  regionEdge: string;
};

const MAP_PX = 64;
const MAP_RANGE = 128; // units from the centre to the map edge
const RGB = REGION_COLORS.map((c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]);

export class SpawnDebugView {
  private mesh: THREE.InstancedMesh | null = null;
  private readonly geo = new THREE.OctahedronGeometry(0.11, 0);
  private readonly mat = new THREE.MeshBasicMaterial({ fog: false, depthTest: true });
  private readonly scene: THREE.Scene;
  private readonly store: TerrainInfoStore;
  private readonly legend: HTMLDivElement;
  private readonly regions: RegionField;
  private readonly regionBox: HTMLDivElement;
  private readonly regionLine: HTMLDivElement;
  private readonly map: HTMLCanvasElement;
  private readonly mapCtx: CanvasRenderingContext2D | null;
  private mapImage: ImageData | null = null;
  private mapX = NaN;
  private mapZ = NaN;
  private readonly rs = createRegionSample();
  private labels: SpawnDebugLabels;
  private builtVersion = -1;
  private readonly colors = SURFACE_TYPES.map((t) => new THREE.Color(SURFACE_COLORS[t]));
  visible = false;

  constructor(scene: THREE.Scene, store: TerrainInfoStore, regions: RegionField, overlay: HTMLElement, labels: SpawnDebugLabels) {
    this.scene = scene;
    this.store = store;
    this.regions = regions;
    this.labels = labels;
    this.legend = document.createElement("div");
    this.legend.className = "dm-spawn-legend";
    this.legend.style.display = "none";
    this.regionBox = document.createElement("div");
    this.regionBox.className = "dm-region-debug";
    this.regionLine = document.createElement("div");
    this.regionLine.className = "dm-region-line";
    this.map = document.createElement("canvas");
    this.map.width = MAP_PX;
    this.map.height = MAP_PX;
    this.map.className = "dm-region-map";
    this.mapCtx = this.map.getContext("2d");
    this.setLabels(labels);
    overlay.appendChild(this.legend);
  }

  setLabels(labels: SpawnDebugLabels) {
    this.labels = labels;
    const rTitle = document.createElement("b");
    rTitle.textContent = labels.regionDebugTitle;
    const keys = document.createElement("div");
    keys.className = "dm-region-keys";
    for (let r = 0; r < REGION_COUNT; r++) {
      const row = document.createElement("span");
      const sw = document.createElement("i");
      sw.style.background = REGION_COLORS[r];
      row.append(sw, labels.regionNames[REGION_KEYS[r]]);
      keys.append(row);
    }
    this.regionBox.replaceChildren(rTitle, this.regionLine, this.map, keys);
    this.mapX = NaN; // redraw text next update
    const title = document.createElement("b");
    title.textContent = labels.spawnDebugTitle;
    const rows = SURFACE_TYPES.map((t) => {
      const row = document.createElement("span");
      const sw = document.createElement("i");
      sw.style.background = SURFACE_COLORS[t];
      row.append(sw, labels.surfaceTypes[t]);
      return row;
    });
    this.legend.replaceChildren(this.regionBox, title, ...rows);
  }

  /** Region line + minimap around (x, z); heading in radians (0 = north / −z, clockwise). */
  private updateRegion(x: number, z: number, heading: number) {
    const r = this.regions.sample(x, z, this.rs);
    this.regionLine.textContent = `${this.labels.regionNames[REGION_KEYS[r.id]]} ${(r.dominant * 100).toFixed(0)}% · ${this.labels.regionEdge} ${r.edge.toFixed(0)}`;
    this.regionLine.style.borderColor = REGION_COLORS[r.id];
    const ctx = this.mapCtx;
    if (!ctx) return;
    if (!this.mapImage || Math.hypot(x - this.mapX, z - this.mapZ) > 6 * this.store.scale) {
      this.mapX = x;
      this.mapZ = z;
      const img = this.mapImage ?? ctx.createImageData(MAP_PX, MAP_PX);
      const k = (2 * MAP_RANGE * this.store.scale) / MAP_PX; // map range scales with the world
      for (let py = 0; py < MAP_PX; py++) {
        for (let px = 0; px < MAP_PX; px++) {
          const s = this.regions.sample(x + (px + 0.5 - MAP_PX / 2) * k, z + (py + 0.5 - MAP_PX / 2) * k, this.rs);
          let cr = 0, cg = 0, cb = 0;
          for (let q = 0; q < REGION_COUNT; q++) {
            const w = s.w[q];
            if (w <= 0) continue;
            cr += w * RGB[q][0];
            cg += w * RGB[q][1];
            cb += w * RGB[q][2];
          }
          const o = (py * MAP_PX + px) * 4;
          img.data[o] = cr;
          img.data[o + 1] = cg;
          img.data[o + 2] = cb;
          img.data[o + 3] = 230;
        }
      }
      this.mapImage = img;
    }
    ctx.putImageData(this.mapImage, 0, 0);
    // diver: dot + heading tick (map is north-up: −z at the top)
    const cx = MAP_PX / 2 + ((x - this.mapX) * MAP_PX) / (2 * MAP_RANGE);
    const cy = MAP_PX / 2 + ((z - this.mapZ) * MAP_PX) / (2 * MAP_RANGE);
    ctx.strokeStyle = "#fff";
    ctx.fillStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.sin(heading) * 9, cy - Math.cos(heading) * 9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  setVisible(on: boolean) {
    this.visible = on;
    this.legend.style.display = on ? "" : "none";
    if (this.mesh) this.mesh.visible = on;
    if (on) this.builtVersion = -1;
  }

  /** Region panel (throttled by the caller) — diver position and heading (radians, clockwise from north). */
  updateDiver(x: number, z: number, heading: number) {
    if (this.visible) this.updateRegion(x, z, heading);
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
      const W = this.store.scale; // stored in base units
      // lift a little off the surface along the normal so markers aren't buried
      m.makeTranslation(p[k * 3] * W + (s[k * 3] / 127) * 0.3, p[k * 3 + 1] * W + (s[k * 3 + 1] / 127) * 0.3, p[k * 3 + 2] * W + (s[k * 3 + 2] / 127) * 0.3);
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
