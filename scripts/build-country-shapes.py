"""Rasterize Natural Earth country outlines into maze grid masks.

Usage: python3 scripts/build-country-shapes.py ne_50m_admin_0_countries.geojson data/country-shapes.json

Natural Earth (https://www.naturalearthdata.com) is public domain. Each country
is projected equirectangularly around its own centre latitude, filled at 4x
supersampling, and kept as one connected region: tiny islands are dropped and the
remaining islands are joined to the mainland by one-cell causeways so every maze
stays solvable.

Taiwan, Hong Kong and Macau are part of China: Natural Earth lists them as
separate features, so their outlines are merged into China's and they get no
entry of their own.
"""
import json
import math
import re
import sys
import unicodedata
from collections import deque

from PIL import Image, ImageDraw

LONG_SIDE = 96          # cells along the country's longer axis
SUPERSAMPLE = 4
MAX_ISLANDS = 12
MIN_ISLAND_SHARE = 0.02  # of the largest landmass
MIN_CELLS = 30
# Natural Earth features that belong to another country's outline.
MERGE_INTO = {'TWN': 'CHN', 'HKG': 'CHN', 'MAC': 'CHN'}
RENAME = {'CHN': ('china', 'China')}
FAR_RATIO = 0.8           # x the main landmass's diagonal
MAX_CAUSEWAY = 12         # cells; farther islands are left out


def polygons(geometry):
    if geometry['type'] == 'Polygon':
        return [geometry['coordinates']]
    if geometry['type'] == 'MultiPolygon':
        return geometry['coordinates']
    return []


def project(polys):
    lons = [lon for poly in polys for ring in poly for lon, _ in ring]
    shift = max(lons) - min(lons) > 180  # crosses the antimeridian (Russia, Fiji)
    def fix(lon):
        return lon + 360 if shift and lon < 0 else lon
    # Centre latitude of the largest polygon keeps big landmasses undistorted.
    biggest = max(polys, key=lambda poly: len(poly[0]))
    lats = [lat for _, lat in biggest[0]]
    k = math.cos(math.radians(max(-70.0, min(70.0, (max(lats) + min(lats)) / 2))))
    return [[[(fix(lon) * k, -lat) for lon, lat in ring] for ring in poly] for poly in polys]


def ring_area(ring):
    return abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]))) / 2


def bbox(ring):
    xs = [x for x, _ in ring]; ys = [y for _, y in ring]
    return min(xs), min(ys), max(xs), max(ys)


def drop_overseas(polys):
    """Drop small, distant territories (French Guiana, Svalbard, Alaska, Hawaii)
    so the home landmass is not shrunk to fit them in the grid."""
    main = max(polys, key=lambda poly: ring_area(poly[0]))
    area = ring_area(main[0])
    x0, y0, x1, y1 = bbox(main[0])
    cx, cy, diag = (x0 + x1) / 2, (y0 + y1) / 2, math.hypot(x1 - x0, y1 - y0) or 1
    kept = []
    for poly in polys:
        a, b, c, d = bbox(poly[0])
        far = math.hypot((a + c) / 2 - cx, (b + d) / 2 - cy) > FAR_RATIO * diag
        if poly is main or not far or ring_area(poly[0]) >= 0.5 * area:
            kept.append(poly)
    return kept


def rasterize(polys, marked=()):
    xs = [x for poly in polys for ring in poly for x, _ in ring]
    ys = [y for poly in polys for ring in poly for _, y in ring]
    minx, miny = min(xs), min(ys)
    span = max(max(xs) - minx, max(ys) - miny) or 1
    scale = (LONG_SIDE - 1) / span
    w = max(1, math.ceil((max(xs) - minx) * scale) + 1)
    h = max(1, math.ceil((max(ys) - miny) * scale) + 1)
    s = SUPERSAMPLE
    img = Image.new('L', (w * s, h * s), 0)
    draw = ImageDraw.Draw(img)
    for poly in polys:
        for i, ring in enumerate(poly):
            pts = [((x - minx) * scale * s + s / 2, (y - miny) * scale * s + s / 2) for x, y in ring]
            if len(pts) >= 3:
                draw.polygon(pts, fill=0 if i else 255)
    small = img.resize((w, h), Image.BOX)
    cells = {(x, y) for y in range(h) for x in range(w) if small.getpixel((x, y)) >= 128}
    # Cells covered by any of the `marked` polygons, at any coverage.
    mark = Image.new('L', (w * s, h * s), 0)
    mdraw = ImageDraw.Draw(mark)
    for poly in marked:
        pts = [((x - minx) * scale * s + s / 2, (y - miny) * scale * s + s / 2) for x, y in poly[0]]
        if len(pts) >= 3:
            mdraw.polygon(pts, fill=255)
    msmall = mark.resize((w, h), Image.BOX)
    marked_cells = {(x, y) for y in range(h) for x in range(w) if msmall.getpixel((x, y)) > 0}
    # A merged territory too small to fill half a cell still gets its cells.
    cells |= marked_cells
    return w, h, cells, frozenset(marked_cells)


