# shellcheck shell=bash disable=SC2154
# بررسی‌های کند — فقط با ‎--full
#
# Anything that talks to a third party, or takes more than a second or two,
# lives here. Kept out of the default run so preflight stays cheap enough to
# put in a cron entry.

[ "$FULL" = "1" ] || return 0 2>/dev/null || true

section "۹۵ — بررسی‌های کند (‎--full)"

# The certificate renews unattended twice a week. Its failure is silent until
# the site stops working, so rehearsing it is the only way to know.
if [ "$SSL_ON" = "1" ]; then
  if docker compose run --rm --entrypoint certbot certbot renew --dry-run 2>&1 \
     | grep -q 'simulated renewals succeeded'; then
    ok "تمدید خودکار گواهی واقعاً کار می‌کند"
  else
    bad "تمرین تمدید گواهی شکست خورد — گواهی سررسید که شد تمدید نمی‌شود" \
        "docker compose run --rm --entrypoint certbot certbot renew --dry-run   (خروجی کامل را ببینید)"
  fi
fi

# Does the off-site destination actually accept a file? Configured and working
# are different things, and the gap between them is only ever discovered when
# the server is already gone.
rc="$(env_get BACKUP_RCLONE_REMOTE)"
if [ -n "$rc" ] && have rclone; then
  if rclone lsd "$rc" >/dev/null 2>&1; then
    ok "مقصد بکاپ بیرونی پاسخ می‌دهد ($rc)"
  else
    bad "مقصد بکاپ بیرونی در دسترس نیست — بکاپ‌ها جایی نمی‌روند" "rclone lsd $rc   (خروجی را ببینید)"
  fi
fi

# Outbound internet from inside a container, which is what certificate renewal
# and Telegram alerts both need. The host having it is not the same thing —
# this project has already lost an evening to exactly that difference.
if [ "$(svc_state "$API_SERVICE")" = "running" ]; then
  if docker compose exec -T "$API_SERVICE" node -e \
       "require('https').get('https://api.telegram.org',r=>process.exit(0)).on('error',()=>process.exit(1))" 2>/dev/null; then
    ok "کانتینرها به اینترنت دسترسی دارند"
  else
    warn "کانتینر به اینترنت وصل نمی‌شود — هشدار تلگرام و تمدید گواهی به آن نیاز دارند" \
         "docker compose exec $API_SERVICE getent hosts api.telegram.org"
  fi
fi
