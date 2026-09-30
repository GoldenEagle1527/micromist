/**
 * Renders the omen (omen.ts OmenChain) as a sonar-only silhouette: one additive,
 * depth-tested draw of ≈ 1.2k triangles (omenGeometry.ts), lit by the long sonar
 * pulses (sonarLong.ts). Not drawn unless the omen is present and a long pulse is alive.
 */
import * as THREE from "three";
import type { SonarPulses, SonarUniforms } from "../sonar";
import { CHAOS_LOOK } from "./config";
import type { OmenFrame } from "./omen";
import { buildOmenGeometry } from "./omenGeometry";
import { OMEN_FRAG, OMEN_VERT } from "./omenShader";

export type OmenMesh = {
  mesh: THREE.Mesh;
  triangles: number;
  /** Per frame: the omen state, 1 while a long pulse is alive (else 0) and the time (s). */
  update: (f: Readonly<OmenFrame>, sonar: number, time: number) => void;
  dispose: () => void;
};

export function createOmenMesh(opts: { sonar: SonarUniforms; long: SonarPulses }): OmenMesh {
  const O = CHAOS_LOOK.omen;
  const g = buildOmenGeometry();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(g.positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(g.normals, 3));
  geo.setAttribute("aSway", new THREE.BufferAttribute(g.sway, 1));
  geo.setAttribute("aPhase", new THREE.BufferAttribute(g.phase, 1));
  geo.setIndex(new THREE.BufferAttribute(g.indices, 1));
  const T = opts.long.tuning;
  const uniforms = {
    uOmen: { value: 0 },
    uTime: { value: 0 },
    uOmenSway: { value: new THREE.Vector2(O.sway.amp, O.sway.hz) },
    uOmenLook: { value: new THREE.Vector3(O.look.trail, O.look.front, O.look.rim) },
    uSonarColor: opts.sonar.uSonarColor,
    uLongPulse: { value: opts.long.pulse },
    uLongAmp: { value: opts.long.amp },
    uLongWave: { value: new THREE.Vector4(T.speed, T.trail, T.front, T.range) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: OMEN_VERT,
    fragmentShader: OMEN_FRAG,
    defines: { DM_LONG_N: opts.long.max },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 11;
  mesh.visible = false;
  mesh.name = "chaos-omen";
  return {
    mesh,
    triangles: g.triangles,
    update(f, sonar, time) {
      const k = f.presence * sonar;
      uniforms.uOmen.value = k;
      uniforms.uTime.value = time;
      mesh.visible = k > 0.001;
      if (!mesh.visible) return;
      mesh.position.set(f.x, f.y, f.z);
      mesh.rotation.set(0, -f.yaw, 0);
    },
    dispose() {
      geo.dispose();
      material.dispose();
    },
  };
}
