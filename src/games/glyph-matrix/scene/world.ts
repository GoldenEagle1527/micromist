import * as THREE from "three";
import type { GlyphMatrixOptions } from "../types";
import {
  CHUNK_COUNT,
  CHUNK_Z,
  CORRIDOR_HALF,
  PITCH,
  createDualLayers,
  type GlyphLayer,
} from "./layers";

export type WorldHandle = {
  setPointerNdc: (nx: number, ny: number) => void;
  clearPointer: () => void;
  update: (dt: number) => void;
  dispose: () => void;
};

const MAX_RISE = 0.55;
const BULGE_SIGMA = 1.85;
const LOOK_YAW = 0.12;
const LOOK_PITCH = 0.08;

export function createWorld(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  options: GlyphMatrixOptions,
): WorldHandle {
  const driftSpeed = options.driftSpeed ?? 1.15;
  const layers = createDualLayers(scene);
  const { floor, ceiling } = layers;

  // Cooler neutral gray-dark — no thick cyan fog soup
  const bg = 0x1a1c1f;
  scene.background = new THREE.Color(bg);
  scene.fog = new THREE.FogExp2(bg, 0.028);

  const amb = new THREE.AmbientLight(0xb8bac0, 0.42);
  scene.add(amb);
  const hemi = new THREE.HemisphereLight(0xe8eaee, 0x2e3034, 0.45);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff8f0, 1.05);
  key.position.set(2.8, 3.6, 2.2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x8a8e96, 0.28);
  fill.position.set(-3.2, -1.8, 1.4);
  scene.add(fill);

  // Subtle matte corridor edge guides (no additive glow)
  const ribbonGeo = new THREE.BoxGeometry(0.06, 0.04, 80);
  const ribbonMat = new THREE.MeshStandardMaterial({
    color: 0x4a4d52,
    roughness: 0.9,
    metalness: 0.05,
  });
  const ribbonL = new THREE.Mesh(ribbonGeo, ribbonMat);
  ribbonL.position.set(-((11 - 1) * 0.5) * PITCH - 0.55, 0, 20);
  const ribbonR = ribbonL.clone();
  ribbonR.position.x *= -1;
  scene.add(ribbonL, ribbonR);

  const pointerNdc = new THREE.Vector2(0, 0);
  let hasPointer = false;
  const raycaster = new THREE.Raycaster();
  const floorPlane = new THREE.Plane(
    new THREE.Vector3(0, 1, 0),
    CORRIDOR_HALF,
  ); // y = -CORRIDOR_HALF → n·p + c = 0 with n=(0,1,0), c=CORRIDOR_HALF
  const ceilPlane = new THREE.Plane(
    new THREE.Vector3(0, -1, 0),
    CORRIDOR_HALF,
  ); // y = +CORRIDOR_HALF
  const hitFloor = new THREE.Vector3();
  const hitCeil = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();

  let camZ = 2.5;
  let chunkOriginZ = 0;
  const chunkSpan = CHUNK_COUNT * CHUNK_Z * PITCH;

  camera.position.set(0, 0, camZ);
  camera.lookAt(0, 0, camZ + 8);

  const projectLayer = (
    plane: THREE.Plane,
    out: THREE.Vector3,
  ): THREE.Vector3 | null => {
    raycaster.setFromCamera(pointerNdc, camera);
    const ok = raycaster.ray.intersectPlane(plane, out);
    return ok ? out : null;
  };

  const recycleChunksIfNeeded = () => {
    // Keep camera near middle of streamed window
    const mid = chunkOriginZ + chunkSpan * 0.45;
    if (camZ > mid + chunkSpan * 0.2) {
      chunkOriginZ += CHUNK_Z * PITCH;
      floor.setChunkOriginZ(chunkOriginZ);
      ceiling.setChunkOriginZ(chunkOriginZ);
    }
  };

  const setPointerNdc = (nx: number, ny: number) => {
    pointerNdc.set(nx, ny);
    hasPointer = true;
  };

  const clearPointer = () => {
    hasPointer = false;
  };

  const update = (dt: number) => {
    const d = Math.min(0.05, Math.max(0, dt));
    camZ += driftSpeed * d;
    recycleChunksIfNeeded();

    let floorHit: THREE.Vector3 | null = null;
    let ceilHit: THREE.Vector3 | null = null;
    if (hasPointer) {
      floorHit = projectLayer(floorPlane, hitFloor);
      ceilHit = projectLayer(ceilPlane, hitCeil);
      // Prefer nearer for mild camera look
      const use =
        floorHit && ceilHit
          ? camera.position.distanceToSquared(floorHit) <=
            camera.position.distanceToSquared(ceilHit)
            ? floorHit
            : ceilHit
          : floorHit ?? ceilHit;
      if (use) {
        lookTarget.lerp(
          new THREE.Vector3(
            THREE.MathUtils.clamp(use.x * LOOK_YAW * 4, -1.2, 1.2),
            THREE.MathUtils.clamp(use.y * LOOK_PITCH * 2, -0.35, 0.35),
            camZ + 10,
          ),
          1 - Math.exp(-d * 6),
        );
      }
    } else {
      lookTarget.lerp(new THREE.Vector3(0, 0, camZ + 10), 1 - Math.exp(-d * 3));
    }

    camera.position.set(
      lookTarget.x * 0.15,
      lookTarget.y * 0.2,
      camZ,
    );
    camera.lookAt(lookTarget.x * 0.4, lookTarget.y * 0.35, camZ + 12);

    // Bulge both layers from their plane hits (or clear)
    floor.updateBulge(hasPointer ? floorHit : null, d, BULGE_SIGMA, MAX_RISE);
    ceiling.updateBulge(hasPointer ? ceilHit : null, d, BULGE_SIGMA, MAX_RISE);

    // Keep ribbons with camera
    ribbonL.position.z = camZ + 18;
    ribbonR.position.z = camZ + 18;
  };

  // Initial sync
  floor.setChunkOriginZ(0);
  ceiling.setChunkOriginZ(0);

  return {
    setPointerNdc,
    clearPointer,
    update,
    dispose: () => {
      layers.dispose();
      scene.remove(amb, hemi, key, fill, ribbonL, ribbonR);
      ribbonGeo.dispose();
      ribbonMat.dispose();
    },
  };
}

/** Expose for HUD / debug if needed */
export type { GlyphLayer };
