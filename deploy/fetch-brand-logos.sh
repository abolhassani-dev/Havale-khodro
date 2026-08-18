#!/usr/bin/env bash
#
# Downloads the brand logos named in the catalogue.
#
#   ./deploy/fetch-brand-logos.sh
#
# Run from Iran. The source only answers to Iranian addresses — from anywhere
# else the connection is reset, which is why this is a script you run rather
# than a build step.
#
# It writes into frontend/assets/brands/ and is safe to re-run: a logo already
# on disk is left alone, so a failed run resumes instead of starting over.
#
# ── Why the files come here and are not linked ──────────────────────────────
#
# Pointing the page at the original address would mean every agency that opens
# the brand list sends 186 requests to somebody else's server — their bandwidth,
# their logs, our users' referrers, and a brand list that goes blank the day
# they reorganise a folder. One download, kept in the repository, has none of
# those properties.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="$ROOT/backend/src/constants/carCatalog.data.json"
OUT="$ROOT/frontend/assets/brands"
# Overridable so the script itself can be tested against a local server. A
# fetcher that has only ever been run against the real thing is a fetcher whose
# failure path nobody has seen.
BASE="${LOGO_BASE:-https://cdn-sth1.bama.ir/assets/filter/car-brand-logo}"

G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; D=$'\e[2m'; N=$'\e[0m'

[ -f "$DATA" ] || { printf '%s✗ فایل کاتالوگ پیدا نشد: %s%s\n' "$R" "$DATA" "$N"; exit 1; }
command -v curl >/dev/null || { printf '%s✗ curl نصب نیست%s\n' "$R" "$N"; exit 1; }

mkdir -p "$OUT"

# The slug list comes from the catalogue file rather than from a list kept here,
# so a brand added to the catalogue is a brand this fetches — with no second
# place to remember to edit.
slugs="$(
  python3 -c '
import json,sys
d=json.load(open(sys.argv[1]))
for b in d["brands"]:
    if b.get("logo"): print(b["slug"])
' "$DATA" 2>/dev/null
)"

[ -n "$slugs" ] || { printf '%s✗ هیچ برندی با لوگو در کاتالوگ نبود%s\n' "$R" "$N"; exit 1; }

total="$(printf '%s\n' "$slugs" | wc -l | tr -d ' ')"
printf '\n%s▌ دریافت لوگوی %s برند%s\n\n' "$Y" "$total" "$N"

# Candidate addresses, most likely first. The catalogue records the address
# without a suffix — that is what the site's own data contains — and that
# address answers AccessDenied. The browser's network tab shows the files
# arriving as `peugeot.png`, so the suffix is the missing piece; these are the
# shapes it could take. If the site changes, add a line rather than rewrite
# the loop.
#
# Assigned in two steps rather than with `${LOGO_PATTERNS:-…}`: a default
# containing `}` ends the parameter expansion at the first one, so the list
# came out truncated and every download failed while the script reported
# nothing unusual.
PATTERNS="${LOGO_PATTERNS:-}"
if [ -z "$PATTERNS" ]; then
  PATTERNS='{base}/{slug}.png {base}/{slug}.svg {base}/{slug}/2.png {base}/v2/{slug}.png {base}/{slug}'
fi
WORKING=""

ok=0; skipped=0; failed=""
for slug in $slugs; do
  dest="$OUT/$slug.png"

  if [ -s "$dest" ]; then
    skipped=$((skipped + 1))
    continue
  fi

  # The address in the catalogue is the one the site's own data gives, and it
  # is not the address of the image: opened directly it answers AccessDenied,
  # because the file underneath has an extension the data leaves off. Rather
  # than guess which suffix is the right one, try the candidates and keep
  # whichever actually returns an image. The first hit is remembered, so this
  # costs one extra request in total, not one per brand.
  got=""
  for pattern in $PATTERNS; do
    url="$(printf '%s' "$pattern" | sed "s|{base}|$BASE|; s|{slug}|$slug|g")"

    # --fail so an HTML or XML error page is never saved as if it were an
    # image, and a short timeout so one dead entry cannot stall the run.
    curl -sS --fail --max-time 20 -o "$dest.part" "$url" 2>/dev/null || { rm -f "$dest.part"; continue; }

    # Downloaded is not the same as usable: a zero-byte or non-image reply is a
    # failure that looks like a success until somebody opens the page.
    if [ -s "$dest.part" ] && file -b --mime-type "$dest.part" 2>/dev/null | grep -q '^image/'; then
      got="$pattern"
      break
    fi
    rm -f "$dest.part"
  done

  if [ -n "$got" ]; then
    mv "$dest.part" "$dest"
    ok=$((ok + 1))
    if [ -z "$WORKING" ]; then
      WORKING="$got"
      # Pin it for the rest of the run: the first brand pays for the search,
      # the other 185 do not.
      PATTERNS="$got"
      printf '%s  الگوی نشانی: %s%s\n' "$D" "$got" "$N"
    fi
    printf '%s  ✓ %s%s\n' "$G" "$slug" "$N"
  else
    rm -f "$dest.part"
    failed="$failed $slug"
    printf '%s  ✗ %s%s\n' "$R" "$slug" "$N"
  fi
done

printf '\n  %s✓ %s تازه%s   %s– %s از قبل بود%s\n' "$G" "$ok" "$N" "$D" "$skipped" "$N"

if [ -n "$failed" ]; then
  printf '  %s✗ ناموفق:%s%s\n' "$R" "$failed" "$N"
  printf '  %sدوباره اجرا کنید — فقط همین‌ها را می‌گیرد.%s\n' "$D" "$N"
fi

printf '\n%sبرای فرستادن به مخزن:%s\n' "$D" "$N"
printf '  cd %s && zip -qr /tmp/brand-logos.zip brands && ls -lh /tmp/brand-logos.zip\n\n' \
  "$ROOT/frontend/assets"
