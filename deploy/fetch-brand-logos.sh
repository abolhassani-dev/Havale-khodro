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

G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; D=$'\e[2m'; N=$'\e[0m'

[ -f "$DATA" ] || { printf '%s✗ فایل کاتالوگ پیدا نشد: %s%s\n' "$R" "$DATA" "$N"; exit 1; }
command -v curl >/dev/null || { printf '%s✗ curl نصب نیست%s\n' "$R" "$N"; exit 1; }

mkdir -p "$OUT"

# The slug list comes from the catalogue file rather than from a list kept here,
# so a brand added to the catalogue is a brand this fetches — with no second
# place to remember to edit.
# Every brand, not only the ones the catalogue already records a logo for.
#
# It used to filter on that field, which is backwards: the field is written by
# the build step *from what this script downloads*. With no logos yet recorded
# — the normal starting state — it selected nothing and exited saying no brand
# had a logo, which was true and completely useless.
slugs="$(
  python3 -c '
import json,sys
d=json.load(open(sys.argv[1]))
for b in d["brands"]: print(b["slug"])
' "$DATA" 2>/dev/null
)"

[ -n "$slugs" ] || { printf '%s✗ برندی در فایل کاتالوگ نبود%s\n' "$R" "$N"; exit 1; }

total="$(printf '%s\n' "$slugs" | wc -l | tr -d ' ')"
printf '\n%s▌ دریافت لوگوی %s برند%s\n\n' "$Y" "$total" "$N"

# Where to look, in order.
#
# Two sites, because neither has all of them. Bama publishes logos only for the
# eight brands in its own featured row; Divar has them for ordinary brands too,
# which is where the rest have to come from.
#
# Both are full address templates rather than a shared base with suffixes: the
# two sites agree on nothing about their paths, and pretending otherwise is how
# the earlier version ended up appending guessed extensions to a base that was
# never right.
#
# The slug is ours, which came from Bama. Divar's own slugs mostly match — both
# are Latin transliterations of the same names — and where they do not, the
# brand lands in the failure list at the end rather than silently going without.
#
# Assigned in two steps rather than with `${LOGO_SOURCES:-…}`: a default
# containing `}` ends the parameter expansion at the first one, so the list
# came out truncated and every download failed while the script reported
# nothing unusual.
SOURCES="${LOGO_SOURCES:-}"
if [ -z "$SOURCES" ]; then
  SOURCES='https://s100.divarcdn.com/static/imgs/widget-icons/light/icon_secondary/v1/brand_{slug}.png
https://cdn-sth1.bama.ir/evonex/filters/brand/car/{slug}.png'
fi

# Every candidate ends in .png and every file is saved as .png, which is not a
# detail to get casual about: nginx types a file by its extension, so an SVG
# saved under a .png name is served as image/png and shows as broken.

# Names the other sites use for the same brand.
#
# Our slugs came from Bama; the other site transliterates the same names its
# own way, and the two disagree on roughly a third of them — `alfaromeo` there
# is `alfa_romeo`, `landrover` is `land_rover`. There is no rule to derive one
# from the other, because there is no rule behind either: they are two people's
# spellings of a Persian name.
#
# So it is a lookup table, kept as data next to this script rather than as a
# list inside it. Each line is `ourslug theirslug`, `#` starts a comment, and a
# brand with no line just uses its own slug.
ALIASES="$ROOT/deploy/brand-logo-aliases.txt"

alias_for() {
  [ -f "$ALIASES" ] || { printf '%s' "$1"; return; }
  # The first field matched exactly, so `mg` never matches `mgt`. Falls back to
  # the slug itself when there is no line for it.
  awk -v s="$1" '$1 == s && $1 !~ /^#/ { print $2; found = 1; exit }
                 END { if (!found) print s }' "$ALIASES"
}

ok=0; skipped=0; failed=""
for slug in $slugs; do
  dest="$OUT/$slug.png"

  if [ -s "$dest" ]; then
    skipped=$((skipped + 1))
    continue
  fi

  # The file is always named for *our* slug; only the address uses theirs.
  remote="$(alias_for "$slug")"

  # Every candidate is tried for every brand.
  #
  # An earlier version pinned the first pattern that worked and used only that
  # one afterwards, on the theory that the source is consistent. It is not:
  # three brands answered on a pattern the other 183 do not have, so the run
  # locked onto it and reported 183 failures that were never really tried. A
  # few extra requests are cheaper than a result that is quietly wrong.
  got=""
  for template in $SOURCES; do
    url="$(printf '%s' "$template" | sed "s|{slug}|$remote|g")"

    # --fail so an HTML or XML error page is never saved as if it were an
    # image, and a short timeout so one dead entry cannot stall the run.
    curl -sS --fail --max-time 20 -o "$dest.part" "$url" 2>/dev/null || { rm -f "$dest.part"; continue; }

    # Downloaded is not the same as usable: a zero-byte or non-image reply is a
    # failure that looks like a success until somebody opens the page.
    if [ -s "$dest.part" ] && file -b --mime-type "$dest.part" 2>/dev/null | grep -q '^image/'; then
      got="$url"
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
