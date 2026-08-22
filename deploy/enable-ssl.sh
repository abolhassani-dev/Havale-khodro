#!/usr/bin/env bash
#
# Get a Let's Encrypt certificate and switch the whole system to HTTPS.
#
# Safe to re-run: it skips issuance when a certificate already exists, and it
# validates the new nginx configuration before reloading — if anything is
# wrong the old configuration stays live rather than the site going down in
# the middle of the one step where you most want it up.
#
#   /opt/feranocar/deploy/enable-ssl.sh name@gmail.com
#
set -euo pipefail

DOMAIN="${DOMAIN:-feranocar.com}"
EMAIL="${1:-${EMAIL:-}}"

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
NGINX="$ROOT/deploy/nginx"

if [ -z "$EMAIL" ]; then
  echo "Usage: $0 your@email.com" >&2
  echo "  (Let's Encrypt uses it only to warn you before the certificate expires.)" >&2
  exit 1
fi

# The guide's example address is you@example.com, and a placeholder copied
# verbatim out of documentation is the most ordinary thing in the world. Let's
# Encrypt rejects it at account registration with a message about an "invalid
# email address", which reads as a problem with the domain rather than with the
# one word nobody meant to leave in. Caught here instead.
case "$EMAIL" in
  *@example.com|*@example.org|*@example.net|your@*|you@*|email@*)
    echo "✗ '$EMAIL' is the placeholder from the instructions, not an address." >&2
    echo "  Re-run with your own: $0 name@gmail.com" >&2
    exit 1
    ;;
esac
case "$EMAIL" in
  *@*.*) ;;
  *) echo "✗ '$EMAIL' does not look like an email address." >&2; exit 1 ;;
esac

# ---- 1. the domain must actually point here ----
#
# Checked first because a failed issuance burns one of five weekly attempts
# per domain, and the most common cause is DNS that has not propagated yet.
echo "→ checking DNS"
SERVER_IP="$(curl -fsS --max-time 10 https://api.ipify.org || true)"
DOMAIN_IP="$(getent hosts "$DOMAIN" | awk '{print $1; exit}' || true)"

if [ -z "$DOMAIN_IP" ]; then
  echo "✗ $DOMAIN does not resolve yet. Add the A records and wait a few minutes." >&2
  exit 1
fi
if [ -n "$SERVER_IP" ] && [ "$DOMAIN_IP" != "$SERVER_IP" ]; then
  echo "✗ $DOMAIN resolves to $DOMAIN_IP but this server is $SERVER_IP." >&2
  echo "  If Cloudflare is proxying (orange cloud), turn it grey and wait." >&2
  exit 1
fi
echo "  $DOMAIN → $DOMAIN_IP ✓"

# ---- 1.5 the container must be able to reach Let's Encrypt ----
#
# The host resolving your own domain proves nothing about what a container can
# resolve: Docker gives containers its own resolver, and when the host uses
# systemd-resolved (a loopback address a container cannot reach) Docker falls
# back to public resolvers — which are filtered on many Iranian networks. The
# result is certbot dying on "Failed to resolve acme-v02.api.letsencrypt.org",
# which reads like a Let's Encrypt outage and is a local DNS setting.
echo "→ checking that a container can reach Let's Encrypt"
if ! docker compose run --rm --entrypoint sh certbot \
     -c "getent hosts acme-v02.api.letsencrypt.org >/dev/null" 2>/dev/null; then
  echo "✗ containers on this machine cannot resolve acme-v02.api.letsencrypt.org." >&2
  echo >&2
  echo "  The host can resolve names, so this is Docker's resolver, not your DNS." >&2
  echo "  Give the Docker daemon resolvers that work from here:" >&2
  echo >&2
  echo "    cat > /etc/docker/daemon.json <<'JSON'" >&2
  echo "    { \"dns\": [\"178.22.122.100\", \"185.51.200.2\"] }" >&2
  echo "    JSON" >&2
  echo "    systemctl restart docker && cd $ROOT && docker compose up -d" >&2
  echo >&2
  echo "  (Those two are Shecan, which resolves from inside Iran. 1.1.1.1 and" >&2
  echo "   8.8.8.8 work on some networks and are filtered on others — try them" >&2
  echo "   first if you prefer.) Then run this script again." >&2
  exit 1
fi
echo "  reachable ✓"

# ---- 2. the certificate ----
have_cert() {
  docker compose run --rm --entrypoint sh certbot \
    -c "test -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem" 2>/dev/null
}

if have_cert; then
  echo "→ certificate already present, skipping issuance"
else
  echo "→ requesting a certificate for $DOMAIN and www.$DOMAIN"
  # webroot, not standalone: nginx keeps serving throughout, so the site never
  # goes down to prove it owns its own name.
  docker compose run --rm --entrypoint certbot certbot certonly \
    --webroot -w /var/www/certbot \
    -d "$DOMAIN" -d "www.$DOMAIN" \
    --email "$EMAIL" --agree-tos --no-eff-email --non-interactive

  have_cert || { echo "✗ certbot finished but no certificate is there." >&2; exit 1; }
fi

# ---- 3. write the HTTPS configuration ----
echo "→ writing HTTPS configuration"
cp "$NGINX/app.conf" "/tmp/app.conf.bak.$$" 2>/dev/null || true
cp "$NGINX/adminer.conf" "/tmp/adminer.conf.bak.$$" 2>/dev/null || true

