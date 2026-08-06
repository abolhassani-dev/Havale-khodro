#!/usr/bin/env bash
#
# Update a running deployment in place.
#
# Why this exists rather than a line of instructions:
#
# The `web` container bind-mounts ./frontend and ./deploy/nginx. Docker resolves
# a bind mount to a *directory*, once, when the container is created — not to the
# path, every time. Replace the directory (`mv old away && extract new`) and the
# running container keeps the old one. Delete that old one and the container is
# mounted on nothing at all.
#
# That is what a 403 from nginx on the home page means here: the document root
# exists as far as the container is concerned, but index.html is not in it, so
# try_files falls through to a directory with autoindex off. Nothing in the
# application is wrong, and nothing in the logs says so either.
#
# So this script never moves the project directory. It updates the files inside
# it, keeping the directory itself — and therefore every mount — intact, and it
# recreates `web` afterwards so a changed nginx config is actually loaded.
#
#   /opt/feranocar/deploy/update.sh
#
set -euo pipefail

BRANCH="${BRANCH:-claude/delegation-platform-phase-one-0xfqz7}"
REPO="${REPO:-abolhassani-dev/Havale-khodro}"

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
echo "→ project: $ROOT"

if [ ! -f docker-compose.yml ]; then
  echo "✗ docker-compose.yml is not here. Run this from inside the project." >&2
  exit 1
fi

# ---- 1. back up before changing anything ----
#
# The repository's own script, not /usr/local/bin/feranocar-backup.
#
# That shortcut is installed once by hand and then never revisited, so on this
# server it was still a 333-byte script from an early version: a database dump
# and nothing else. Which made the single most important backup — the one taken
# immediately before changing the system, the one you reach for when an update
# breaks something — the least complete one on the disk. No .env, so no
# encryption key; no certificate; no source.
#
# deploy/backup.sh is updated by this very script, so it is always current by
# definition. The shortcut stays for people typing it by hand.
if [ -x ./deploy/backup.sh ]; then
  echo "→ backup"
  ./deploy/backup.sh daily
else
  echo "→ deploy/backup.sh is missing — skipping the pre-update backup" >&2
fi

# ---- 2. bring in the new code, without replacing this directory ----
# Files the server owns, which an update must never take back. Each one is
# written on this machine and exists nowhere upstream in its server form:
#   .env             the secrets, generated here
#   .htpasswd        the database panel password
#   ssl.conf         written by enable-ssl.sh; deleting it takes HTTPS down
#   00-mode.conf     the HTTP→HTTPS switch, flipped to 1 by enable-ssl.sh
#   adminer.conf     rewritten with TLS by enable-ssl.sh
LOCAL_FILES=(
  .env
  deploy/nginx/.htpasswd
  deploy/nginx/ssl.conf
  deploy/nginx/00-mode.conf
  deploy/nginx/adminer.conf
)

if [ -d .git ]; then
  echo "→ git pull ($BRANCH)"
  git fetch origin "$BRANCH"

  # `git reset --hard` restores every *tracked* file to what upstream says —
  # and two of the files above are tracked: 00-mode.conf and adminer.conf ship
  # in their pre-TLS form, because that is what a fresh install needs. On a
  # server where enable-ssl.sh has already run, a plain reset therefore turns
  # the HTTPS redirect back off and drops Adminer back to clear text, silently,
  # as a *side effect of updating*. The tarball path below already excluded
  # them; this path did not. So: hold them aside, reset, put them back.
  KEEP="$(mktemp -d)"
  trap 'rm -rf "$KEEP"' EXIT
  for f in "${LOCAL_FILES[@]}"; do
    [ -f "$f" ] || continue
    mkdir -p "$KEEP/$(dirname "$f")"
    cp -p "$f" "$KEEP/$f"
  done

  git checkout -B "$BRANCH" "origin/$BRANCH"
  git reset --hard "origin/$BRANCH"

  for f in "${LOCAL_FILES[@]}"; do
    [ -f "$KEEP/$f" ] || continue
    if ! cmp -s "$KEEP/$f" "$f" 2>/dev/null; then
      echo "  ↩ keeping this server's $f"
    fi
    cp -p "$KEEP/$f" "$f"
  done
  # Note: this means improvements to adminer.conf do not reach a TLS-enabled
  # server through an update. They arrive by re-running deploy/enable-ssl.sh,
  # which regenerates that file from its own template.
