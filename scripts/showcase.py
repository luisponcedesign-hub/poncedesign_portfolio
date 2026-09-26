#!/usr/bin/env python3
"""
showcase.py — renders the hero carousel's slide images.

Each entry in the "showcase" list of data/projects.json names a case study
image and a `focus` point (x/y percent). This crops a 16:9 detail around that
point at SHOWCASE_ZOOM (or the entry's own `zoom`, for a detail that needs a
tighter frame) and writes it to assets/img/showcase/ via scripts/crop.swift
(macOS Core Image). An entry's `mode` picks the treatment: "photo" (default)
resamples and sharpens real texture; "flat" re-draws solid-colour artwork
crisply by snapping it to its own palette of `colours` tones; "vector" snaps
the same way and traces the result into an SVG, sharp at any size.
`fill_enclosed` ("rrggbb>rrggbb") repaints enclosed regions of one palette
colour in another, e.g. to merge an outline into the shape it surrounds.
`clean` widens the pre-trace majority filter for a noisy small source. The page shows
the file at native size, so nothing is upscaled in the browser.

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

# Zoom past a "cover" fit of the frame, and the rendered size. 1440x810 covers
# the ~455px desktop frame up to 3x DPR and the ~250px phone frame at 3x+.
SHOWCASE_ZOOM = 4.16
OUT_W, OUT_H = 1440, 810


def out_name(item):
    """One file per detail, so the same image can appear twice at different foci.
    Flat renders are PNG: JPEG would put back the fringe the snapping removed."""
    fx, fy = item.get('focus', [50, 50])
    ext = {'flat': 'png', 'vector': 'svg'}.get(item.get('mode'), 'jpg')
    return '%s--%s--%g-%g.%s' % (item['slug'], os.path.splitext(item['img'])[0], fx, fy, ext)


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
                            str(it.get('zoom', SHOWCASE_ZOOM)), str(OUT_W), str(OUT_H),
                            it.get('mode', 'photo'), str(it.get('colours', 4)),
                            str(it.get('soften', 0.45)), it.get('fill_enclosed', ''),
                            str(it.get('clean', 2))], check=True)
            print('  ' + os.path.relpath(dst, ROOT))

    # drop renders no longer in the list
    keep = {out_name(it) for it in items}
    for name in os.listdir(OUT_DIR):
        if name.endswith(('.jpg', '.png', '.svg')) and name not in keep:
            os.remove(os.path.join(OUT_DIR, name))
    print('rendered %d showcase images' % len(items))


if __name__ == '__main__':
    sys.exit(main())
