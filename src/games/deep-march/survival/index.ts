/**
 * Survival layer for Deep March: resources, gear and the systems that use them.
 * `createSurvival()` wires the default loadout; the scene ticks it every frame.
 */
import { SURVIVAL_TUNING } from "./config";
import { CapacityStorage, Equipment } from "./items";
import { LightController } from "./lightModes";
import { ResourceSystem } from "./resources";

export { SURVIVAL_TUNING } from "./config";
export { ResourceSystem, type ResourceView, type ResourceSnapshot, type ResourceEvent } from "./resources";
export { CapacityStorage, Equipment, ITEMS, type ItemId, type ItemStack, type Storage, type EquipSlot } from "./items";
export { LightController, LIGHT_MODES, type LightMode, type LightState } from "./lightModes";

export type Survival = {
  resources: ResourceSystem;
  backpack: CapacityStorage;
  equipment: Equipment;
  lights: LightController;
  tick: (dt: number) => void;
  dispose: () => void;
};

export function createSurvival(): Survival {
  const resources = new ResourceSystem();
  const b = SURVIVAL_TUNING.battery;
  resources.register({ id: "battery", capacity: b.capacity, regen: b.regen, regenDelay: b.regenDelay, flags: ["persist", "hud"] });

  // Default loadout: head lamp + night-vision goggles, worn.
  const backpack = new CapacityStorage(12);
  const equipment = new Equipment(backpack);
  backpack.add("head-lamp");
  backpack.add("nv-goggles");
  equipment.equip("head-lamp");
  equipment.equip("nv-goggles");

  const lights = new LightController(resources, equipment);
  return {
    resources,
    backpack,
    equipment,
    lights,
    tick: (dt) => resources.tick(dt),
    dispose: () => {
      lights.dispose();
      resources.dispose();
    },
  };
}
