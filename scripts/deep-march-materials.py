#!/usr/bin/env python3
"""
Build the deep-march seabed material library (22 CC0 PBR sets) into
src/games/deep-march/assets/materials/:

  <key>_a1024.ktx2  albedo, ETC1S (Basis LZ), sRGB, full mips      (desktop)
  <key>_a512.ktx2   albedo, ETC1S, sRGB, full mips                  (phone)
  <key>_n512.ktx2   packed normal (RG = OpenGL normal XY, B = roughness), UASTC + RDO + zstd, linear (both)
  <key>_a512.webp / <key>_n512.webp   technical fallback when KTX2 / compressed arrays fail

Processing per set (1K sources from ambientCG / Poly Haven, cached in --cache):
  albedo × (0.5 + 0.5·AO) (AO baked in), then tone-matched across the library:
  mean luma L → T + (L − T)·LUMA_KEEP and mean chroma C above CHROMA_T →
  CHROMA_T + (C − CHROMA_T)·CHROMA_KEEP (pattern contrast and hue kept), so the
  bright tan coral sets and the near-black basalt sit in one dark palette. Per-layer
  fine gain lives in the runtime catalogue (scene/materialCatalog.ts).

Needs: python3 + Pillow + numpy, KTX-Software 4.x `ktx` CLI (KTX env var or PATH).
Usage: python3 scripts/deep-march-materials.py [--cache DIR] [--only key,key]
Keys / order must match scene/materialCatalog.ts (checked by npm run test:materials).
"""
import argparse, io, json, os, shutil, subprocess, sys, tempfile, urllib.request, zipfile
import numpy as np
from PIL import Image

# key, source ("acg" ambientCG | "ph" Poly Haven), asset id — order = texture-array layer
SETS = [
    ("sand", "acg", "Ground061"), ("gravel", "acg", "Gravel036S"), ("rock", "ph", "rock_face_03"), ("moss", "ph", "mossy_rock"),
    ("basalt", "acg", "Rock035"), ("darkrock", "ph", "dark_rock"), ("strata", "ph", "dark_rock_02"), ("seaside", "ph", "seaside_rock"),
    ("eroded", "acg", "Rock062"), ("porous", "ph", "rock_05"), ("coralcrust", "ph", "coral_ground_02"), ("coralrubble", "ph", "coral_gravel"),
    ("coralmud", "ph", "coral_mud_01"), ("shellsand", "acg", "Ground060"), ("ripplesand", "ph", "damp_beach_sand_02"), ("coarsesand", "ph", "damp_beach_sand"),
    ("ooze", "ph", "moon_01"), ("mud", "acg", "Ground095B"), ("nodules", "acg", "Gravel024"), ("scree", "ph", "low_tide_rocks"),
    ("algae", "acg", "Rock015"), ("lichen", "ph", "lichen_rock"),
]
LUMA_T, LUMA_KEEP = 100.0, 0.4
CHROMA_T, CHROMA_KEEP = 24.0, 0.35
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "games", "deep-march", "assets", "materials")
UA = {"User-Agent": "Mozilla/5.0 micromist-materials"}


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120).read()


def fetch(cache, src, aid):
    d = os.path.join(cache, aid)
    if all(os.path.isfile(os.path.join(d, f + ".jpg")) for f in ("albedo", "normal", "rough")):
        return d
    os.makedirs(d, exist_ok=True)
    maps = {"albedo": ("_color", "Diffuse"), "normal": ("_normalgl", "nor_gl"), "rough": ("_roughness", "Rough"), "ao": ("_ambientocclusion", "AO")}
    if src == "acg":
        z = zipfile.ZipFile(io.BytesIO(get(f"https://ambientcg.com/get?file={aid}_1K-JPG.zip")))
        for n in z.namelist():
            for tag, (k, _) in maps.items():
                if k in n.lower() and n.lower().endswith((".jpg", ".png")):
                    open(os.path.join(d, tag + ".jpg"), "wb").write(z.read(n))
    else:
        files = json.loads(get(f"https://api.polyhaven.com/files/{aid}"))
        for tag, (_, k) in maps.items():
            if k in files:
                e = files[k]["1k"].get("jpg") or files[k]["1k"].get("png")
                open(os.path.join(d, tag + ".jpg"), "wb").write(get(e["url"]))
    return d


