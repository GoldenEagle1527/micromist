import * as THREE from "three";

type Particle = {
  alive: boolean;
  life: number;
  maxLife: number;
  vx: number;
  vy: number;
  vz: number;
  mesh: THREE.Mesh;
};

const POOL = 64;
const GEO = new THREE.BoxGeometry(0.12, 0.12, 0.12);

export function createParticlePool(scene: THREE.Scene) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    depthWrite: false,
  });
  const pool: Particle[] = [];
  for (let i = 0; i < POOL; i += 1) {
    const mesh = new THREE.Mesh(GEO, mat.clone());
    mesh.visible = false;
    scene.add(mesh);
    pool.push({
      alive: false,
      life: 0,
      maxLife: 1,
      vx: 0,
      vy: 0,
      vz: 0,
      mesh,
    });
  }

  const burst = (
    origin: THREE.Vector3,
    color: number,
    count: number,
    speed = 4,
  ) => {
    let spawned = 0;
    for (const p of pool) {
      if (spawned >= count) break;
      if (p.alive) continue;
      p.alive = true;
      p.maxLife = 0.35 + Math.random() * 0.35;
      p.life = p.maxLife;
      p.vx = (Math.random() - 0.5) * speed;
      p.vy = (Math.random() - 0.5) * speed;
      p.vz = (Math.random() - 0.5) * speed * 0.6;
      p.mesh.visible = true;
      p.mesh.position.copy(origin);
      const m = p.mesh.material as THREE.MeshBasicMaterial;
      m.color.setHex(color);
      m.opacity = 1;
      p.mesh.scale.setScalar(0.7 + Math.random() * 0.8);
      spawned += 1;
    }
  };

  const update = (dt: number) => {
    for (const p of pool) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        p.mesh.visible = false;
        continue;
      }
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.vz *= 0.96;
      const m = p.mesh.material as THREE.MeshBasicMaterial;
      m.opacity = Math.max(0, p.life / p.maxLife);
    }
  };

  const dispose = () => {
    for (const p of pool) {
      scene.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
    }
    GEO.dispose();
  };

  return { burst, update, dispose };
}

export type ParticlePool = ReturnType<typeof createParticlePool>;