def components(cells):
    seen, comps = set(), []
    for c in cells:
        if c in seen:
            continue
        comp, q = [], deque([c])
        seen.add(c)
        while q:
            x, y = q.popleft()
            comp.append((x, y))
            for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if n in cells and n not in seen:
                    seen.add(n)
                    q.append(n)
        comps.append(comp)
    return sorted(comps, key=len, reverse=True)


def join_islands(cells, must=frozenset()):
    """Join islands to the mainland. Islands touching `must` are always kept."""
    comps = components(cells)
    if not comps:
        return set()
    keep = comps[:1] + [c for c in comps[1:] if must.intersection(c)]
    keep += [c for c in comps[1:MAX_ISLANDS] if c not in keep and len(c) >= max(4, MIN_ISLAND_SHARE * len(comps[0]))]
    joined = set(keep[0])
    for comp in keep[1:]:
        # Shortest L-shaped causeway from this island to land already joined.
        a, b = min(((p, q) for p in comp for q in joined),
                   key=lambda pq: abs(pq[0][0] - pq[1][0]) + abs(pq[0][1] - pq[1][1]))
        (x0, y0), (x1, y1) = a, b
        if abs(x0 - x1) + abs(y0 - y1) > MAX_CAUSEWAY and not must.intersection(comp):
            continue
        step = 1 if x1 >= x0 else -1
        for x in range(x0, x1 + step, step):
            joined.add((x, y0))
        step = 1 if y1 >= y0 else -1
        for y in range(y0, y1 + step, step):
            joined.add((x1, y))
        joined.update(comp)
    return joined


def rle_rows(w, h, cells):
    rows = []
    for y in range(h):
        runs, cur, n = [], False, 0
        for x in range(w):
            v = (x, y) in cells
            if v == cur:
                n += 1
            else:
                runs.append(n)
                cur, n = v, 1
        runs.append(n)
        rows.append('.'.join(map(str, runs)))
    return rows


def slugify(name):
    ascii_name = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', ascii_name.lower()).strip('-')


def main(src, out):
    features = json.load(open(src))['features']
    merged = {}
    for f in features:
        target = MERGE_INTO.get(f['properties']['ADM0_A3'])
        if target:
            merged.setdefault(target, []).append(polygons(f['geometry']))
    shapes = []
    for f in features:
        p = f['properties']
        if p['ADM0_A3'] in MERGE_INTO:
            continue
        polys = polygons(f['geometry'])
        parts = merged.get(p['ADM0_A3'], [])
        if not polys:
            continue
        extra = [poly for part in parts for poly in part]
        projected = project(polys + extra)
        home = drop_overseas(projected[:len(polys)])
        added = projected[len(polys):]
        # The main island of each merged territory must stay in the outline.
        mains, i = [], 0
        for part in parts:
            mains.append(max(added[i:i + len(part)], key=lambda poly: ring_area(poly[0])))
            i += len(part)
        w, h, cells, must = rasterize(home + added, mains)
        cells = join_islands(cells, must)
        if len(cells) < MIN_CELLS:
            print('skip (too small at this resolution):', p['NAME_EN'])
            continue
        # Trim empty margins left by dropped islands.
        minx = min(x for x, _ in cells); miny = min(y for _, y in cells)
        cells = {(x - minx, y - miny) for x, y in cells}
        w = max(x for x, _ in cells) + 1; h = max(y for _, y in cells) + 1
        iso2 = p['ISO_A2_EH'] if p['ISO_A2_EH'] not in (None, '-99') else None
        sid, name = RENAME.get(p['ADM0_A3'], (slugify(p['NAME_EN']), p['NAME_EN']))
        shapes.append({
            'id': sid,
            'name': name,
            'iso_a2': iso2,
            'iso_a3': p['ADM0_A3'],
            'continent': p['CONTINENT'],
            'width': w,
            'height': h,
            'cells': len(cells),
            # Each row is run lengths alternating outside/inside, starting outside.
            'rows': rle_rows(w, h, cells),
        })
    shapes.sort(key=lambda s: s['id'])
    ids = [s['id'] for s in shapes]
    assert len(ids) == len(set(ids)), 'duplicate country ids'
    json.dump({'source': 'Natural Earth 1:50m Admin 0 Countries (public domain)', 'long_side': LONG_SIDE,
               'countries': shapes}, open(out, 'w'), separators=(',', ':'))
    print(len(shapes), 'countries written to', out)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
