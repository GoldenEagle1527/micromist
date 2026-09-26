#!/usr/bin/env bash
# Regenerate the deep-march seabed textures as KTX2 (Basis Universal UASTC,
# zstd-supercompressed, full mip chain) from the WebP sources, and refresh the
# Basis transcoder served from public/ (must match the installed three.js).
#
# Needs: KTX-Software 4.x `ktx` CLI (https://github.com/KhronosGroup/KTX-Software/releases;
# set KTX=/path/to/bin/ktx if it isn't on PATH) and python3 with Pillow (WebP → PNG).
#
# Albedo → R8G8B8_SRGB (sRGB transfer, three reads it as SRGBColorSpace);
# packed normal maps (xy normal + roughness in b) → R8G8B8_UNORM (linear, no
# normal-map swizzle: the shader unpacks .xy itself and reads roughness from .b).
# UASTC transcodes to BC7 / ASTC 4×4 / ETC2 (1 byte per texel) on the GPU.
set -euo pipefail
cd "$(dirname "$0")/.."
KTX="${KTX:-ktx}"
SRC=src/games/deep-march/assets
OUT=src/games/deep-march/assets/ktx2
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"
for f in "$SRC"/*.webp; do
  name=$(basename "$f" .webp)
  python3 -c "import sys; from PIL import Image; Image.open(sys.argv[1]).convert('RGB').save(sys.argv[2])" "$f" "$TMP/$name.png"
  case "$name" in
    *_albedo_*) fmt=R8G8B8_SRGB; tf=srgb; rdo=(--uastc-rdo --uastc-rdo-l 1.5) ;;
    *) fmt=R8G8B8_UNORM; tf=linear; rdo=(--uastc-rdo --uastc-rdo-l 0.75) ;;
  esac
  "$KTX" create --format "$fmt" --assign-tf "$tf" --encode uastc --uastc-quality 2 "${rdo[@]}" --zstd 18 \
    --generate-mipmap "$TMP/$name.png" "$OUT/$name.ktx2"
  echo "$name.ktx2 $(stat -c %s "$OUT/$name.ktx2") bytes"
done
mkdir -p public/deep-march/basis
cp node_modules/three/examples/jsm/libs/basis/basis_transcoder.js node_modules/three/examples/jsm/libs/basis/basis_transcoder.wasm public/deep-march/basis/
