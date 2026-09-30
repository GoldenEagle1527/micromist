/**
 * Far proxy ring of the ring wall (design doc §4.4, MVP plan M3): one draw, ≈ 1k
 * triangles (terrain/wallRing.ts builds them on the wall's facet lattice). Near the
 * diver the wall is ordinary terrain columns (density.ts Wall term, same LOD fade);
 * beyond the columns' reach the ring stands in for it. In normal light the fog
 * swallows it (not drawn at all); in SONAR mode the long pulses (sonarLong.ts) run
 * out across the world and light it kilometres away.
 */
import * as THREE from "three";
import type { DensityField } from "../terrain/density";
import { buildWallRing } from "../terrain/wallRing";
import type { FogUniforms } from "./fog";
import type { WaterUniforms } from "./seabedMaterial";
import type { SonarPulses, SonarUniforms } from "./sonar";
import { RING_FRAG, RING_VERT } from "./wallRingShader";

export const WALL_RING = {
  /** Metres in front of the wall's inner face. */
  inset: 3,
  /** Height band (the facet rows inside it) and its soft bottom / top. */
  yBot: -40,
  yTop: 80,
  edgeBot: 30,
  edgeTop: 24,
  /**
   * Fade-in beyond the view distance: from uFar + gap (terrain columns end at the
   * camera's far plane, uFar + 40) over `fade` metres.
   */
  gap: 40,
  fade: 80,
  /** Contour line width (m) and minimum on-screen width (px). */
  lineWidth: 0.6,
  minPx: 1.25,
} as const;

export type WallRing = {
  mesh: THREE.Mesh;
  triangles: number;
  /** Far plane that keeps the whole ring in front of it (the world's diagonal + margin). */
  reach: number;
  /** Per frame: the long pulses' state and the sonar strength (0 = not drawn). */
  update: (sonar: number) => void;
  dispose: () => void;
};

export function createWallRing(
  field: DensityField,
  opts: { water: WaterUniforms; fog: FogUniforms; sonar: SonarUniforms; long: SonarPulses; far: number },
): WallRing | null {
  const wall = field.wall;
  if (!wall) return null;
  const S = field.settings.worldScale;
  const g = buildWallRing(wall.shape, S, WALL_RING);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(g.positions, 3));
  geo.setIndex(new THREE.BufferAttribute(g.indices, 1));
  const T = opts.long.tuning;
  const R = WALL_RING;
  const uniforms = {
    ...opts.water,
    ...opts.fog,
    uSonar: { value: 0 },
    uSonarColor: opts.sonar.uSonarColor,
    uLongPulse: { value: opts.long.pulse },
    uLongAmp: { value: opts.long.amp },
    uLongWave: { value: new THREE.Vector4(T.speed, T.trail, T.front, T.range) },
    uRingLine: { value: new THREE.Vector3(T.contour, R.lineWidth, R.minPx) },
    uRing: { value: new THREE.Vector4(opts.far + R.gap, opts.far + R.gap + R.fade, g.y0, g.y1) },
    uRingEdge: { value: new THREE.Vector2(R.edgeBot, R.edgeTop) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    defines: { DM_LONG_N: opts.long.max },
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10; // after the terrain: hidden pixels fail the depth test early
  mesh.visible = false;
  mesh.name = "wall-ring";
  const w = wall.shape;
  const reach = Math.hypot(2 * (w.a + w.rc), 2 * (w.b + w.rc)) * S + 200;
  return {
    mesh,
    triangles: g.triangles,
    reach,
    update(sonar) {
      uniforms.uSonar.value = sonar;
      mesh.visible = sonar > 0.001;
    },
    dispose() {
      geo.dispose();
      material.dispose();
    },
  };
}
