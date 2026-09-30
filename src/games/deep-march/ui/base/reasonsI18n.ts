/** Why a building can't be placed (build mode, plan M5): one line per BuildReason, zh / en. */
import type { BuildReason } from "../../scene/base/buildMode";

export const reasonsEn: Record<BuildReason, string> = {
  ok: "Can be placed here",
  "no-core": "Build the base core first",
  "has-core": "The base core already stands",
  wall: "Too close to the ring wall",
  radius: "Outside the base's protection radius",
  grid: "Too far from the core / an energy tower",
  overlap: "Overlaps another building",
  limit: "Building limit reached",
  cost: "Not enough particles",
  "no-ground": "No seabed in reach",
  slope: "Ground too steep",
  rough: "Ground too rough",
  clearance: "Not enough open water above",
  blend: "Too close to a region border",
  frozen: "The frozen zone here would disturb the terrain",
};

export const reasonsZh: Record<BuildReason, string> = {
  ok: "可以放置",
  "no-core": "请先建造基地核心",
  "has-core": "基地核心已建成",
  wall: "离环壁太近",
  radius: "超出基地保护半径",
  grid: "离核心 / 储能塔太远",
  overlap: "与其他建筑重叠",
  limit: "建筑数量已达上限",
  cost: "粒子不足",
  "no-ground": "瞄准范围内没有海床",
  slope: "地面太陡",
  rough: "地面太崎岖",
  clearance: "上方水域不够开阔",
  blend: "离区域边界太近",
  frozen: "此处的冻结区会破坏地形",
};
