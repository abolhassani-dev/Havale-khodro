#!/usr/bin/env python3
"""
Draws the body-map dots onto the real crops, at the size the page shows them.

The dot coordinates in src/ui/bodyMap.js are percentages of the cropped
picture, so the only honest way to check one is to put it back on that picture
at the width a reader's screen gives it — 760px for the plan, 376px for each
profile on a desktop. A dot that looks right at 800px can sit on the tyre at
376px, because the dot does not shrink with the drawing.

Run from frontend/:  python3 scripts/body-dots.py [outdir] [BODY_TYPE ...]
Needs Pillow. Writes one PNG per view, every part labelled.
"""
import json
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '.body-dots')
ONLY = sys.argv[2:]
# What the layout gives each view: the plan spans the map, the two profiles
# share the row underneath it.
VIEW_WIDTH = {'plan': 760, 'side': 376}
DOT = 17  # 13px of colour inside a 2px white ring


def block(text, start):
    """The {...} that begins at `start`."""
    depth = 0
    for i in range(start, len(text)):
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0:
                return text[start:i + 1]
    raise ValueError('unbalanced braces in bodyMap.js')


def obj(text):
    """That block as data — it is JSON once the JavaScript is taken off."""
    t = re.sub(r"'([^']*)'", r'"\1"', text)
    t = re.sub(r'([{,]\s*)([A-Za-z_][\w-]*)\s*:', r'\1"\2":', t)
    return json.loads(re.sub(r',\s*([}\]])', r'\1', t))


src = open(os.path.join(ROOT, 'src', 'ui', 'bodyMap.js'), encoding='utf-8').read()
sheets = {m.group(1): obj(block(src, m.start(2)))
          for m in re.finditer(r'\n  ([A-Z_]+): (\{)\n    file:', src)}
if not sheets:
    sys.exit('no sheets found in bodyMap.js — has its shape changed?')
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 12)
except OSError:
    font = ImageFont.load_default()

os.makedirs(OUT, exist_ok=True)
for typ, sheet in sheets.items():
    if ONLY and typ not in ONLY:
        continue
    for view in ('plan', 'side'):
        img = Image.open(os.path.join(ROOT, 'assets', 'body', f'{sheet["file"]}-{view}.webp'))
        img = Image.alpha_composite(Image.new('RGBA', img.size, 'white'), img.convert('RGBA'))
        w = VIEW_WIDTH[view]
        img = img.convert('RGB').resize((w, round(img.height * w / img.width)), Image.LANCZOS)
        draw = ImageDraw.Draw(img)
        r = DOT / 2
        for key, (x, y) in sheet[view].items():
            cx, cy = img.width * x / 100, img.height * y / 100
            draw.ellipse([cx - r, cy - r, cx + r, cy + r],
                         fill=(124, 58, 237), outline='white', width=2)
            draw.text((cx + r + 1, cy - 6), key, fill=(190, 0, 0), font=font,
                      stroke_width=3, stroke_fill='white')
        path = os.path.join(OUT, f'{typ}-{view}.png')
        img.save(path)
        print(f'{typ:14} {view:5} {img.size[0]}×{img.size[1]}  -> {os.path.relpath(path, ROOT)}')
