/** Deep March scene: renderer, underwater look, chunked terrain, first-person sub loop. */
import * as THREE from "three";
import { SEA_COLORS, isLowSpecDevice, terrainForDevice } from "../terrain/config";
import { createDensityField } from "../terrain/density";
import { ChunkManager } from "../terrain/chunks";
import { InputController } from "./input";
import { MarineSnow } from "./particles";
import { createSeabedMaterial } from "./seabedMaterial";
import { SubController } from "./submarine";

export type HudLabels = {
  depth: string;
  speed: string;
  heading: string;
  chunks: string;
  loading: string;
  contactFloor: string;
  contactCeiling: string;
  contactWall: string;
};

export type DeepMarchOptions = {
  seed: number;
  invertPitch: boolean;
  labels: HudLabels;
};

export type DeepMarchHandle = {
  destroy: () => void;
  setThrottleHold: (v: number) => void;
  setBoost: (v: boolean) => void;
};

export function createDeepMarch(host: HTMLElement, opts: DeepMarchOptions): DeepMarchHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  host.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = "none";

  const overlay = document.createElement("div");
  overlay.className = "dm-overlay";
  host.appendChild(overlay);
  const hud = document.createElement("div");
  hud.className = "dm-hud";
  overlay.appendChild(hud);
  const stats = document.createElement("div");
  stats.className = "dm-stats";
  overlay.appendChild(stats);
  const loading = document.createElement("div");
  loading.className = "dm-loading";
  loading.textContent = opts.labels.loading;
  overlay.appendChild(loading);

  const lowSpec = isLowSpecDevice();
  const terrain = terrainForDevice(lowSpec);

  // Underwater look — reference: fog == camera background (0, .168, .453), linear fog to viewDistance * .81.
  const fogColor = new THREE.Color().setRGB(SEA_COLORS.fog[0], SEA_COLORS.fog[1], SEA_COLORS.fog[2], THREE.SRGBColorSpace);
  const scene = new THREE.Scene();
  scene.background = fogColor;
  scene.fog = new THREE.Fog(fogColor, 1.5, terrain.viewDistance * SEA_COLORS.fogDstMultiplier);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, terrain.viewDistance + 12);

  // Down-welling light: teal sky fill from above, very dark from below,
  // plus a blue-green filtered "sun" from the surface.
  const ambient = new THREE.HemisphereLight(0x3f86a6, 0x0a1426, 0.95);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(new THREE.Color(0.55, 0.85, 1.0), 1.05);
  sun.position.set(0.25, 1, 0.15);
  scene.add(sun);

  let texturesReady = false;
  const seabed = createSeabedMaterial({
    lowSpec,
    anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()),
    onReady: () => {
      texturesReady = true;
    },
  });
  const terrainMat = seabed.material;

  const field = createDensityField(opts.seed, terrain);
  const chunks = new ChunkManager(scene, field, opts.seed, terrainMat);

  const sub = new SubController(field, (x, y, z) => chunks.isRemoved(x, y, z));
  sub.spawn(0, 0);
  // Optional viewpoint for sharing / screenshots: ?at=x,y,z,yawDeg,pitchDeg (starts stopped).
  const at = new URLSearchParams(window.location.search).get("at");
  if (at) {
    const v = at.split(",").map(Number);
    if (v.length >= 3 && v.every(Number.isFinite)) {
      sub.position.set(v[0], v[1], v[2]);
      sub.yaw = ((v[3] ?? 0) * Math.PI) / 180;
      sub.pitch = ((v[4] ?? 0) * Math.PI) / 180;
      sub.speed = 0;
      sub.update(0, { pitch: 0, yaw: 0, throttle: 0, boost: false, throttleImpulse: 0 });
    }
  }
  // First person: the camera *is* the sub. Headlight rides on the camera
  // (reference: spot, colour (1, .88, .40), range 60, angle 46°).
  const headlight = new THREE.SpotLight(new THREE.Color(1, 0.93, 0.78), 9, 45, THREE.MathUtils.degToRad(32), 0.8, 1.3);
  headlight.position.set(0, -0.12, 0);
  headlight.target.position.set(0, -0.4, -5);
  camera.add(headlight, headlight.target);
  scene.add(camera);

  const syncCamera = () => {
    camera.position.copy(sub.position);
    camera.quaternion.copy(sub.quaternion);
  };
  syncCamera();

  const snow = new MarineSnow(900, opts.seed);
  scene.add(snow.points);

  const input = new InputController(renderer.domElement, overlay, {
    invertPitch: opts.invertPitch,
  });

  const resize = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  let ready = false;
  let raf = 0;
  let last = performance.now();
  let hudTimer = 0;
  let fpsFrames = 0;
  let fpsTime = 0;
  let fps = 0;

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const inp = input.read();
    if (ready) {
      sub.update(dt, inp);
    } else if (texturesReady && chunks.nearReady(sub.position, 14)) {
      ready = true;
      loading.classList.add("done");
    }
    syncCamera();
    chunks.update(sub.position, camera, dt);
    snow.update(camera.position, dt);
    seabed.update(now / 1000);

    renderer.render(scene, camera);

    fpsFrames++;
    fpsTime += dt;
    if (fpsTime >= 0.5) {
      fps = fpsFrames / fpsTime;
      fpsFrames = 0;
      fpsTime = 0;
    }
    hudTimer -= dt;
    if (hudTimer <= 0) {
      hudTimer = 0.15;
      const L = opts.labels;
      const c = sub.contact;
      const contact = c === "floor" ? L.contactFloor : c === "ceiling" ? L.contactCeiling : c === "wall" ? L.contactWall : "";
      const heading = ((((-sub.yaw * 180) / Math.PI) % 360) + 360) % 360;
      hud.innerHTML =
        `<span>${L.depth} <b>${(100 - sub.position.y).toFixed(1)} m</b></span>` +
        `<span>${L.speed} <b>${sub.speed.toFixed(1)}</b></span>` +
        `<span>${L.heading} <b>${heading.toFixed(0).padStart(3, "0")}°</b></span>` +
        (contact ? `<span class="dm-bump">${contact}</span>` : "");
      const s = chunks.stats();
      stats.textContent = `${fps.toFixed(0)} fps · ${L.chunks} ${s.meshes}/${s.active} · −${s.floaters} float · q${s.queued}+${s.pending} · ${(s.triangles / 1000).toFixed(0)}k tri · ${s.workers ? `${s.workers}w` : "main"} ${s.avgMs.toFixed(1)}ms`;
    }
  };
  raf = requestAnimationFrame(frame);

  return {
    setThrottleHold: (v) => {
      input.throttleHold = v;
    },
    setBoost: (v) => {
      input.boostHold = v;
    },
    destroy: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      input.dispose();
      chunks.dispose();
      snow.dispose();
      headlight.dispose();
      seabed.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      overlay.remove();
    },
  };
}