SECURITY_HEADERS="add_header Strict-Transport-Security \"max-age=63072000\" always;
    add_header Content-Security-Policy \"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'\" always;
    add_header X-Content-Type-Options \"nosniff\" always;
    add_header Referrer-Policy \"same-origin\" always;
    add_header X-Frame-Options \"DENY\" always;"

cat > "$NGINX/ssl.conf" <<SSLCONF
# Generated by deploy/enable-ssl.sh — re-run that script to refresh this file.
# update.sh leaves it alone, because deleting it would take HTTPS down.

server {
    listen 443 ssl;
    # Standalone \`http2\` needs nginx 1.25+; docker-compose pins 1.27.
    http2 on;
    server_name $DOMAIN www.$DOMAIN;

    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    root /usr/share/nginx/html;
    index index.html;
    client_max_body_size 2m;
    server_tokens off;

    gzip on;
    gzip_types application/json text/plain text/css application/javascript image/svg+xml;
    gzip_min_length 1024;

    # Two years, and only now that HTTPS is known to work: a browser that has
    # seen this refuses plain HTTP for that long, including if you roll back.
    $SECURITY_HEADERS

    location /api/ {
        proxy_pass http://api;
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
        # Ticket attachments, same ceiling as the plain-HTTP config: without it
        # an upload dies as a bare nginx 413 before the API can explain.
        client_max_body_size 20m;
    }

    location = /api/v1/health {
        proxy_pass http://api/api/v1/health;
        proxy_set_header X-Forwarded-Proto \$scheme;
        access_log off;
    }

    location /assets/ { expires 1y; add_header Cache-Control "public, immutable"; }
    location /src/    { expires -1; add_header Cache-Control "no-cache"; }
    location /        { try_files \$uri \$uri/ /index.html; }
}
SSLCONF

# The database panel moves to TLS on the same port. Its two passwords were
# travelling in clear text until now, which is the main reason to do this step
# promptly rather than eventually.
cat > "$NGINX/adminer.conf" <<ADMCONF
# Generated by deploy/enable-ssl.sh. See the repository copy for the reasoning
# behind each layer; this is the same file with TLS turned on.

limit_req_zone \$binary_remote_addr zone=dbpanel:1m rate=10r/m;

server {
    listen 8443 ssl;
    http2 on;
    server_name $DOMAIN www.$DOMAIN;

    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    server_tokens off;
    limit_req zone=dbpanel burst=30 nodelay;

    auth_basic "Database";
    auth_basic_user_file /etc/nginx/conf.d/.htpasswd;

    location / {
        proxy_pass http://adminer:8080;
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
        client_max_body_size 64m;
    }
}
ADMCONF

# ---- 4. turn the redirect on ----
cat > "$NGINX/00-mode.conf" <<'MODECONF'
# Rewritten by enable-ssl.sh — HTTPS is live, so plain HTTP redirects.
map $host $force_https {
    default 1;
}
MODECONF

# ---- 5. validate before reloading ----
#
# `nginx -t` inside the running container: a broken file must be caught while
# the old configuration is still the live one.
echo "→ validating"
if ! docker compose exec -T web nginx -t 2>&1 | tail -2; then
  echo "✗ the new configuration is invalid — rolling back, nothing changed." >&2
  cp "/tmp/app.conf.bak.$$" "$NGINX/app.conf" 2>/dev/null || true
  cp "/tmp/adminer.conf.bak.$$" "$NGINX/adminer.conf" 2>/dev/null || true
  rm -f "$NGINX/ssl.conf"
  printf 'map $host $force_https {\n    default 0;\n}\n' > "$NGINX/00-mode.conf"
  exit 1
fi

echo "→ reloading nginx"
docker compose exec -T web nginx -s reload
rm -f "/tmp/app.conf.bak.$$" "/tmp/adminer.conf.bak.$$"

# ---- 6. automatic renewal ----
#
# A certificate lasts 90 days. Without this, the site comes up one morning
# with a browser warning and nobody knows why.
if [ ! -f /etc/cron.d/feranocar-certbot ]; then
  echo "→ installing the renewal cron job"
  cat > /etc/cron.d/feranocar-certbot <<CRON
# 03:17, twice a week. certbot decides for itself whether renewal is due.
#
# Output goes to a log rather than to /dev/null: a renewal that fails is
# otherwise completely silent for ninety days, and then the site breaks.
17 3 * * 1,4 root cd $ROOT && (docker compose run --rm --entrypoint certbot certbot renew && docker compose exec -T web nginx -s reload) >> /var/log/feranocar-certbot.log 2>&1
CRON
  chmod 644 /etc/cron.d/feranocar-certbot
fi

# ---- 7. say plainly whether it worked ----
echo
echo "--- https://$DOMAIN ---"
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' "https://$DOMAIN/"
echo "--- http redirect ---"
curl -sS -o /dev/null -w 'HTTP %{http_code} → %{redirect_url}\n' "http://$DOMAIN/"
echo "--- api ---"
curl -sS -w '\n' "https://$DOMAIN/api/v1/health"
echo
echo "✓ done. The panel is now at https://$DOMAIN and the database at https://$DOMAIN:8443"
echo "  Verify renewal works before you forget it exists:"
echo "  docker compose run --rm --entrypoint certbot certbot renew --dry-run"