def load(path, mode, size=1024):
    return np.asarray(Image.open(path).convert(mode).resize((size, size), Image.LANCZOS), dtype=np.float32)


def tone_match(a):
    luma = a @ np.array([0.299, 0.587, 0.114], np.float32)
    L = float(luma.mean())
    C = float((a.max(2) - a.min(2)).mean())
    Ct = CHROMA_T + (C - CHROMA_T) * CHROMA_KEEP if C > CHROMA_T else C
    s = Ct / max(C, 1e-3)
    Lt = LUMA_T + (L - LUMA_T) * LUMA_KEEP
    out = ((a - luma[..., None]) * s + luma[..., None]) * (Lt / max(L, 1e-3))
    return np.clip(out, 0, 255), (L, C, Lt, Ct)


def ktx(args, src, dst):
    exe = os.environ.get("KTX", "ktx")
    subprocess.run([exe, "create", *args, "--generate-mipmap", src, dst], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.path.expanduser("~/.cache/deep-march-materials"))
    ap.add_argument("--only", default="")
    o = ap.parse_args()
    only = set(filter(None, o.only.split(",")))
    os.makedirs(OUT, exist_ok=True)
    tmp = tempfile.mkdtemp()
    report = {}
    try:
        for key, src, aid in SETS:
            if only and key not in only:
                continue
            d = fetch(o.cache, src, aid)
            alb = load(os.path.join(d, "albedo.jpg"), "RGB")
            ao = load(os.path.join(d, "ao.jpg"), "L") / 255.0 if os.path.isfile(os.path.join(d, "ao.jpg")) else np.ones(alb.shape[:2], np.float32)
            alb, stats = tone_match(alb * (0.5 + 0.5 * ao[..., None]))
            nrm = load(os.path.join(d, "normal.jpg"), "RGB", 512)
            rough = load(os.path.join(d, "rough.jpg"), "L", 512)
            packed = np.dstack([nrm[..., 0], nrm[..., 1], rough]).clip(0, 255).astype(np.uint8)
            a8 = alb.astype(np.uint8)
            for s in (1024, 512):
                p = os.path.join(tmp, f"{key}_a{s}.png")
                Image.fromarray(a8).resize((s, s), Image.LANCZOS).save(p)
                ktx(["--format", "R8G8B8_SRGB", "--assign-tf", "srgb", "--encode", "basis-lz", "--clevel", "4", "--qlevel", "200"], p, os.path.join(OUT, f"{key}_a{s}.ktx2"))
            pn = os.path.join(tmp, f"{key}_n512.png")
            Image.fromarray(packed).save(pn)
            ktx(["--format", "R8G8B8_UNORM", "--assign-tf", "linear", "--encode", "uastc", "--uastc-quality", "2", "--uastc-rdo", "--uastc-rdo-l", "0.75", "--zstd", "18"], pn, os.path.join(OUT, f"{key}_n512.ktx2"))
            Image.fromarray(a8).resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, f"{key}_a512.webp"), quality=88, method=6)
            Image.fromarray(packed).save(os.path.join(OUT, f"{key}_n512.webp"), quality=90, method=6)
            report[key] = {"source": f"{src}:{aid}", "luma": round(stats[0], 1), "chroma": round(stats[1], 1), "lumaOut": round(stats[2], 1), "chromaOut": round(stats[3], 1)}
            print(key, report[key], flush=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    # Basis transcoder served from public/ (must match the installed three.js)
    root = os.path.join(os.path.dirname(__file__), "..")
    basis = os.path.join(root, "node_modules", "three", "examples", "jsm", "libs", "basis")
    dst = os.path.join(root, "public", "deep-march", "basis")
    os.makedirs(dst, exist_ok=True)
    for f in ("basis_transcoder.js", "basis_transcoder.wasm"):
        shutil.copy(os.path.join(basis, f), dst)
    json.dump(report, sys.stdout, indent=1)


if __name__ == "__main__":
    main()
