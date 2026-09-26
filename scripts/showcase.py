#!/usr/bin/env python3
"""
showcase.py — renders the hero carousel's slide images.

Each entry in the "showcase" list of data/projects.json names a case study
image and a `focus` point (x/y percent). This crops a 16:9 detail around that
point at SHOWCASE_ZOOM (or the entry's own `zoom`, for a detail that needs a
tighter frame) and writes it to assets/img/showcase/, resampled and
sharpened by scripts/crop.swift (macOS Core Image). The page then shows the
file at native size, so nothing is upscaled in the browser.

Run it after changing the showcase list or a focus point, then build:

    python3 scripts/showcase.py && python3 scripts/build.py
"""

import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data', 'projects.json')
OUT_DIR = os.path.join(ROOT, 'assets', 'img', 'showcase')

# Zoom past a "cover" fit of the frame, and the rendered size. 960x540 covers
# the ~455px frame at 2x DPR and the ~250px phone frame at 3x. At 4.16 a
# 1920px source contributes ~460px across, so crop.swift sharpens for ~2x.
SHOWCASE_ZOOM = 4.16
OUT_W, OUT_H = 960, 540


def out_name(item):
    """One file per detail, so the same image can appear twice at different foci."""
    fx, fy = item.get('focus', [50, 50])
    return '%s--%s--%g-%g.jpg' % (item['slug'], os.path.splitext(item['img'])[0], fx, fy)


def main():
    with open(DATA, encoding='utf-8') as f:
        items = json.load(f).get('showcase', [])
    os.makedirs(OUT_DIR, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        exe = os.path.join(tmp, 'crop')
        subprocess.run(['swiftc', '-O', os.path.join(ROOT, 'scripts', 'crop.swift'),
                        '-o', exe], check=True)
        for it in items:
            fx, fy = it.get('focus', [50, 50])
            src = os.path.join(ROOT, 'assets', 'img', 'case', it['slug'], it['img'])
            dst = os.path.join(OUT_DIR, out_name(it))
            subprocess.run([exe, src, dst, str(fx / 100), str(fy / 100),
                            str(it.get('zoom', SHOWCASE_ZOOM)), str(OUT_W), str(OUT_H)], check=True)
            print('  ' + os.path.relpath(dst, ROOT))

    # drop renders no longer in the list
    keep = {out_name(it) for it in items}
    for name in os.listdir(OUT_DIR):
        if name.endswith('.jpg') and name not in keep:
            os.remove(os.path.join(OUT_DIR, name))
    print('rendered %d showcase images' % len(items))


if __name__ == '__main__':
    sys.exit(main())
