#!/usr/bin/env python3
"""
Cuts the plan and profile views out of the owner's body sheets.

Reads the crop windows straight from src/ui/bodyMap.js (planCrop / sideCrop,
percent of the 1448×1086 sheet) so the picture and the dot coordinates can
never disagree, and writes assets/body/<type>-plan.webp and <type>-side.webp
at 800px wide — about thirty kilobytes each instead of a 900 KB sheet.

Run from frontend/:  python3 scripts/crop-body-sheets.py
Needs Pillow. Re-run whenever a sheet under assets/body/sheets/ or a window
in bodyMap.js changes, then update planSize/sideSize there if the height
came out different.
"""
import os
import re
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MAP = os.path.join(ROOT, 'src', 'ui', 'bodyMap.js')
OUT = os.path.join(ROOT, 'assets', 'body')
SHEETS = os.path.join(OUT, 'sheets')
WIDTH = 800

def despeckle(px, w, h, floor):
    """
    Drops every blot smaller than `floor` pixels.

    Knocking the black background out of a JPEG leaves crumbs: the fringe is
    not one clean colour, so a few pixels of every edge survive the test and
    stay behind as grey dust — including dust from the neighbouring views,
    which lands inside our window. Real line art is one long connected run of
    thousands of pixels, so anything tiny and on its own is dirt.
    """
    seen = bytearray(w * h)
    for start in range(w * h):
        if seen[start] or px[start % w, start // w][3] == 0:
            continue
        blob, stack = [], [start]
        seen[start] = 1
        while stack:
            i = stack.pop()
            blob.append(i)
            x, y = i % w, i // w
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < w and 0 <= ny < h:
                    j = ny * w + nx
                    if not seen[j] and px[nx, ny][3]:
                        seen[j] = 1
                        stack.append(j)
        if len(blob) < floor:
            for i in blob:
                px[i % w, i // w] = (0, 0, 0, 0)


def openSheet(stem):
    """
    One sheet, however it arrived.

    The first four came as PNGs with a transparent background. The single-cab
    one came as a JPEG, which has no transparency — so what was empty is black
    in it, with a yellow fringe along every edge where the compression met the
    contrast. Both have to go, or the map would show one car in a black box
    with a yellow halo next to four on white.
    """
    for ext in ('png', 'jpg', 'jpeg'):
        path = os.path.join(SHEETS, f'{stem}.{ext}')
        if os.path.exists(path):
            break
    else:
        sys.exit(f'no sheet for «{stem}» under assets/body/sheets/')

    img = Image.open(path)
    if ext == 'png' and img.mode in ('RGBA', 'LA'):
        return img.convert('RGBA')

    img = img.convert('RGB')
    out = Image.new('RGBA', img.size, (0, 0, 0, 0))
    src_px, out_px = img.load(), out.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b = src_px[x, y]
            if max(r, g, b) < 60:
                continue                      # background
            # The fringe is any pixel with a yellow cast. Grey — which every
            # line in these drawings is — has b within a few points of g, so
            # the gap has to be wide before a pixel counts as coloured.
            if g > 60 and b < g - 25:
                continue                      # the compression fringe
            # Everything else is the drawing, flattened to grey so a colour
            # cast in one sheet cannot tint lines that are black in the rest.
            v = int(0.299 * r + 0.587 * g + 0.114 * b)
            out_px[x, y] = (v, v, v, 255)
    despeckle(out_px, img.width, img.height, 60)
    return out


src = open(MAP, encoding='utf-8').read()
pattern = re.compile(
    r"(\w+): \{\n\s+file: '(\w+)',\n(?:\s+\w+Size: \[[^\]]+\],\n)*"
    r"\s+planCrop: \[([^\]]+)\],\n\s+sideCrop: \[([^\]]+)\],"
)
found = list(pattern.finditer(src))
if not found:
    sys.exit('no sheets found in bodyMap.js — has its shape changed?')

for m in found:
    typ, stem = m.group(1), m.group(2)
    crops = {
        'plan': [float(v) for v in m.group(3).split(',')],
        'side': [float(v) for v in m.group(4).split(',')],
    }
    sheet = openSheet(stem)
    W, H = sheet.size
    for view, (x0, y0, x1, y1) in crops.items():
        cut = sheet.crop((round(W * x0 / 100), round(H * y0 / 100), round(W * x1 / 100), round(H * y1 / 100)))
        cut = cut.resize((WIDTH, round(cut.height * WIDTH / cut.width)), Image.LANCZOS)
        path = os.path.join(OUT, f'{stem}-{view}.webp')
        cut.save(path, 'WEBP', quality=82, method=6)
        print(f'{typ:10} {view:5} {cut.size[0]}×{cut.size[1]}  {os.path.getsize(path) // 1024} KB  -> {os.path.relpath(path, ROOT)}')
