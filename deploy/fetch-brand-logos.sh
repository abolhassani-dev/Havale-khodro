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
# Not the address in the catalogue data. That field points at
# `/assets/filter/car-brand-logo/<slug>`, which answers AccessDenied — it is
# stale, and following it got three logos out of 186. The address the site
# itself requests is this one, read off the browser's network tab, which is the
# only place the truth was written down.
#
# Overridable so the script can be tested against a local server. A fetcher
# that has only ever been run against the real thing is a fetcher whose failure
# path nobody has seen.
BASE="${LOGO_BASE:-https://cdn-sth1.bama.ir/evonex/filters/brand/car}"

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

# Candidate addresses, most likely first. `.png` is what the site asks for;
# the others are there because a handful of brands may not have one.
#
# Assigned in two steps rather than with `${LOGO_PATTERNS:-…}`: a default
# containing `}` ends the parameter expansion at the first one, so the list
# came out truncated and every download failed while the script reported
# nothing unusual.
PATTERNS="${LOGO_PATTERNS:-}"
if [ -z "$PATTERNS" ]; then
  PATTERNS='{base}/{slug}.png {base}/{slug}.svg {base}/{slug}.webp {base}/{slug}.jpg'
fi

ok=0; skipped=0; failed=""
for slug in $slugs; do
  dest="$OUT/$slug.png"

  if [ -s "$dest" ]; then
    skipped=$((skipped + 1))
    continue
  fi

  # Every candidate is tried for every brand.
  #
  # An earlier version pinned the first pattern that worked and used only that
  # one afterwards, on the theory that the source is consistent. It is not:
  # three brands answered on a pattern the other 183 do not have, so the run
  # locked onto it and reported 183 failures that were never really tried. A
  # few extra requests are cheaper than a result that is quietly wrong.
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

# tar rather than zip: tar is on every Ubuntu, zip is not — and «Command 'zip'
# not found» at the end of a successful download is a poor reward.
printf '\n%sبرای فرستادن به مخزن:%s\n' "$D" "$N"
printf '  tar -czf /tmp/brand-logos.tgz -C %s brands && ls -lh /tmp/brand-logos.tgz\n\n' \
  "$ROOT/frontend/assets"
