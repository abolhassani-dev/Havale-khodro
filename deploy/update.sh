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
if [ -x /usr/local/bin/feranocar-backup ]; then
  echo "→ backup"
  /usr/local/bin/feranocar-backup
else
  echo "→ no backup script installed — skipping (see docs/deployment.md step 9)"
fi

# ---- 2. bring in the new code, without replacing this directory ----
if [ -d .git ]; then
  echo "→ git pull ($BRANCH)"
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git reset --hard "origin/$BRANCH"
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
  # .htpasswd is created on the server and exists nowhere in the repository —
  # without this exclude, every update would delete it and lock the database
  # panel with a 500 until someone recreated it.
  # Local state that must survive an update, and why each one:
  #   .env             the secrets, generated on this machine
  #   .htpasswd        the database panel password (see below)
  #   ssl.conf         written by enable-ssl.sh; deleting it takes HTTPS down
  #   00-mode.conf     the HTTP→HTTPS switch, flipped by enable-ssl.sh
  #   adminer.conf     rewritten with TLS by enable-ssl.sh
  rsync -a --delete \
    --exclude='.env' \
    --exclude='.git' \
    --exclude='deploy/nginx/.htpasswd' \
    --exclude='deploy/nginx/ssl.conf' \
    --exclude='deploy/nginx/00-mode.conf' \
    --exclude='deploy/nginx/adminer.conf' \
    "$TMP/src/" "$ROOT/"
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
echo "HTTP $code"
case "$code" in
  200) echo "✓ up" ;;
  403) echo "✗ 403 — the document root has no index.html. The web container is"
       echo "  probably mounted on a directory that was moved or deleted."
       echo "  Fix: docker compose up -d --force-recreate --no-deps web" ;;
  *)   echo "✗ unexpected — docker compose logs web --tail 30" ;;
esac
