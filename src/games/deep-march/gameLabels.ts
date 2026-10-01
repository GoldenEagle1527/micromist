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
    stateSwim: dm.stateSwim,
    contactFloor: dm.hudGrounded,
    contactCeiling: dm.hudCeiling,
    contactWall: dm.hudScrape,
    regionTitle: dm.hudRegion,
    regionEnter: dm.regionEnter,
    regions: dm.regionNames,
    battery: dm.hudBattery,
    lightOff: dm.lightOff,
    lightModes: dm.lightModes,
    batteryEmpty: dm.batteryEmpty,
    batteryLow: dm.batteryLow,
    btnUp: dm.btnUp,
    btnDown: dm.btnDown,
    btnLamp: dm.btnLamp,
    btnPing: dm.btnPing,
    sonar: dm.sonarHud,
    dialMove: dm.dialMove,
    menu: dm.menu,
    controls: dm.controls,
    conserveControls: dm.setup.conserveControls,
    seedNow: dm.seedNow,
    expedition: dm.expedition,
    base: dm.base,
    tide: dm.tide,
    gaze: dm.gaze,
    hints: dm.hints,
  };
}
