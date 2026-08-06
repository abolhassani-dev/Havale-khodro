# shellcheck shell=bash disable=SC2154
# دسترسی — SSH، فایروال، پورت‌های باز
#
# Portable.

section "۱۲ — دسترسی و فایروال"

# ── SSH ──────────────────────────────────────────────────────────────────────
#
# Key-only is the goal; password login plus fail2ban is the accepted interim;
# password login alone is the one real problem.
sshd_pw="$(sshd -T 2>/dev/null | awk '/^passwordauthentication /{print $2}')"
sshd_root="$(sshd -T 2>/dev/null | awk '/^permitrootlogin /{print $2}')"

if [ -z "$sshd_pw" ]; then
  skip "وضعیت SSH خوانده نشد (sshd -T نیاز به root دارد)"
elif [ "$sshd_pw" = "no" ]; then
  ok "ورود SSH با رمز بسته است (فقط کلید)"
elif systemctl is-active --quiet fail2ban 2>/dev/null; then
  warn "ورود SSH با رمز باز است — fail2ban هست، ولی جای کلید را نمی‌گیرد" \
       "docs/deployment.md گام ۱ — بعد از تست کلید: PasswordAuthentication no"
else
  bad "ورود SSH با رمز باز است و fail2ban هم نصب نیست" \
      "apt install -y fail2ban && systemctl enable --now fail2ban  (و بعد گام ۱ سند)"
fi

# Root over SSH with a password is the single most-attacked door on the
# internet. `prohibit-password` (key-only root) is fine.
case "$sshd_root" in
  ''|no|prohibit-password|without-password|forced-commands-only)
    [ -n "$sshd_root" ] && ok "ورود مستقیم root با رمز بسته است" ;;
  *) bad "ورود مستقیم root با رمز باز است" \
         "در /etc/ssh/sshd_config: PermitRootLogin prohibit-password && systemctl reload ssh" ;;
esac

if systemctl is-active --quiet fail2ban 2>/dev/null; then
  banned="$(fail2ban-client status sshd 2>/dev/null | awk -F: '/Currently banned/{print $2}' | tr -d ' ')"
  ok "fail2ban فعال است${banned:+ (${banned} آی‌پی مسدود)}"
fi

# ── firewall ─────────────────────────────────────────────────────────────────
if have ufw && ufw status 2>/dev/null | grep -q '^Status: active'; then
  ok "فایروال ufw فعال است"
  rules="$(ufw status 2>/dev/null)"

  for p in $EXPECTED_PORTS; do
    echo "$rules" | grep -qE "(^|[^0-9])$p/tcp" || \
      warn "پورت $p در ufw باز نیست" "ufw allow $p/tcp"
  done

  if [ -f "$ROOT/deploy/nginx/adminer.conf" ] && [ -n "$DB_PANEL_PORT" ]; then
    echo "$rules" | grep -qE "(^|[^0-9])$DB_PANEL_PORT/tcp" \
      && ok "پورت $DB_PANEL_PORT (پنل دیتابیس) در فایروال باز است" \
      || warn "پنل دیتابیس نصب است ولی پورت $DB_PANEL_PORT در ufw باز نیست" "ufw allow $DB_PANEL_PORT/tcp"
  fi

  for p in $FORBIDDEN_PORTS; do
    echo "$rules" | grep -qE "(^|[^0-9])$p/tcp +ALLOW" \
      && bad "پورت $p از بیرون باز است — نباید باشد" "ufw delete allow $p/tcp"
  done
else
  bad "فایروال ufw فعال نیست" \
      "apt install -y ufw && ufw default deny incoming && $(for p in $EXPECTED_PORTS; do printf 'ufw allow %s/tcp && ' "$p"; done)ufw --force enable"
fi

# ── what is actually listening ───────────────────────────────────────────────
#
# The firewall is what we *told* the machine; this is what the machine is
# doing. They disagree more often than anyone expects — a container published
# on 0.0.0.0 by a compose file nobody re-read, a debug server left running.
if have ss; then
  allowed=" $EXPECTED_PORTS $DB_PANEL_PORT "
  unexpected=""
  while read -r port; do
    [ -n "$port" ] || continue
    case "$allowed" in *" $port "*) continue ;; esac
    unexpected="$unexpected $port"
  done <<< "$(ss -tlnH 2>/dev/null \
              | awk '{print $4}' \
              | grep -E '^(0\.0\.0\.0|\[::\]|\*):' \
              | sed 's/.*://' | sort -un)"

  if [ -z "$unexpected" ]; then
    ok "هیچ پورت غیرمنتظره‌ای روی همه‌ی رابط‌ها گوش نمی‌دهد"
  else
    warn "پورت‌های باز روی همه‌ی رابط‌ها که در فهرست انتظار نیستند:$unexpected" \
         "ss -tlnp | grep -E ':($(echo "$unexpected" | tr ' ' '|' | sed 's/^|//'))\\b'"
  fi
fi
