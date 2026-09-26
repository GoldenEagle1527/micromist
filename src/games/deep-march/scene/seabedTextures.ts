/**
 * Seabed texture sets (sand / gravel / rock / moss: albedo + packed normal, whose
 * b channel is roughness). Primary: KTX2 / Basis UASTC with a full mip chain
 * (assets/ktx2, regenerate with scripts/deep-march-ktx2.sh), transcoded to the
 * GPU's block format (BC7 / ASTC / ETC2: 1 byte per texel instead of 4, no mip
 * generation at load). Fallback per texture: the WebP originals (if the
 * transcoder or a file fails, or takes too long). Colour spaces and sampling
 * state are the same either way: albedo sRGB, normals linear, repeat wrap,
 * trilinear + anisotropy (the shader samples with textureGrad).
 */
import * as THREE from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

import sandAlb1024 from "../assets/sand_albedo_1024.webp?url";
import sandNrm1024 from "../assets/sand_nrm_1024.webp?url";
import gravelAlb1024 from "../assets/gravel_albedo_1024.webp?url";
import gravelNrm1024 from "../assets/gravel_nrm_1024.webp?url";
import rockAlb1024 from "../assets/rock_albedo_1024.webp?url";
import rockNrm1024 from "../assets/rock_nrm_1024.webp?url";
import mossAlb1024 from "../assets/moss_albedo_1024.webp?url";
import mossNrm1024 from "../assets/moss_nrm_1024.webp?url";
import sandAlb512 from "../assets/sand_albedo_512.webp?url";
import sandNrm512 from "../assets/sand_nrm_512.webp?url";
import gravelAlb512 from "../assets/gravel_albedo_512.webp?url";
import gravelNrm512 from "../assets/gravel_nrm_512.webp?url";
import rockAlb512 from "../assets/rock_albedo_512.webp?url";
import rockNrm512 from "../assets/rock_nrm_512.webp?url";
import mossAlb512 from "../assets/moss_albedo_512.webp?url";
import mossNrm512 from "../assets/moss_nrm_512.webp?url";

import sandAlb1024K from "../assets/ktx2/sand_albedo_1024.ktx2?url";
import sandNrm1024K from "../assets/ktx2/sand_nrm_1024.ktx2?url";
import gravelAlb1024K from "../assets/ktx2/gravel_albedo_1024.ktx2?url";
import gravelNrm1024K from "../assets/ktx2/gravel_nrm_1024.ktx2?url";
import rockAlb1024K from "../assets/ktx2/rock_albedo_1024.ktx2?url";
import rockNrm1024K from "../assets/ktx2/rock_nrm_1024.ktx2?url";
import mossAlb1024K from "../assets/ktx2/moss_albedo_1024.ktx2?url";
import mossNrm1024K from "../assets/ktx2/moss_nrm_1024.ktx2?url";
import sandAlb512K from "../assets/ktx2/sand_albedo_512.ktx2?url";
import sandNrm512K from "../assets/ktx2/sand_nrm_512.ktx2?url";
import gravelAlb512K from "../assets/ktx2/gravel_albedo_512.ktx2?url";
import gravelNrm512K from "../assets/ktx2/gravel_nrm_512.ktx2?url";
import rockAlb512K from "../assets/ktx2/rock_albedo_512.ktx2?url";
import rockNrm512K from "../assets/ktx2/rock_nrm_512.ktx2?url";
import mossAlb512K from "../assets/ktx2/moss_albedo_512.ktx2?url";
import mossNrm512K from "../assets/ktx2/moss_nrm_512.ktx2?url";

type Pair = readonly [string, string]; // [ktx2, webp]
const SETS: Record<512 | 1024, Record<"sand" | "gravel" | "rock" | "moss", readonly [Pair, Pair]>> = {
  1024: {
    sand: [[sandAlb1024K, sandAlb1024], [sandNrm1024K, sandNrm1024]],
    gravel: [[gravelAlb1024K, gravelAlb1024], [gravelNrm1024K, gravelNrm1024]],
    rock: [[rockAlb1024K, rockAlb1024], [rockNrm1024K, rockNrm1024]],
    moss: [[mossAlb1024K, mossAlb1024], [mossNrm1024K, mossNrm1024]],
  },
  512: {
    sand: [[sandAlb512K, sandAlb512], [sandNrm512K, sandNrm512]],
    gravel: [[gravelAlb512K, gravelAlb512], [gravelNrm512K, gravelNrm512]],
    rock: [[rockAlb512K, rockAlb512], [rockNrm512K, rockNrm512]],
    moss: [[mossAlb512K, mossAlb512], [mossNrm512K, mossNrm512]],
  },
};

