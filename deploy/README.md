# deploy/ — کدام اسکریپت، کِی

همه روی سرور و با root اجرا می‌شوند (`/opt/feranocar/deploy/…`). هر اسکریپت بالای
خودش «چرا» را توضیح می‌دهد؛ این فهرست فقط می‌گوید کدام را کِی بزنید.

## روزمره

| کار | اسکریپت | یادداشت |
|---|---|---|
| **دیپلوی نسخه‌ی جدید** | `update.sh` | **دو بار** بزنید — بار اول خودش را بازنویسی می‌کند. کرون‌ها، logrotate و فایل‌های TLS را هم تازه می‌کند. |
| آیا سرور همان‌طور است که باید؟ | `preflight.sh` | ۱۴ ماژول در `preflight.d/`؛ بعد از هر دیپلوی و هر ماه. |
| سایت کند شده؟ | `panel-check.sh --account admin` | از دید مرورگر اندازه می‌گیرد. |
| چرا کند است؟ | `perf-check.sh` | از دید سرور. |
| کدام کانال هشدار می‌رسد؟ | `alert-probe.sh` | |

## یک‌بار / راه‌اندازی

| کار | اسکریپت |
|---|---|
| گواهی TLS و سوئیچ به HTTPS | `enable-ssl.sh name@mail.com` |
| فایل‌های nginx برای TLS (بدون certbot) | `nginx/write-ssl.sh feranocar.com` — `update.sh` خودش می‌زند |
| اتصال ربات هشدار (بله/تلگرام) | `alert-setup.sh` — توکن را همان‌جا می‌پرسد، چاپ نمی‌کند |
| لوگوی برندها | `fetch-brand-logos.sh` |
| تست بار | `loadtest.sh` — حساب‌ها از فایل بیرون مخزن (`--accounts-file`) |

## کرون (توسط `update.sh` نصب می‌شود)

| اسکریپت | زمان | کار |
|---|---|---|
| `nightly.sh` | ۰۳:۳۰ | آرشیو و پاک‌سازی لاگ‌ها، نشست‌ها، پیامک‌ها، تاریخچه‌ی قیمت (`src/jobs/nightly.js`) |
| `car-prices.sh` | دقیقه‌های ۰۷/۲۲/۳۷/۵۲ | فهرست قیمت بازار (`src/jobs/car-prices.js`) — `--dry-run` برای فقط بررسی |
| `backup.sh daily\|weekly\|monthly` | طبق `deployment.md` | آرشیو کامل قابل بازگردانی |
| `verify-backup.sh` | ماهانه (دستی) | restore در دیتابیس موقت و شمارش |
| `watchdog.sh` | هر ۵ دقیقه | تشخیص و ترمیم؛ `notify.sh` را صدا می‌زند |
| `notify.sh` | — | یک هشدار، یک بار؛ dedupe و سقف در ساعت |

## nginx/

| فایل | مالک | نقش |
|---|---|---|
| `app.conf` | مخزن | سرور HTTP: `listen 80` + `include site.inc` |
| `site.inc` | مخزن | **بدنه‌ی سایت** — هر location، سربرگ، محدودیت و تله؛ هر دو سرور آن را include می‌کنند |
| `security-headers.inc` | مخزن | CSP, nosniff, frame, referrer, permissions, COOP/CORP, HSTS — در هر location که سربرگ خودش را دارد include می‌شود |
| `00-mode.conf` | **سرور** | `force_https` ۰/۱ — `enable-ssl.sh` می‌نویسد، `update.sh` دست نمی‌زند |
| `01-redirect.conf` | مخزن | `go_https` = «HTTPS فعال است **و** این درخواست HTTP است» |
| `ssl.conf` | **سرور** (تولیدشده) | سرور ۴۴۳؛ `write-ssl.sh` می‌سازد و هر دیپلوی تازه می‌شود |
| `adminer.conf` | مخزن / **سرور** بعد از TLS | پنل دیتابیس روی ۸۴۴۳ |
| `.htpasswd` | **سرور** | رمز Basic Auth پنل دیتابیس — هرگز کامیت نمی‌شود |

قاعده‌ی nginx که یک بار گاز گرفت: `add_header` به بلاکی که خودش سربرگی دارد به
ارث نمی‌رسد. هر `location` تازه که `add_header` می‌نویسد باید
`include security-headers.inc` هم داشته باشد.
