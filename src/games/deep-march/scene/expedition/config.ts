/**
 * Expedition scene tunables (plan M4): node / cache drawing, placement budget,
 * absorb reach, emergency recall, cache beacon. Rules (tank size, absorb rates,
 * cache limit) live in conserve/config.ts; the battery drain in survival/config.ts.
 */
import * as THREE from "three";

const lin = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);

export const NODE_VIEW = {
  /** Nodes and caches are drawn within this radius (they shrink into the rock over the last `fadeBand`). */
  radius: 170,
  fadeBand: 50,
  /** One instanced draw: at most this many (caches always included). */
  maxInstances: 96,
  /** Sites are placed once their point is this close (radius + a site's search disc + margin). */
  prefetch: 420,
  /** Placement budget per frame, ms (desktop / phone). */
  budgetMs: 2.5,
  budgetMsLow: 1.5,
  /** Nodes sit this far into the rock (hides the coarse LOD surface a little further out). */
  sink: 0.3,
  /** Scale of a node of meanSize particles; grows with √(amount / 50). */
  scale: 1.1,
  /** A node shrinks as it is absorbed: scale × (minFill + (1 − minFill) · √(left / amount)). */
  minFill: 0.2,
  /** Seconds a new instance takes to grow in (placement landing near the diver never pops). */
  growIn: 1.2,
  cacheScale: 1.25,
  /** Linear emissive tint per particle kind (storage order), and for caches. */
  kindTint: [lin(0.55, 0.72, 0.95), lin(0.7, 0.86, 1), lin(0.25, 0.9, 1), lin(0.36, 0.46, 1), lin(0.55, 0.75, 1), lin(0.62, 0.45, 1), lin(0.25, 0.35, 0.95)] as readonly THREE.Color[],
  cacheTint: lin(0.75, 0.97, 1),
  /** Diffuse body (deep blue glass). */
  body: lin(0.08, 0.13, 0.24),
  /** Blinn-Phong glints on the facets. */
  specular: lin(0.35, 0.45, 0.6),
  shininess: 48,
  glow: 1.6,
  /** Extra glow on the target while aiming / absorbing. */
  targetGlow: 1.2,
  absorbGlow: 2.4,
  /** Echo strength in sonar mode (nodes read as bright points on every ping). */
  sonarEcho: 0.9,
} as const;

export const ABSORB = {
  /** Reach from the eye to the node's surface point, m. */
  reach: 4.5,
  /** Aim cone (cos of the half-angle) beyond `closeReach`. */
  cone: Math.cos(THREE.MathUtils.degToRad(32)),
  closeReach: 1.8,
} as const;

export const RECALL = {
  /** Hold to fire the emergency beacon (the M4 stand-in for dying: no oxygen / creatures yet). */
  holdSeconds: 2,
  /** Black screen: fade out, hold (the diver is moved), fade in. */
  fadeOut: 0.6,
  hold: 0.8,
  fadeIn: 1.2,
  /** "Cache left" message on the HUD, seconds. */
  notice: 6,
} as const;

export const BEACON = {
  /** A lost cache ticks every `period` s (glow flash + faint sonar tick within `audible` m). */
  period: 5,
  audible: 260,
  gain: 0.16,
} as const;