/** Basis transcoder (copied from three's examples/jsm/libs/basis into public/ by the script). */
const TRANSCODER_PATH = `${import.meta.env.BASE_URL}deep-march/basis/`;
/** Give up on a KTX2 texture after this long and use the WebP. */
const KTX2_TIMEOUT_MS = 20000;

export type SeabedTextureUniforms = {
  tSandA: { value: THREE.Texture };
  tSandN: { value: THREE.Texture };
  tGravelA: { value: THREE.Texture };
  tGravelN: { value: THREE.Texture };
  tRockA: { value: THREE.Texture };
  tRockN: { value: THREE.Texture };
  tMossA: { value: THREE.Texture };
  tMossN: { value: THREE.Texture };
};

/** `?ktx2=0` forces the WebP path (comparison / debugging). */
function ktx2Enabled(): boolean {
  return typeof window === "undefined" || new URLSearchParams(window.location.search).get("ktx2") !== "0";
}

export function loadSeabedTextures(
  renderer: THREE.WebGLRenderer,
  size: 512 | 1024,
  anisotropy: number,
  onReady: () => void,
): { uniforms: SeabedTextureUniforms; dispose: () => void } {
  const placeholder = new THREE.Texture();
  const loaded: THREE.Texture[] = [];
  let ktx2: KTX2Loader | null = null;
  if (ktx2Enabled()) {
    try {
      ktx2 = new KTX2Loader().setTranscoderPath(TRANSCODER_PATH).detectSupport(renderer);
    } catch {
      ktx2 = null;
    }
  }
  const webp = new THREE.TextureLoader();
  let pending = 8;
  let disposed = false;
  const finishOne = () => {
    pending--;
    if (pending === 0) {
      onReady();
      ktx2?.dispose(); // frees the transcoder workers
      ktx2 = null;
    }
  };
  const setup = (t: THREE.Texture, srgb: boolean, compressed: boolean) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = anisotropy;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    // KTX2 files carry their full mip chain; the WebPs get theirs generated
    t.generateMipmaps = !compressed;
    t.needsUpdate = true;
  };
  const load = (slot: { value: THREE.Texture }, [ktxUrl, webpUrl]: Pair, srgb: boolean) => {
    let settled = false;
    const useWebp = () => {
      if (settled) return;
      settled = true;
      webp.load(
        webpUrl,
        (t) => {
          if (disposed) return t.dispose();
          setup(t, srgb, false);
          loaded.push(t);
          slot.value = t;
          finishOne();
        },
        undefined,
        () => finishOne(),
      );
    };
    if (!ktx2) return useWebp();
    const timer = setTimeout(useWebp, KTX2_TIMEOUT_MS);
    ktx2.load(
      ktxUrl,
      (t) => {
        if (settled || disposed) return void t.dispose();
        settled = true;
        clearTimeout(timer);
        setup(t, srgb, true);
        loaded.push(t);
        slot.value = t;
        finishOne();
      },
      undefined,
      () => {
        clearTimeout(timer);
        useWebp();
      },
    );
  };

  const u = (): { value: THREE.Texture } => ({ value: placeholder });
  const uniforms: SeabedTextureUniforms = {
    tSandA: u(), tSandN: u(), tGravelA: u(), tGravelN: u(), tRockA: u(), tRockN: u(), tMossA: u(), tMossN: u(),
  };
  const set = SETS[size];
  load(uniforms.tSandA, set.sand[0], true);
  load(uniforms.tSandN, set.sand[1], false);
  load(uniforms.tGravelA, set.gravel[0], true);
  load(uniforms.tGravelN, set.gravel[1], false);
  load(uniforms.tRockA, set.rock[0], true);
  load(uniforms.tRockN, set.rock[1], false);
  load(uniforms.tMossA, set.moss[0], true);
  load(uniforms.tMossN, set.moss[1], false);

  return {
    uniforms,
    dispose: () => {
      disposed = true;
      loaded.forEach((t) => t.dispose());
      placeholder.dispose();
      ktx2?.dispose();
      ktx2 = null;
    },
  };
}
