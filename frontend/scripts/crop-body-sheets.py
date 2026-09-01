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
    sheet = Image.open(os.path.join(SHEETS, f'{stem}.png')).convert('RGBA')
    W, H = sheet.size
    for view, (x0, y0, x1, y1) in crops.items():
        cut = sheet.crop((round(W * x0 / 100), round(H * y0 / 100), round(W * x1 / 100), round(H * y1 / 100)))
        cut = cut.resize((WIDTH, round(cut.height * WIDTH / cut.width)), Image.LANCZOS)
        path = os.path.join(OUT, f'{stem}-{view}.webp')
        cut.save(path, 'WEBP', quality=82, method=6)
        print(f'{typ:10} {view:5} {cut.size[0]}×{cut.size[1]}  {os.path.getsize(path) // 1024} KB  -> {os.path.relpath(path, ROOT)}')
