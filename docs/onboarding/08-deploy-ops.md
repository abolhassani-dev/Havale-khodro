# فصل ۸ — دیپلوی و بهره‌برداری

**در این فصل:** سرور چه شکلی است، کد چطور به آن می‌رسد، چه چیزهایی خودکار اجرا
می‌شوند، و وقتی چیزی خراب شد کجا نگاه کنید. ساختن سرور از صفر در
[`docs/deployment.md`](../deployment.md) است؛ فهرست «کدام اسکریپت، کِی» در
[`deploy/README.md`](../../deploy/README.md).

> **قاعده‌ی مهم:** مالک خودش دیپلوی می‌کند. شما کد را push می‌کنید و نتیجه‌ی
> `update.sh` را از او می‌گیرید. هیچ رمز، کلید یا خروجی حاوی راز در چت رد و بدل
> نمی‌شود.

---

## ۸.۱ سرور در یک نگاه

```
/opt/feranocar/                 ← نسخه‌ای از مخزن، همان شاخه‌ی توسعه
├── .env                        ← رازها (600، root) — هرگز در مخزن
├── docker-compose.yml
├── deploy/nginx/{.htpasswd, ssl.conf, 00-mode.conf, adminer.conf}   ← «مال سرور»؛ update.sh دست نمی‌زند
└── …

docker compose ps:  web (nginx :80/:443/:8443)  api  db  adminer
volumes:            feranocar_pgdata  feranocar_uploads  feranocar_certbot-certs  feranocar_archive
/var/backups/feranocar/{hourly,daily,weekly}
/var/log/feranocar-*.log        ← خروجی کرون‌ها، logrotate هفتگی
/etc/cron.d/feranocar-*         ← nightly, car-prices, backup, watchdog, certbot
```

فقط nginx پورت باز دارد. API (۳۰۰۰) و Postgres (۵۴۳۲) فقط در شبکه‌ی compose‌اند؛
preflight بسته بودنشان در ufw را چک می‌کند.

---

## ۸.۲ دیپلوی

```bash
ssh root@server
cd /opt/feranocar && ./deploy/update.sh && ./deploy/update.sh    # دو بار
./deploy/preflight.sh                                            # همه سبز؟
```

`update.sh` چه می‌کند: کد شاخه را می‌گیرد (`reset --hard` — به همین دلیل فایل‌های
«مال سرور» جدا نگه داشته می‌شوند)، commitهای تازه را چاپ می‌کند، `docker compose up
-d --build`، منتظر سلامت می‌ماند، کرون‌ها و logrotate را نصب/تازه می‌کند، و اگر
گواهی TLS هست `ssl.conf`/`adminer.conf` را از قالب دوباره می‌سازد. **دو بار** چون
اسکریپت وسط کار خودش را از مخزن بازنویسی می‌کند.

مایگریشن دیتابیس خودکار است: `docker/entrypoint.sh` در بوت `prisma migrate deploy`
می‌زند. seed هم اگر `SEED_ON_START=true`.

### اگر build به Docker Hub نرسید (۴۰۳)

Docker Hub از ایران بسته است. یک بار روی سرور:

```json
// /etc/docker/daemon.json
{ "registry-mirrors": ["https://docker.arvancloud.ir", "https://registry.docker.ir"] }
```

`systemctl restart docker` و دوباره `update.sh`. خودِ اسکریپت این راهنما را در
خطای ۴۰۳ چاپ می‌کند.

---

## ۸.۳ چه چیزهایی خودکار اجرا می‌شوند

| کرون | زمان | کار | لاگ |
|---|---|---|---|
| `feranocar-nightly` | ۰۳:۳۰ | `deploy/nightly.sh` → `src/jobs/nightly.js` | `/var/log/feranocar-nightly.log` |
| `feranocar-car-prices` | دقیقه‌های ۰۷،۲۲،۳۷،۵۲ | `deploy/car-prices.sh` → `src/jobs/car-prices.js` | `/var/log/feranocar-car-prices.log` |
| `feranocar-backup` | ساعتی / ۰۲:۳۰ روزانه / جمعه هفتگی | `deploy/backup.sh {hourly,daily,weekly}` (نگه‌داری: ۳۰ روز، ۱۲ هفته) | `/var/log/feranocar-backup.log` |
| `feranocar-watchdog` | هر ۵ دقیقه | `deploy/watchdog.sh` — سلامت، دیسک، کانتینر افتاده (یک بار در ساعت خودش بالا می‌آورد)، خلاصه‌ی روزانه | `/var/log/feranocar-watchdog.log` |
| `feranocar-certbot` | دوشنبه و پنجشنبه ۰۳:۱۷ | تمدید گواهی و reload nginx | `/var/log/feranocar-certbot.log` |

هر job در **کانتینر تازه** اجرا می‌شود (`docker compose run --rm api node …`)؛
وضعیت ماندگار در جدول `Setting`.

