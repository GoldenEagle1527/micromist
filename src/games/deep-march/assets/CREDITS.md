# Deep March — texture credits

All seabed textures are CC0 (public domain dedication), so they're compatible with this project's MIT licence.
Attribution is not required but is given here anyway.

| Files | Source | Author | License |
|---|---|---|---|
| `sand_*` | [ambientCG — Ground061](https://ambientcg.com/view?id=Ground061) (rippled sand) | ambientCG (Lennart Demes) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `gravel_*` | [ambientCG — Gravel036](https://ambientcg.com/view?id=Gravel036) | ambientCG (Lennart Demes) | CC0 1.0 |
| `rock_*` | [Poly Haven — rock_face_03](https://polyhaven.com/a/rock_face_03) | Dario Barresi (photography), Rico Cilliers (processing) | CC0 1.0 |
| `moss_*` | [Poly Haven — mossy_rock](https://polyhaven.com/a/mossy_rock) | Rob Tuytel | CC0 1.0 |

## Processing
- Resized to 1024² (desktop) and 512² (low-spec), encoded as WebP.
- `*_albedo_*`: diffuse colour × (0.5 + 0.5·AO), so the ambient occlusion is baked in.
- `*_nrm_*`: R,G = OpenGL tangent-space normal XY (Z is rebuilt in the shader); B = roughness.

## Code references
- `terrain/erosion.ts` — droplet hydraulic erosion adapted to the 3D density field from
  [Sebastian Lague — Hydraulic-Erosion](https://github.com/SebLague/Hydraulic-Erosion)
  (© 2019 Sebastian Lague, [MIT License](https://github.com/SebLague/Hydraulic-Erosion/blob/master/LICENSE)).