else
  # Installed from a tarball. Extract to a temporary directory and copy the
  # contents over the top; `--strip-components=1` drops the wrapper directory
  # GitHub adds. `.env` is never in the archive, so it survives untouched.
  echo "→ downloading $BRANCH"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT

  curl -fsSL -o "$TMP/src.tar.gz" \
    "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH"
  mkdir -p "$TMP/src"
  tar xzf "$TMP/src.tar.gz" --strip-components=1 -C "$TMP/src"

  # rsync deletes files removed upstream, which plain tar-over-the-top would
  # leave behind in a public document root. --exclude protects local state.
  if ! command -v rsync >/dev/null 2>&1; then
    echo "→ installing rsync"
    apt-get update -qq && apt-get install -y -qq rsync
  fi
  # Built from the one LOCAL_FILES list above rather than repeated here. The
  # two lists used to be written out separately, and they drifted: this path
  # protected 00-mode.conf and adminer.conf while the git path above quietly
  # reverted them. One list, both paths.
  EXCLUDES=(--exclude='.git')
  for f in "${LOCAL_FILES[@]}"; do EXCLUDES+=("--exclude=$f"); done

  rsync -a --delete "${EXCLUDES[@]}" "$TMP/src/" "$ROOT/"
fi

# ---- 3. refuse to restart into a broken state ----
#
# Catching this here costs a second. Catching it in a browser costs the evening,
# because a 403 looks like a permissions problem and is not one.
[ -f frontend/index.html ] || { echo "✗ frontend/index.html is missing — stopping." >&2; exit 1; }
[ -f .env ]                || { echo "✗ .env is missing — stopping." >&2; exit 1; }

# The database panel's password file must be readable by nginx's worker, which
# runs as `nginx` inside the container and not as root. At 600 the password
# prompt still appears and the *correct* password then returns 500 — a failure
# that looks like a broken panel and is a file mode. Fixed here rather than
# reported, because there is exactly one right answer: the file holds a hash,
# and its directory is root-only.
if [ -f deploy/nginx/.htpasswd ] && [ "$(stat -c '%a' deploy/nginx/.htpasswd)" != "644" ]; then
  echo "→ fixing deploy/nginx/.htpasswd permissions (must be readable by nginx)"
  chmod 644 deploy/nginx/.htpasswd
fi

# A stale rate limit locks real people out.
#
# The value this project shipped with first was 100 requests per fifteen
# minutes, which cannot serve a working panel: one dashboard view is five to
# seven API calls, so an administrator hit the wall in about fifteen clicks and
# was told to go away mid-task. The code now enforces a floor of 600 regardless
# of .env, but an .env that still says 100 is confusing to read, so it is
# corrected here too.
CURRENT_LIMIT="$(grep -E '^RATE_LIMIT_MAX=' .env 2>/dev/null | cut -d= -f2 || true)"
if [ -n "$CURRENT_LIMIT" ] && [ "$CURRENT_LIMIT" -lt 600 ] 2>/dev/null; then
  echo "→ raising RATE_LIMIT_MAX from $CURRENT_LIMIT to 1200 (the old value locks out normal use)"
  sed -i 's|^RATE_LIMIT_MAX=.*|RATE_LIMIT_MAX=1200|' .env
fi

# ---- 4. rebuild and restart ----
echo "→ rebuilding"
docker compose up -d --build

# `web` is an unchanged stock nginx image, so compose leaves it running and it
# keeps both its old mounts and its old configuration. Recreating it explicitly
# is the only way a changed app.conf takes effect.
echo "→ recreating web"
docker compose up -d --force-recreate --no-deps web

# ---- 5. say plainly whether it worked ----
echo "→ waiting for the API"
for _ in $(seq 1 30); do
  sleep 2
  if curl -fsS http://localhost/api/v1/health >/dev/null 2>&1; then break; fi
done

echo
docker compose ps
echo
echo "--- health ---"
curl -fsS http://localhost/api/v1/health || echo "✗ the API did not answer"
echo
echo "--- frontend ---"
code="$(curl -s -o /dev/null -w '%{http_code}' http://localhost/)"
echo "HTTP $code (plain)"
case "$code" in
  200)
    # No certificate yet: plain HTTP is the site.
    if [ -f deploy/nginx/ssl.conf ]; then
      echo "✗ HTTPS is configured but plain HTTP is not redirecting."
      echo "  Check deploy/nginx/00-mode.conf — it should say default 1."
    else
      echo "✓ up"
    fi
    ;;
  301|308)
    # Once TLS is on, a redirect here is the correct answer and 200 would be
    # the bug. The first version of this check called 301 "unexpected", which
    # reported a healthy system as broken on the very run that made it healthy.
    echo -n "  redirect is correct — following it over HTTPS: "
    https="$(curl -sk -o /dev/null -w '%{http_code}' https://localhost/)"
    echo "HTTP $https"
    if [ "$https" = "200" ]; then echo "✓ up over HTTPS"; else
      echo "✗ HTTP redirects but HTTPS did not answer 200 — docker compose logs web --tail 30"
    fi
    ;;
  403)
    echo "✗ 403 — the document root has no index.html. The web container is"
    echo "  probably mounted on a directory that was moved or deleted."
    echo "  Fix: docker compose up -d --force-recreate --no-deps web"
    ;;
  *) echo "✗ unexpected — docker compose logs web --tail 30" ;;
esac