---

## ۸.۴ هشدار

`deploy/notify.sh` پیام را به ربات **بله** (پیش‌فرض؛ تلگرام از ایران فیلتر است —
`ALERT_API_BASE`) می‌فرستد، با dedupe به ازای مشکل، سقف ۱۲ در ساعت، پیام «برطرف
شد»، و تشدید پیامکی برای چند کلید خاص. API هم خطاهای ۵۰۰ و خرابی قیمت را از
`modules/alert` به همان ربات می‌فرستد. تنظیم اولیه: `deploy/alert-setup.sh` (توکن
را همان‌جا می‌پرسد؛ هیچ‌جا چاپ نمی‌شود). تست: `deploy/alert-probe.sh`.

---

## ۸.۵ بکاپ و بازگردانی

- آرشیو self-contained: دامپ دیتابیس (با نشانه‌ی پایان)، uploads، گواهی TLS،
  کرون‌ها، `.env`، مشخصات سرور، و یک `RESTORE.md` فارسی داخل خودش.
- **بکاپ خارج از سرور هنوز تنظیم نشده** (تصمیم مالک — در launch-checklist). وقتی
  شد، `backup.sh` با `BACKUP_REMOTE` می‌فرستد و نبودنش را بلند اعلام می‌کند.
- ماهی یک بار: `deploy/verify-backup.sh` — آخرین آرشیو را در دیتابیس موقت
  restore می‌کند و می‌شمارد.
- **هشدار امنیتی:** آرشیو حاوی `.env` است. روزی که `DATA_ENCRYPTION_KEY` فعال شد،
  آرشیو باید رمز شود (`security-audit.md` بند C1).

---

## ۸.۶ TLS

| فایل | کی می‌سازد |
|---|---|
| گواهی در volume `certbot-certs` | `deploy/enable-ssl.sh name@mail.com` — یک بار؛ تمدید با کرون |
| `deploy/nginx/ssl.conf`, `adminer.conf` (TLS) | `deploy/nginx/write-ssl.sh <domain>` — `enable-ssl.sh` بار اول و `update.sh` در هر دیپلوی |
| `deploy/nginx/00-mode.conf` | `enable-ssl.sh` (`force_https 1`) |

بدنه‌ی سایت برای هر دو سرور HTTP و HTTPS در `site.inc` است؛ تغییر nginx را همان‌جا
بدهید، نه در `ssl.conf` سرور.

---

## ۸.۷ وقتی چیزی خراب است

| نشانه | اول این‌جا |
|---|---|
| سایت بالا نمی‌آید | `docker compose ps`, `docker compose logs -f api`, `./deploy/watchdog.sh` |
| «۵۰۲» از nginx | API در حال بوت یا مرده؛ `docker compose logs api` — مایگریشن ناموفق؟ `.env` ناقص؟ |
| کند است | `./deploy/panel-check.sh --account admin` (از دید مرورگر)، `./deploy/perf-check.sh` (سرور)، پنل مالک ← لاگ فنی ← درخواست‌های کند |
| قیمت روز به‌روز نمی‌شود | `/var/log/feranocar-car-prices.log`؛ `./deploy/car-prices.sh --dry-run`؛ منبع فقط به مرورگر جواب می‌دهد؟ `CAR_PRICES_USER_AGENT` |
| نمایندگی می‌گوید «در جای دیگری وارد شده‌اید» | رفتار «یک نشست» — کسی دیگر با حسابش وارد شده، یا خودش از دو دستگاه |
| نمایندگی بیرون افتاده و نمی‌تواند وارد شود | قفل ۱۵ دقیقه‌ای؟ پنل مدیریت ← نمایندگی ← «خروج اجباری»/ریست رمز |
| دیسک پر | `docker system df`, `/var/backups`, `/archive`; logrotate کار می‌کند؟ `logrotate -d /etc/logrotate.d/feranocar` |
| هشدار نمی‌رسد | `./deploy/alert-probe.sh` |
| بعد از دیپلوی nginx بالا نمی‌آید | `.htpasswd` وجود دارد؟ `docker compose exec web nginx -t` |

**حالت‌های شناخته‌شده‌ی خرابی که یک بار اتفاق افتاده و حالا جلویشان گرفته شده**
بالای همان اسکریپت‌ها با «چرا» نوشته شده — قبل از تغییر هر اسکریپت، آن توضیح را
بخوانید.

---

## ۸.۸ چک‌لیست پیش از اولین نمایندگی واقعی

[`docs/launch-checklist.md`](../launch-checklist.md) — ترتیبش مهم است: بکاپ نهایی
→ (کلید رمزنگاری، اگر تصمیم گرفته شد) → `SEED_DEMO=false` → فرش کردن دیتابیس →
مدیر اول → بکاپ بیرونی → preflight.
