/**
 * The buildings (plan M5; the volt reactor: decision 1A), y = 0 at the ground point, a 6 m skirt below
 * it (it fits the building to uneven ground, groundProbe.ts `sink`). Massive,
 * faceted, slightly twisted forms — basalt monoliths grown over with light
 * strips — sized to the footprints of conserve/config.ts STRUCTURES:
 *   core        28 m octagonal ziggurat, four buttresses, a glowing belt and crown;
 *   lighthouse  48 m hexagonal spiral shaft, gallery, lantern (glow 2), spire;
 *   energy      24 m three stacked capacitor cells with glowing coils;
 *   storage     13 m wide octagonal bunker under a faceted dome;
 *   reactor     18 m squat hexagonal containment ring, three pylons leaning over
 *               a volt crystal (glow 3: the voltite nodes' amber).
 * Pure arrays (shapes.ts); structureGeometry.ts turns them into BufferGeometry.
 */
import type { StructureKind } from "../../conserve";
import { ShapeBuilder, type ShapeArrays } from "./shapes";

const SKIRT = -6;
const TAU = Math.PI * 2;

function core(b: ShapeBuilder): void {
  const t = TAU / 16;
  b.band(8, SKIRT, 10.4, 0, 10, 0, t);
  b.band(8, 0, 10, 2.2, 9.4, 0, t);
  b.cap(8, 2.2, 9.4, 7.6, 0, t);
  b.band(8, 2.2, 7.6, 9, 6.6, 0, t, t + 0.12);
  b.band(8, 9, 6.5, 10.2, 6.4, 1, t + 0.12);
  b.band(8, 10.2, 6.6, 16, 5.6, 0, t + 0.12, t + 0.24);
  b.band(8, 16, 5.6, 18.6, 6.6, 0, t + 0.24);
  b.band(8, 18.6, 6.6, 19.6, 6.6, 1, t + 0.24);
  b.band(8, 19.6, 6.6, 24.5, 2.2, 0, t + 0.24, t + 0.4);
  b.cone(8, 24.5, 2.2, 28, 1, t + 0.4);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + TAU / 8;
    b.slab(a, 10.2, SKIRT, 6.4, 15, 1.8, 3.2, 0.4);
    b.slab(a - TAU / 8, 7.1, 3, 6.6, 8.2, 0.5, 0.35, 1, 1);
  }
}

function lighthouse(b: ShapeBuilder): void {
  const t = TAU / 12;
  b.band(6, SKIRT, 5.3, 0, 5.1, 0, t);
  b.band(6, 0, 5.1, 3, 4.3, 0, t);
  b.cap(6, 3, 4.3, 3.2, 0, t);
  b.band(6, 3, 3.2, 14, 2.8, 0, t, t + 0.35);
  b.band(6, 14, 2.95, 14.6, 2.95, 1, t + 0.35);
  b.band(6, 14.6, 2.8, 26, 2.4, 0, t + 0.35, t + 0.7);
  b.band(6, 26, 2.55, 26.6, 2.55, 1, t + 0.7);
  b.band(6, 26.6, 2.4, 36, 2.2, 0, t + 0.7, t + 1.05);
  b.band(6, 36, 2.2, 37.2, 3.7, 0, t + 1.05);
  b.band(6, 37.2, 3.7, 38, 3.7, 1, t + 1.05);
  b.cap(6, 38, 3.7, 2.0, 0, t + 1.05);
  b.band(6, 38, 2.0, 44, 1.8, 2, t + 1.05);
  b.band(6, 44, 1.8, 45, 2.7, 0, t + 1.05);
  b.cone(6, 45, 2.7, 48, 0, t + 1.05);
  for (let i = 0; i < 3; i++) b.slab((i / 3) * TAU, 5.2, SKIRT, 2.7, 30, 0.9, 1.6, 0.5);
}

function energy(b: ShapeBuilder): void {
  const t = TAU / 12;
  b.band(6, SKIRT, 5.2, 0, 5, 0, t);
  b.band(6, 0, 5, 2, 4.4, 0, t);
  b.cap(6, 2, 4.4, 3.2, 0, t);
  for (let i = 0; i < 3; i++) {
    const y = 2 + i * 6;
    b.band(6, y, 3.2, y + 4.4, 3.0, 0, t + i * 0.3, t + i * 0.3 + 0.2);
    b.band(6, y + 4.4, 3.0, y + 4.7, 4.3, 0, t + i * 0.3 + 0.2);
    b.band(6, y + 4.7, 4.3, y + 5.3, 4.3, 1, t + i * 0.3 + 0.2);
    b.band(6, y + 5.3, 4.3, y + 6, 3.2, 0, t + i * 0.3 + 0.2);
  }
  b.band(6, 20, 3.2, 21, 1.6, 0, t + 1);
  b.cone(6, 21, 1.6, 24, 1, t + 1);
  for (let i = 0; i < 3; i++) b.slab((i / 3) * TAU + t, 5.1, SKIRT, 3.3, 19, 0.8, 1.2, 0.6);
}

function storage(b: ShapeBuilder): void {
  const t = TAU / 16;
  b.band(8, SKIRT, 8.3, 0, 8.1, 0, t);
  b.band(8, 0, 8.1, 5.4, 7.6, 0, t);
  b.band(8, 5.4, 7.45, 6.2, 7.45, 1, t);
  b.band(8, 6.2, 7.6, 8, 7.4, 0, t);
  b.band(8, 8, 7.4, 10.4, 6.1, 0, t, t + 0.2);
  b.band(8, 10.4, 6.1, 12.1, 3.6, 0, t + 0.2, t + 0.4);
  b.cap(8, 12.1, 3.6, 2.4, 0, t + 0.4);
  b.band(8, 12.1, 2.4, 13, 2.2, 1, t + 0.4);
  b.cap(8, 13, 2.2, 0, 0, t + 0.4);
  for (let i = 0; i < 4; i++) b.slab((i / 4) * TAU, 8.9, SKIRT, 7.2, 9, 1.4, 2.2, 0.5);
}

function reactor(b: ShapeBuilder): void {
  const t = TAU / 12;
  b.band(6, SKIRT, 6.2, 0, 6, 0, t);
  b.band(6, 0, 6, 2.6, 5.6, 0, t);
  b.band(6, 2.6, 5.45, 3.2, 5.45, 1, t);
  b.band(6, 3.2, 5.6, 4.4, 4.6, 0, t, t + 0.15);
  b.cap(6, 4.4, 4.6, 2.4, 0, t + 0.15);
  b.band(6, 4.4, 2.4, 5.6, 2.0, 1, t + 0.15);
  // the crystal: a tall faceted bipyramid floating in the cage
  b.band(6, 5.8, 0.05, 9.5, 1.9, 3, t + 0.5);
  b.cone(6, 9.5, 1.9, 14.6, 3, t + 0.5);
  for (let i = 0; i < 3; i++) b.slab((i / 3) * TAU + t, 5.9, SKIRT, 2.6, 18, 1.1, 1.8, 0.45);
}

const BUILD: Readonly<Record<StructureKind, (b: ShapeBuilder) => void>> = { core, lighthouse, energy, storage, reactor };

export function structureShape(kind: StructureKind): ShapeArrays & { triangles: number } {
  const b = new ShapeBuilder();
  BUILD[kind](b);
  return { ...b.a, triangles: b.triangles };
}
