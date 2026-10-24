#!/usr/bin/env python3
"""Write data/world-dots.json, the dot grid behind the "Countries" card.

Samples Natural Earth 1:110m country shapes (world-atlas TopoJSON) on a
coarse grid and tags each land dot with its ISO 3166-1 alpha-2 code, the
same code GA's countryId dimension reports. Countries too small to own a
dot share the dot under their centre, so a dot can carry several codes
and lights up when any of them has visitors.

Run once; the output is static. Needs network access, no packages.

    python3 scripts/build_world_dots.py
"""
import json
import os
import urllib.request

ATLAS = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json'
CODES = 'https://cdn.jsdelivr.net/npm/i18n-iso-countries@7.11.0/codes.json'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'world-dots.json')

COLS, ROWS = 28, 14          # ~3.8px pitch at 107px wide; rows stretch latitude a little
NORTH, SOUTH = 80, -58       # crop the poles; Antarctica is never a visitor
SUB = 3                      # subsamples per cell side


def get(url):
    with urllib.request.urlopen(url) as r:
        return json.load(r)


def decode(topo):
    """TopoJSON → {numeric id: [ring, ...]} with rings as [(lon, lat), ...]."""
    (sx, sy), (tx, ty) = topo['transform']['scale'], topo['transform']['translate']
    arcs = []
    for arc in topo['arcs']:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx; y += dy
            pts.append((x * sx + tx, y * sy + ty))
        arcs.append(pts)

    def ring(idx):
        pts = []
        for i in idx:
            a = arcs[i] if i >= 0 else arcs[~i][::-1]
            pts.extend(a if not pts else a[1:])
        return pts

    out = {}
    for g in topo['objects']['countries']['geometries']:
        if 'id' not in g or not g.get('arcs'):
            continue
        polys = g['arcs'] if g['type'] == 'MultiPolygon' else [g['arcs']]
        out[g['id']] = [ring(r) for p in polys for r in p]
    return out


def inside(x, y, rings):
    # Even-odd across all rings, so holes cancel out.
    hit = False
    for r in rings:
        j = len(r) - 1
        for i in range(len(r)):
            xi, yi = r[i]; xj, yj = r[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                hit = not hit
            j = i
    return hit


def main():
    alpha2 = {num: a2 for a2, _, num, *_ in get(CODES)}
    shapes = {alpha2[k]: v for k, v in decode(get(ATLAS)).items() if k in alpha2}
    boxes = {}
    for cc, rings in shapes.items():
        xs = [p[0] for r in rings for p in r]; ys = [p[1] for r in rings for p in r]
        boxes[cc] = (min(xs), min(ys), max(xs), max(ys))

    cw, ch = 360 / COLS, (NORTH - SOUTH) / ROWS
    grid = {}
    for row in range(ROWS):
        for col in range(COLS):
            votes = {}
            for i in range(SUB):
                for j in range(SUB):
                    x = -180 + (col + (i + .5) / SUB) * cw
                    y = NORTH - (row + (j + .5) / SUB) * ch
                    for cc, (x0, y0, x1, y1) in boxes.items():
                        if x0 <= x <= x1 and y0 <= y <= y1 and inside(x, y, shapes[cc]):
                            votes[cc] = votes.get(cc, 0) + 1
                            break
            # Land when at least two subsamples hit, so coasts don't bloat.
            if votes and sum(votes.values()) >= 2:
                grid[(col, row)] = [max(votes, key=votes.get)]

    # Every country that won no dot shares the one under its largest ring's centre.
    owned = {cc for v in grid.values() for cc in v}
    for cc, rings in shapes.items():
        if cc in owned:
            continue
        r = max(rings, key=len)
        x = sum(p[0] for p in r) / len(r); y = sum(p[1] for p in r) / len(r)
        col, row = int((x + 180) // cw), int((NORTH - y) // ch)
        if 0 <= col < COLS and 0 <= row < ROWS:
            grid.setdefault((col, row), []).append(cc)

    # Each dot is [col, row, codes...].
    data = {
        'cols': COLS, 'rows': ROWS,
        'dots': [[c, r, *v] for (c, r), v in sorted(grid.items(), key=lambda k: (k[0][1], k[0][0]))],
    }
    with open(OUT, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
        f.write('\n')
    print(f'{len(data["dots"])} dots, {len(shapes)} countries')


if __name__ == '__main__':
    main()
