/** UI strings handed to the dive (canvas overlay), the loading screen and the control panel. */
import type { DeepMarchDict } from "./i18n";
import type { HudLabels } from "./scene/world";
import type { PanelLabels } from "./ui/ControlPanel";
import type { LoadingLabels } from "./ui/loading/LoadingScreen";

export function hudLabels(dm: DeepMarchDict): HudLabels {
  return {
    chunks: dm.hudChunks,
    floaters: dm.hudFloaters,
    tris: dm.hudTris,
    mainThread: dm.hudMainThread,
    classify: dm.hudClassify,
    spawnDebugTitle: dm.spawnDebugTitle,
    surfaceTypes: dm.surfaceTypes,
    regionDebugTitle: dm.regionDebugTitle,
    regionNames: dm.regionNames,
    regionEdge: dm.regionEdge,
    lockPrompt: dm.lockPrompt,
    gpuLost: dm.gpuLost,
    shaderFailed: dm.shaderFailed,
  };
}

export function loadingLabels(dm: DeepMarchDict): LoadingLabels {
  return { ...dm.loading, regionNames: dm.regionNames, lightModes: dm.lightModes, mapCache: dm.expedition.mapCache };
}

export function panelLabels(dm: DeepMarchDict): PanelLabels {
  return {
    depth: dm.hudDepth,
    speed: dm.hudSpeed,
    heading: dm.hudHeading,
    stateSwim: dm.stateSwim,
    stateHover: dm.stateHover,
    contactFloor: dm.hudGrounded,
    contactCeiling: dm.hudCeiling,
    contactWall: dm.hudScrape,
    terrainTitle: dm.hudTerrain,
    terrain: dm.terrainKinds,
    regionTitle: dm.hudRegion,
    regions: dm.regionNames,
    battery: dm.hudBattery,
    lightOff: dm.lightOff,
    lightModes: dm.lightModes,
    batteryEmpty: dm.batteryEmpty,
    batteryCharging: dm.batteryCharging,
    btnUp: dm.btnUp,
    btnDown: dm.btnDown,
    btnSwim: dm.btnSwim,
    btnLamp: dm.btnLamp,
    dialMove: dm.dialMove,
    showPanel: dm.showPanel,
    hidePanel: dm.hidePanel,
    exit: dm.exit,
    flip: dm.flip,
    mute: dm.mute,
    unmute: dm.unmute,
    expedition: dm.expedition,
    base: dm.base,
    tide: dm.tide,
    hints: dm.hints,
  };
}
