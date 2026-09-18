import * as THREE from "three";
import {
  createGlyphAtlas,
  type GlyphAtlas,
  ATLAS_COLS,
  ATLAS_ROWS,
} from "./atlas";
import {
  glyphFragmentColor,
  glyphFragmentNormal,
  glyphFragmentPars,
  glyphVertexMain,
  glyphVertexPars,
} from "./shaders";

export const CUBE = 0.92;
export const GAP = 0.14; // spacing between cube edges
export const PITCH = CUBE + GAP;
/** Half-gap of the corridor (distance from centerline to inner cube face). */
export const CORRIDOR_HALF = 1.55;
export const GRID_X = 11;
export const CHUNK_Z = 14;
export const CHUNK_COUNT = 5;

export type LayerKind = "floor" | "ceiling";

export type GlyphLayer = {
  kind: LayerKind;
  mesh: THREE.InstancedMesh;
  baseY: Float32Array;
  curY: Float32Array;
  targetLift: Float32Array;
  gx: Int16Array;
  gz: Int16Array;
  count: number;
  dispose: () => void;
  setChunkOriginZ: (originZ: number) => void;
  updateBulge: (
    hit: THREE.Vector3 | null,
    dt: number,
    sigma: number,
    maxRise: number,
  ) => void;
  syncMatrices: () => void;
};

type LayerUniforms = {
  uAtlas: { value: THREE.Texture };
  uAtlasCols: { value: number };
  uAtlasRows: { value: number };
  uAtlasSize: { value: THREE.Vector2 };
  uLayerSign: { value: number };
  uTime: { value: number };
  uAccent: { value: THREE.Color };
};

