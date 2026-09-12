import * as THREE from "three";
import { createPointsMaterial } from "./glow";
import { clamp, createPathFrame, pathFrame, pathToWorld, type PathFrame } from "./path";

export type TunnelBudget = {
  strands: number;
  along: number;
  sparks: number;
};

export function tunnelBudget(mult: number): TunnelBudget {
  const m = clamp(mult, 0.7, 1.25);
  return {
    strands: 14,
    along: Math.round(220 * m),
    sparks: Math.round(380 * m),
  };
}

const CYAN = new THREE.Color(0x22d3ee);
const ICE = new THREE.Color(0xb8f4ff);
const MAGENTA = new THREE.Color(0xf0abfc);
const AMBER = new THREE.Color(0xfbbf24);

type Spark = {
  tOff: number;
  ang: number;
  rad: number;
  speed: number;
};

export function createTunnel(scene: THREE.Scene, map: THREE.Texture, budget: TunnelBudget) {
  const { strands, along, sparks } = budget;
  const filamentCount = strands * along;
  const positions = new Float32Array(filamentCount * 3);
  const colors = new Float32Array(filamentCount * 3);
  const color = new THREE.Color();

  for (let s = 0; s < strands; s += 1) {
    const lane = s % 5;
    if (lane === 3) color.copy(MAGENTA);
    else if (lane === 4) color.copy(AMBER);
    else color.copy(CYAN).lerp(ICE, (s % 3) * 0.18);
    for (let a = 0; a < along; a += 1) {
      const i = s * along + a;
      const flicker = 0.72 + ((a * 17 + s * 9) % 13) * 0.02;
      colors[i * 3] = color.r * flicker;
      colors[i * 3 + 1] = color.g * flicker;
      colors[i * 3 + 2] = color.b * flicker;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(geo, createPointsMaterial(map, 0.085, 0.92));
  points.frustumCulled = false;
  scene.add(points);

  const sparkPos = new Float32Array(sparks * 3);
  const sparkCol = new Float32Array(sparks * 3);
  const sparkList: Spark[] = [];
  for (let i = 0; i < sparks; i += 1) {
    const warm = Math.random() > 0.72;
    color.copy(warm ? AMBER : ICE).lerp(CYAN, Math.random() * 0.4);
    sparkCol[i * 3] = color.r;
    sparkCol[i * 3 + 1] = color.g;
    sparkCol[i * 3 + 2] = color.b;
    sparkList.push({
      tOff: Math.random() * 48,
      ang: Math.random() * Math.PI * 2,
      rad: 0.15 + Math.random() * 2.1,
      speed: 0.7 + Math.random() * 1.6,
    });
  }
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute("color", new THREE.BufferAttribute(sparkCol, 3));
  const sparkPoints = new THREE.Points(sparkGeo, createPointsMaterial(map, 0.055, 0.88));
  sparkPoints.frustumCulled = false;
  scene.add(sparkPoints);

  const scratch: PathFrame = createPathFrame();
  const p = new THREE.Vector3();
  const span = 50;
  const near = -2.4;

  const update = (travel: number, origin: THREE.Vector3, speed: number, dt: number) => {
    const arr = (points.geometry.getAttribute("position") as THREE.BufferAttribute)
      .array as Float32Array;

    for (let a = 0; a < along; a += 1) {
      const t = travel + near + (a / Math.max(1, along - 1)) * span;
      pathFrame(t, scratch);
      for (let s = 0; s < strands; s += 1) {
        const braid = s * 0.45;
        const weave = Math.sin(t * 0.55 + braid) * 0.14;
        const twist = t * 0.41 + (s / strands) * Math.PI * 2 + Math.sin(t * 0.2 + s) * 0.12;
        const radius = 2.08 + weave + (s % 2) * 0.07;
        const lx = Math.cos(twist) * radius;
        const ly = Math.sin(twist) * radius * 0.8;
        pathToWorld(scratch, lx, ly, p).sub(origin);
        const i = (s * along + a) * 3;
        arr[i] = p.x;
        arr[i + 1] = p.y;
        arr[i + 2] = p.z;
      }
    }
    (points.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;

    const sarr = (sparkPoints.geometry.getAttribute("position") as THREE.BufferAttribute)
      .array as Float32Array;
    const rush = 8 + speed * 0.55;
    for (let i = 0; i < sparks; i += 1) {
      const sp = sparkList[i]!;
      sp.tOff -= rush * dt * sp.speed;
      if (sp.tOff < near) {
        sp.tOff = span - Math.random() * 6;
        sp.ang = Math.random() * Math.PI * 2;
        sp.rad = 0.12 + Math.random() * 2.15;
      }
      const t = travel + sp.tOff;
      pathFrame(t, scratch);
      pathToWorld(scratch, Math.cos(sp.ang) * sp.rad, Math.sin(sp.ang) * sp.rad * 0.78, p).sub(
        origin,
      );
      sarr[i * 3] = p.x;
      sarr[i * 3 + 1] = p.y;
      sarr[i * 3 + 2] = p.z;
    }
    (sparkPoints.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  };

  const dispose = () => {
    scene.remove(points);
    scene.remove(sparkPoints);
    points.geometry.dispose();
    sparkPoints.geometry.dispose();
    (points.material as THREE.Material).dispose();
    (sparkPoints.material as THREE.Material).dispose();
  };

  return { update, dispose, pointCount: filamentCount + sparks };
}

export type TunnelHandle = ReturnType<typeof createTunnel>;
