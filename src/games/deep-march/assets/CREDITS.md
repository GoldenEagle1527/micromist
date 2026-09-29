# Deep March — texture credits

All seabed textures are CC0 (public domain dedication), so they're compatible with this project's MIT licence.
Attribution is not required but is given here anyway.

Files live in `materials/` as `<key>_a1024.ktx2`, `<key>_a512.ktx2`, `<key>_n512.ktx2`, `<key>_a512.webp`, `<key>_n512.webp`.

| Key | Source | Author | License |
|---|---|---|---|
| `sand` | [ambientCG — Ground061](https://ambientcg.com/view?id=Ground061) (rippled sand) | ambientCG (Lennart Demes) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `gravel` | [ambientCG — Gravel036S](https://ambientcg.com/view?id=Gravel036S) | ambientCG (Lennart Demes) | CC0 1.0 |
| `rock` | [Poly Haven — rock_face_03](https://polyhaven.com/a/rock_face_03) | Dario Barresi (photography), Rico Cilliers (processing) | CC0 1.0 |
| `moss` | [Poly Haven — mossy_rock](https://polyhaven.com/a/mossy_rock) | Rob Tuytel | CC0 1.0 |
| `basalt` | [ambientCG — Rock035](https://ambientcg.com/view?id=Rock035) | ambientCG (Lennart Demes) | CC0 1.0 |
| `darkrock` | [Poly Haven — dark_rock](https://polyhaven.com/a/dark_rock) | Amal Kumar | CC0 1.0 |
| `strata` | [Poly Haven — dark_rock_02](https://polyhaven.com/a/dark_rock_02) | Amal Kumar | CC0 1.0 |
| `seaside` | [Poly Haven — seaside_rock](https://polyhaven.com/a/seaside_rock) | Dimitrios Savva | CC0 1.0 |
| `eroded` | [ambientCG — Rock062](https://ambientcg.com/view?id=Rock062) | ambientCG (Lennart Demes) | CC0 1.0 |
| `porous` | [Poly Haven — rock_05](https://polyhaven.com/a/rock_05) | Rob Tuytel | CC0 1.0 |
| `coralcrust` | [Poly Haven — coral_ground_02](https://polyhaven.com/a/coral_ground_02) | Rob Tuytel | CC0 1.0 |
| `coralrubble` | [Poly Haven — coral_gravel](https://polyhaven.com/a/coral_gravel) | Rob Tuytel | CC0 1.0 |
| `coralmud` | [Poly Haven — coral_mud_01](https://polyhaven.com/a/coral_mud_01) | Rob Tuytel | CC0 1.0 |
| `shellsand` | [ambientCG — Ground060](https://ambientcg.com/view?id=Ground060) | ambientCG (Lennart Demes) | CC0 1.0 |
| `ripplesand` | [Poly Haven — damp_beach_sand_02](https://polyhaven.com/a/damp_beach_sand_02) | Dimitrios Savva | CC0 1.0 |
| `coarsesand` | [Poly Haven — damp_beach_sand](https://polyhaven.com/a/damp_beach_sand) | Dimitrios Savva | CC0 1.0 |
| `ooze` | [Poly Haven — moon_01](https://polyhaven.com/a/moon_01) | Greg Zaal, Rico Cilliers, Jenelle van Heerden (photography), Dario Barresi (processing) | CC0 1.0 |
| `mud` | [ambientCG — Ground095B](https://ambientcg.com/view?id=Ground095B) | ambientCG (Lennart Demes) | CC0 1.0 |
| `nodules` | [ambientCG — Gravel024](https://ambientcg.com/view?id=Gravel024) | ambientCG (Lennart Demes) | CC0 1.0 |
| `scree` | [Poly Haven — low_tide_rocks](https://polyhaven.com/a/low_tide_rocks) | Dimitrios Savva | CC0 1.0 |
| `algae` | [ambientCG — Rock015](https://ambientcg.com/view?id=Rock015) | ambientCG (Lennart Demes) | CC0 1.0 |
| `lichen` | [Poly Haven — lichen_rock](https://polyhaven.com/a/lichen_rock) | Rico Cilliers | CC0 1.0 |

## Processing (`scripts/deep-march-materials.py`)
- 1K sources; albedo = diffuse colour × (0.5 + 0.5·AO), so the ambient occlusion is baked in.
- Tone matching: each set's mean luma is pulled toward a common target (keeping 40 % of its own offset) and its mean chroma likewise (35 %), so the sets sit together in one dark palette; per-layer gains in `scene/materialCatalog.ts` fine-tune.
- `*_a1024.ktx2` / `*_a512.ktx2`: albedo, KTX2 ETC1S (Basis LZ), sRGB, full mip chain (desktop / low-spec).
- `*_n512.ktx2`: R,G = OpenGL tangent-space normal XY (Z is rebuilt in the shader); B = roughness. KTX2 UASTC + RDO + zstd, linear, full mips.
- `*_a512.webp` / `*_n512.webp`: same content as WebP for the fallback path when KTX2 transcoding / compressed texture arrays are unavailable.
- `gravel` uses ambientCG Gravel036S (the Gravel036 set is no longer published; 036S is the same material).

## Sound effects (not included)

The dive sound effects (`public/deep-march/sfx/*.wav`: ambience, swim, sonar, switch, mode, bump, warn) are cut from **Universal Sound FX**, a purchased commercial pack. The pack is licensed for use in the game, not for redistributing the audio files, so they are **not part of this open-source repository** (`public/deep-march/sfx/` is git-ignored) and are not covered by the MIT licence.

Without them the game runs silent: every clip is optional and a missing file is skipped quietly (see `scene/audio.ts`); it never blocks the dive.

To build with sound, put your own licensed clips (22 kHz 16-bit PCM WAV, names above) in `public/deep-march/sfx/`. `npm run build` (and so `deploy` / `deploy:staging`) runs `scripts/sfx-sync.mjs` first, which copies any missing clips from `$MICROMIST_PRIVATE_SFX` (default `/home/box/micromist-private/deep-march/sfx`) and prints a warning if some are still missing.
