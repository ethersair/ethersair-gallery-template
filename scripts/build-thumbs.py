#!/usr/bin/env python3
"""Builds 480px WebP thumbnails for an NFT gallery.

Usage:  python scripts/build-thumbs.py <images-dir> <out-dir> [size]

Reads <id>.png / <id>.jpg from images-dir and writes <id>.webp into out-dir.
Requires Pillow:  pip install pillow
"""
import os
import sys
import time

from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else "./images"
OUT = sys.argv[2] if len(sys.argv) > 2 else "./web/thumbs"
SIZE = int(sys.argv[3]) if len(sys.argv) > 3 else 480

os.makedirs(OUT, exist_ok=True)
names = sorted(
    (n for n in os.listdir(SRC) if n.lower().endswith((".png", ".jpg", ".jpeg"))),
    key=lambda n: int(os.path.splitext(n)[0]) if os.path.splitext(n)[0].isdigit() else 10**9,
)

t0 = time.time()
total = 0
for name in names:
    stem = os.path.splitext(name)[0]
    im = Image.open(os.path.join(SRC, name)).convert("RGB")
    im.thumbnail((SIZE, SIZE), Image.LANCZOS)
    dst = os.path.join(OUT, f"{stem}.webp")
    im.save(dst, "WEBP", quality=78, method=5)
    total += os.path.getsize(dst)

print(f"{len(names)} thumbnails | {total / 1048576:.1f} MB total | "
      f"{total / max(len(names), 1) / 1024:.1f} KB avg | {time.time() - t0:.1f}s")