function makeMaterial(
  atlas: GlyphAtlas,
  layerSign: number,
  accent: THREE.Color,
): { mat: THREE.MeshStandardMaterial; uniforms: LayerUniforms } {
  const uniforms: LayerUniforms = {
    uAtlas: { value: atlas.texture },
    uAtlasCols: { value: atlas.cols },
    uAtlasRows: { value: atlas.rows },
    uAtlasSize: {
      value: new THREE.Vector2(
        atlas.texture.image.width,
        atlas.texture.image.height,
      ),
    },
    uLayerSign: { value: layerSign },
    uTime: { value: 0 },
    uAccent: { value: accent.clone() },
  };

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.88,
    metalness: 0.04,
    emissive: 0x000000,
    emissiveIntensity: 0,
    toneMapped: true,
  });

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
${glyphVertexPars}`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
${glyphVertexMain}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
${glyphFragmentPars}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
${glyphFragmentColor}`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
${glyphFragmentNormal}`,
      );
  };
  mat.customProgramCacheKey = () => `glyph-matrix-matte-v2-${layerSign}`;

  return { mat, uniforms };
}

function hashGlyph(gx: number, gz: number, salt: number): number {
  let n = gx * 374761393 + gz * 668265263 + salt * 1274126177;
  n = (n ^ (n >>> 13)) * 1274126177;
  n = n ^ (n >>> 16);
  return Math.abs(n) % (ATLAS_COLS * ATLAS_ROWS);
}

export function createLayer(
  scene: THREE.Scene,
  kind: LayerKind,
  atlas: GlyphAtlas,
  accent: THREE.Color,
): GlyphLayer {
  const layerSign = kind === "floor" ? 1 : -1;
  // Inner face sits at ±CORRIDOR_HALF from center; cube center offset by half cube
  const innerY = kind === "floor" ? -CORRIDOR_HALF : CORRIDOR_HALF;
  const centerY =
    kind === "floor" ? innerY - CUBE * 0.5 : innerY + CUBE * 0.5;

  const perChunk = GRID_X * CHUNK_Z;
  const count = perChunk * CHUNK_COUNT;
  const geo = new THREE.BoxGeometry(CUBE, CUBE, CUBE);
  const { mat, uniforms } = makeMaterial(atlas, layerSign, accent);

  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const aGlyph = new Float32Array(count);
  const aTint = new Float32Array(count);
  const baseY = new Float32Array(count);
  const curY = new Float32Array(count);
  const targetLift = new Float32Array(count);
  const gxArr = new Int16Array(count);
  const gzArr = new Int16Array(count);

  const halfX = (GRID_X - 1) * 0.5;
  let write = 0;
  for (let c = 0; c < CHUNK_COUNT; c += 1) {
    for (let iz = 0; iz < CHUNK_Z; iz += 1) {
      for (let ix = 0; ix < GRID_X; ix += 1) {
        const gx = ix;
        const gz = c * CHUNK_Z + iz;
        gxArr[write] = gx;
        gzArr[write] = gz;
        aGlyph[write] = hashGlyph(gx, gz, kind === "floor" ? 3 : 7);
        aTint[write] = 0.35 + 0.65 * ((hashGlyph(gx, gz, 99) % 100) / 100);
        baseY[write] = centerY;
        curY[write] = centerY;
        targetLift[write] = 0;
        write += 1;
      }
    }
  }

  geo.setAttribute("aGlyph", new THREE.InstancedBufferAttribute(aGlyph, 1));
  geo.setAttribute("aTint", new THREE.InstancedBufferAttribute(aTint, 1));

  const dummy = new THREE.Object3D();
  let chunkOriginZ = 0;

  const worldX = (gx: number) => (gx - halfX) * PITCH;
  const worldZ = (gzLocal: number) => chunkOriginZ + gzLocal * PITCH;

  const syncMatrices = () => {
    for (let i = 0; i < count; i += 1) {
      dummy.position.set(worldX(gxArr[i]!), curY[i]!, worldZ(gzArr[i]!));
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };

  const setChunkOriginZ = (originZ: number) => {
    chunkOriginZ = originZ;
    // Remap gz into sliding window [0, CHUNK_COUNT*CHUNK_Z)
    const span = CHUNK_COUNT * CHUNK_Z;
    for (let i = 0; i < count; i += 1) {
      // Keep local indices; worldZ uses origin — when recycling, bump glyph variety
      const absGz = Math.floor(originZ / PITCH) + gzArr[i]!;
      aGlyph[i] = hashGlyph(gxArr[i]!, absGz, kind === "floor" ? 3 : 7);
    }
    (geo.getAttribute("aGlyph") as THREE.InstancedBufferAttribute).needsUpdate =
      true;
    // silence unused
    void span;
    syncMatrices();
  };

  const updateBulge = (
    hit: THREE.Vector3 | null,
    dt: number,
    sigma: number,
    maxRise: number,
  ) => {
    const invTwoSigma2 = 1 / (2 * sigma * sigma);
    const riseSign = kind === "floor" ? 1 : -1; // toward corridor center
    for (let i = 0; i < count; i += 1) {
      let target = 0;
      if (hit) {
        const dx = worldX(gxArr[i]!) - hit.x;
        const dz = worldZ(gzArr[i]!) - hit.z;
        const d2 = dx * dx + dz * dz;
        target = maxRise * Math.exp(-d2 * invTwoSigma2);
      }
      // Smooth toward target
      const curLift = (curY[i]! - baseY[i]!) * riseSign;
      const next =
        curLift + (target - curLift) * Math.min(1, 1 - Math.exp(-dt * 10));
      targetLift[i] = target;
      curY[i] = baseY[i]! + next * riseSign;
    }
    uniforms.uTime.value += dt;
    syncMatrices();
  };

  setChunkOriginZ(0);

  return {
    kind,
    mesh,
    baseY,
    curY,
    targetLift,
    gx: gxArr,
    gz: gzArr,
    count,
    setChunkOriginZ,
    updateBulge,
    syncMatrices,
    dispose: () => {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
    },
  };
}

export function createDualLayers(scene: THREE.Scene): {
  atlas: GlyphAtlas;
  floor: GlyphLayer;
  ceiling: GlyphLayer;
  accent: THREE.Color;
  dispose: () => void;
} {
  const atlas = createGlyphAtlas();
  // Cool neutral ink accent (not cyan glow)
  const accent = new THREE.Color(0x3a3d42);
  const floor = createLayer(scene, "floor", atlas, accent);
  const ceiling = createLayer(scene, "ceiling", atlas, accent);
  return {
    atlas,
    floor,
    ceiling,
    accent,
    dispose: () => {
      floor.dispose();
      ceiling.dispose();
      atlas.texture.dispose();
    },
  };
}
