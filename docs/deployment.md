# استقرار روی سرور

سرور: `45.94.213.252` — Ubuntu 24.04، دسترسی `root` با کلید SSH.

**ترتیب کار عمدی است:** اول سیستم را روی همان IP بالا می‌آوریم و مطمئن می‌شویم کار می‌کند،
بعد سراغ دامنه و SSL می‌رویم. اگر برعکس عمل کنیم و جایی خطا بخورد، نمی‌دانیم مشکل از
اپلیکیشن است یا از DNS یا از گواهی.

هر گام یک **بررسی** دارد. تا وقتی بررسی سبز نشده، به گام بعد نروید — و خروجی را برای من
بفرستید.

> **هیچ رمزی را در چت نفرستید.** رمزها را روی خود سرور تولید می‌کنید و همان‌جا در `.env`
> می‌مانند. من فقط دستور می‌دهم.

---

## گام ۰ — اتصال

روی کامپیوتر خودتان:

```bash
ssh root@45.94.213.252
```

اگر وصل شد، ادامه دهید.

---

## گام ۱ — کلید SSH

> ⛔ **این گام را قبل از گام ۲ انجام دهید و از رویش نپرید.**
>
> نسخه‌ی اول این سند فرض کرده بود شما کلید دارید و مستقیم می‌گفت ورود با رمز را ببندید.
> اگر آن دستور را با شرایط فعلی اجرا کنید، **برای همیشه بیرون از سرور قفل می‌شوید** —
> رمز دیگر کار نمی‌کند و کلیدی هم در کار نیست. تنها راه برگشت، کنسول اضطراری شرکت
> هاستینگ است.

### چرا حالا و نه بعداً

سرور شما یک IP عمومی ایرانی است و اسکنرها این محدوده‌ها را دائم می‌گردند. `root` + رمز
یعنی هر کسی در دنیا می‌تواند بی‌نهایت بار رمز را حدس بزند. کلید ساختن **پنج دقیقه** طول
می‌کشد و این در را کامل می‌بندد. هر کار دیگری در این سند — فایروال، گواهی، CSP — پشت
همین یک در است.

### ۱. کلید بسازید (روی کامپیوتر خودتان، نه روی سرور)

```bash
ssh-keygen -t ed25519 -C "feranocar-server"
```

سه بار Enter کافی است (مسیر پیش‌فرض، و اگر خواستید یک رمز روی خود کلید بگذارید).
`ed25519` از RSA کوتاه‌تر و امن‌تر است.

> ویندوز: همین دستور در PowerShell کار می‌کند. اگر نه، از Git Bash استفاده کنید.

### ۲. کلید عمومی را روی سرور بگذارید

```bash
ssh-copy-id root@45.94.213.252
```

رمز را یک بار می‌پرسد — آخرین باری که لازمش دارید.

اگر `ssh-copy-id` نداشتید (ویندوز):

```bash
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@45.94.213.252 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

### ۳. تست کنید — این مهم‌ترین قدم است

**ترمینال فعلی را باز نگه دارید.** یک ترمینال تازه باز کنید:

```bash
ssh root@45.94.213.252
```

اگر **بدون پرسیدن رمز** وارد شد، کلید کار می‌کند. اگر رمز پرسید، هنوز چیزی درست نیست —
گام ۴ را اجرا نکنید و خروجی را بفرستید.

### ۴. حالا ورود با رمز را ببندید

فقط بعد از اینکه گام ۳ سبز شد:

```bash
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sshd -t && systemctl restart ssh
```

`sshd -t` اول کانفیگ را تست می‌کند. اگر خطا داد، `systemctl restart` اجرا نمی‌شود و
نشست فعلی‌تان سالم می‌ماند.

**بررسی — باز هم با ترمینال فعلی باز:**

```bash
ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no root@45.94.213.252
```

انتظار: `Permission denied`. یعنی در رمز بسته شده و کلید تنها راه است.

---

## اگر واقعاً می‌خواهید کلید را به بعد موکول کنید

قابل قبول است، ولی **جبرانش لازم است.** تا آن روز حداقل این دو کار را بکنید:

```bash
# fail2ban: بعد از چند تلاش ناموفق، آی‌پی مهاجم را موقتاً می‌بندد.
apt install -y fail2ban
cat > /etc/fail2ban/jail.local <<'JAIL'
[sshd]
enabled  = true
maxretry = 4
findtime = 10m
bantime  = 2h
JAIL
systemctl enable --now fail2ban
```

و **رمز root را به یک رمز طولانی و تصادفی عوض کنید** — نه چیزی که به خاطر می‌سپارید:

```bash
openssl rand -base64 24     # این را جایی امن نگه دارید
passwd root
```

**بررسی:**

```bash
fail2ban-client status sshd
```

> این‌ها جای کلید را نمی‌گیرند، فقط هزینه‌ی حمله را بالا می‌برند. کلید را در اولین فرصت
> راه بیندازید.

---

## گام ۱.۵ — بقیه‌ی امن‌سازی پایه

```bash
# به‌روزرسانی
apt update && apt upgrade -y

# ساعت سرور روی وقت ایران — لاگ‌ها و سقف روزانه‌ی نمایش مشخصات به آن وابسته‌اند
timedatectl set-timezone Asia/Tehran

# فایروال: فقط SSH و وب. بقیه بسته.
apt install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

**بررسی:**

```bash
ufw status && timedatectl | grep "Time zone"
```

انتظار: `Status: active` و `Asia/Tehran`.

---

## گام ۲ — نصب Docker

```bash
apt install -y ca-certificates curl git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

**بررسی:**

```bash
docker --version && docker compose version
```

> اگر `download.docker.com` از داخل ایران باز نشد، بگویید — راه جایگزین با مخزن داخلی هست.

---

## گام ۳ — آوردن کد

```bash
mkdir -p /opt && cd /opt
git clone https://github.com/abolhassani-dev/Havale-khodro.git feranocar
cd feranocar
git checkout claude/delegation-platform-phase-one-0xfqz7
```

اگر مخزن خصوصی است، گیت نام کاربری و **توکن** می‌خواهد (نه رمز گیت‌هاب). از
Settings → Developer settings → Personal access tokens یک توکن با دسترسی `repo` بسازید.

**بررسی:**

```bash
ls -la /opt/feranocar
```

انتظار: پوشه‌های `backend`، `frontend`، `deploy` و فایل `docker-compose.yml`.

---

## گام ۴ — تنظیمات و رمزها

```bash
cd /opt/feranocar
cp .env.example .env

# سه راز را همین‌جا تولید و جایگزین می‌کنیم — هیچ‌کدام از چشم شما یا من رد نمی‌شود
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -base64 24)|"   .env
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|"            .env
sed -i "s|^SEED_ADMIN_PASSWORD=.*|SEED_ADMIN_PASSWORD=$(openssl rand -base64 18)|" .env

# فایل رمزها فقط برای root خواندنی باشد
chmod 600 .env
```

**داده‌ی نمونه** برای اینکه عرفان و مهدی صفحه‌ی خالی نبینند — **هر دو کلید لازم است**:

```bash
sed -i 's|^SEED_DEMO=.*|SEED_DEMO=true|'             .env
sed -i 's|^ALLOW_DEMO_SEED=.*|ALLOW_DEMO_SEED=true|' .env
```

چرا دو کلید؟ چون `NODE_ENV=production` است و این حساب‌ها رمزشان در مخزن نوشته شده. کلید
دوم یعنی «می‌دانم این ماشین هنوز واقعی نیست». اگر یادتان برود، سیستم بالا می‌آید و فقط
داده‌ی نمونه ساخته نمی‌شود — قابلیت اختیاری نباید بتواند سیستم را پایین بیاورد.

> ⚠️ روزی که نمایندگی واقعی وارد سیستم شد: هر دو کلید را `false` کنید و حساب‌های
> `alborz`, `pars`, `zagros`, `khalij` را از پنل مدیریت تعلیق کنید.

رمز مدیر کل را برای خودتان بردارید (روی سرور، نه در چت):

```bash
grep SEED_ADMIN_PASSWORD .env
```

---

## گام ۵ — بالا آوردن سیستم

```bash
cd /opt/feranocar
docker compose up -d --build
```

بار اول چند دقیقه طول می‌کشد (دانلود ایمیج‌ها و ساخت). بعدش:

```bash
docker compose ps
docker compose logs api --tail 40
```

انتظار در لاگ: `applying migrations` → `Super admin created` → `Catalog ready` → `starting`.

**بررسی — این مهم‌ترین بررسی این سند است:**

```bash
curl -s -w '\nHTTP %{http_code}\n' http://localhost/api/v1/health
curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://localhost/
```

انتظار: JSON با `"status":"ok"` و `"database":"up"`، و هر دو `HTTP 200`.

> دستورها را با `&&` به هم وصل نکنید. اگر nginx اتصال را ببندد، `curl` با کد خطا تمام
> می‌شود و بقیه‌ی زنجیره **اجرا نمی‌شود** — یعنی خروجی خالی می‌بینید و فکر می‌کنید دستور
> هنگ کرده، در حالی که جواب گرفته‌اید: «بسته شد». با `%{http_code}` هیچ حالتی بی‌صدا نیست.

**و از مرورگر خودتان:** `http://45.94.213.252` را باز کنید. باید صفحه‌ی ورود فارسی بیاید.
با `admin` و رمزی که در گام ۴ گرفتید وارد شوید — در اولین ورود رمز را عوض می‌کند.

> **اگر خطای Prisma دیدید:** نسخه‌ی اول این ایمیج روی `node:20-alpine` بود و موتور Prisma
> نمی‌توانست نسخه‌ی OpenSSL را تشخیص دهد. اصلاح شد (Debian slim + binaryTarget صریح).
> اگر مخزن را قبل از این اصلاح گرفته‌اید، `git pull` و بعد
> `docker compose build --no-cache api && docker compose up -d`.
>
> **اگر `docker compose up` خطای دیگری داد، خروجی کامل را بفرستید.** این اولین باری است که این
> Dockerfile واقعاً build می‌شود — من در محیطی کار می‌کنم که Docker ندارد، پس نحو compose را
> اعتبارسنجی کرده‌ام ولی خودِ build را شما اول اجرا می‌کنید.
>
> **کانفیگ nginx را اما واقعاً تست کردم:** nginx را محلی نصب کردم و روی همین فایل اجرا
> کردم — سرو فایل استاتیک، پروکسی `/api`، fallback مسیرهای SPA، هدرهای امنیتی، مسیر ACME،
> کش‌ها، و بلوک HTTPS (با گواهی خودامضا). همه جواب دادند.

---

## گام ۶ — دامنه

در پنل دامنه (یا کلادفلیر) دو رکورد بسازید:

| نوع | نام | مقدار | پروکسی |
|---|---|---|---|
| A | `@` | `45.94.213.252` | **ابر خاکستری** |
| A | `www` | `45.94.213.252` | **ابر خاکستری** |

**ابر نارنجی نه.** دلیلش را در `staging.md` بخش ۷ نوشته‌ام: کلادفلیر داخل ایران PoP ندارد،
پس ترافیک کاربر تهرانی از دبی رد می‌شود و برمی‌گردد — هم کندتر، هم روز اختلال بین‌الملل
سایت می‌خوابد در حالی که سرورش سالم است.

**بررسی** (روی سرور، بعد از چند دقیقه صبر برای انتشار DNS):

```bash
apt install -y dnsutils
dig +short feranocar.com
dig +short www.feranocar.com
```

انتظار: هر دو `45.94.213.252` را برگردانند. **تا وقتی این جواب نداده، گام ۷ را شروع نکنید** —
Let's Encrypt باید بتواند دامنه را به این سرور برساند، وگرنه صدور گواهی رد می‌شود و
سهمیه‌ی هفتگی‌تان مصرف می‌شود.

---

## گام ۷ — گواهی SSL

```bash
cd /opt/feranocar

docker compose run --rm --entrypoint certbot certbot certonly \
  --webroot -w /var/www/certbot \
  -d feranocar.com -d www.feranocar.com \
  --email YOUR_EMAIL@example.com \
  --agree-tos --no-eff-email
```

`YOUR_EMAIL` را با ایمیل خودتان عوض کنید (برای هشدار انقضای گواهی).

**بررسی:**

```bash
docker compose run --rm --entrypoint certbot certbot certificates
```

انتظار: گواهی `feranocar.com` با تاریخ انقضای حدود ۹۰ روز بعد.

سپس بلوک TLS را فعال کنید:

```bash
nano deploy/nginx/app.conf
```

- بلوک انتهایی `server { listen 443 ssl; ... }` را از حالت کامنت دربیاورید
  (در nano: علامت `#` ابتدای خطوط را پاک کنید)
- در بلوک پورت ۸۰، خط آخر `location / { try_files ... }` را با این عوض کنید:
  `location / { return 301 https://$host$request_uri; }`
- بلوک `location ^~ /.well-known/acme-challenge/` را **دست نزنید** — تمدید خودکار به آن نیاز دارد

بعد:

```bash
docker compose exec web nginx -t && docker compose exec web nginx -s reload
```

`nginx -t` اول تست می‌کند؛ اگر خطا داد، reload نکنید و خروجی را بفرستید.

**بررسی:** از مرورگر `https://feranocar.com` — باید قفل سبز بیاید و
`http://feranocar.com` خودکار به HTTPS برود.

---

## گام ۸ — تمدید خودکار گواهی

گواهی Let's Encrypt ۹۰ روزه است. اگر تمدید نشود، یک روز صبح سایت با خطای گواهی بالا می‌آید.

```bash
cat > /etc/cron.d/feranocar-certbot <<'CRON'
# ساعت ۳:۱۷ بامداد، دوبار در هفته. certbot خودش می‌فهمد هنوز وقتش نرسیده و کاری نمی‌کند.
17 3 * * 1,4 root cd /opt/feranocar && docker compose run --rm --entrypoint certbot certbot renew --quiet && docker compose exec -T web nginx -s reload
CRON
chmod 644 /etc/cron.d/feranocar-certbot
```

**بررسی — تمدید را شبیه‌سازی کنید تا روز واقعی غافلگیر نشوید:**

```bash
cd /opt/feranocar
docker compose run --rm --entrypoint certbot certbot renew --dry-run
```

انتظار: `Congratulations, all simulated renewals succeeded`.

---

## گام ۹ — بکاپ

بکاپی که روی همان سرور بماند، با از دست رفتن سرور از بین می‌رود — یعنی بکاپ نیست.
اسکریپت زیر یک فایل فشرده می‌سازد و ۱۴ نسخه‌ی آخر را نگه می‌دارد. **بردن نسخه‌ها به بیرون
از سرور کار شماست** و تا آن را نکرده‌اید، بکاپ کامل نیست.

```bash
mkdir -p /var/backups/feranocar
cat > /usr/local/bin/feranocar-backup <<'SH'
#!/bin/sh
set -e
cd /opt/feranocar
STAMP=$(date +%Y%m%d-%H%M)
OUT=/var/backups/feranocar/db-$STAMP.sql.gz
# --clean --if-exists: the dump can be restored onto a database that already has
# tables, which is the situation you are actually in when you need it.
docker compose exec -T db pg_dump -U "${POSTGRES_USER:-havale}" --clean --if-exists "${POSTGRES_DB:-havale}" | gzip > "$OUT"
chmod 600 "$OUT"
# Keep fourteen. Unbounded backups fill the disk, and a full disk takes the
# application down — a backup policy that causes an outage is not a policy.
ls -1t /var/backups/feranocar/db-*.sql.gz | tail -n +15 | xargs -r rm --
echo "$OUT"
SH
chmod 700 /usr/local/bin/feranocar-backup

cat > /etc/cron.d/feranocar-backup <<'CRON'
30 2 * * * root /usr/local/bin/feranocar-backup >> /var/log/feranocar-backup.log 2>&1
CRON
chmod 644 /etc/cron.d/feranocar-backup
```

**بررسی — یک بکاپ بگیرید و مطمئن شوید خالی نیست:**

```bash
/usr/local/bin/feranocar-backup
ls -lh /var/backups/feranocar/
```

انتظار: فایلی با حجم قابل توجه (نه چند بایت).

> **بکاپی که بازگردانی‌اش را امتحان نکرده‌اید، بکاپ نیست — یک فایل است.** یک بار روی یک
> سرور دیگر یا یک دیتابیس موقت بازگردانی‌اش کنید. اگر خواستید، دستورش را می‌دهم.

---

## مدیریت دیتابیس — Adminer

معادل phpMyAdmin برای PostgreSQL. با `update.sh` نصب می‌شود و همیشه روشن است، اما
**عمداً از اینترنت قابل دسترسی نیست** — فقط به `127.0.0.1` خود سرور گوش می‌دهد.

چرا؟ چون پنل دیتابیسی که روی اینترنت باز باشد، سریع‌ترین راه از دست دادن همه‌چیز است:
اسکنرها روزانه دنبال همین پنل‌ها می‌گردند و رمز پنل هم جلوی حمله‌ی خودکار دوام نمی‌آورد.
راه ورود شما **تونل SSH** است — یعنی همان کلیدی که از خود سرور محافظت می‌کند، از
دیتابیس هم محافظت می‌کند.

### ورود (هر بار)

**۱.** روی کامپیوتر خودتان (PowerShell یا CMD) این را بزنید و پنجره را باز نگه دارید:

```bash
ssh -L 8081:127.0.0.1:8081 root@45.94.213.252
```

همان ورود همیشگی SSH است، فقط یک «لوله» هم از کامپیوتر شما به سرور می‌کشد.

**۲.** در مرورگر خودتان باز کنید: **http://localhost:8081**

**۳.** فرم ورود Adminer:

| فیلد | مقدار |
|---|---|
| System | **PostgreSQL** |
| Server | `db` |
| Username | `havale` |
| Password | مقدار `POSTGRES_PASSWORD` از فایل `/opt/feranocar/.env` روی سرور |
| Database | `havale` |

رمز را اگر ندارید، روی سرور: `grep POSTGRES_PASSWORD /opt/feranocar/.env`

پنجره‌ی SSH را که ببندید، دسترسی هم قطع می‌شود — همین است که امنش می‌کند.

### دو هشدار

- **این در، از کنارِ همه‌ی قواعد برنامه رد می‌شود.** چیزی که این‌جا عوض کنید، نه در لاگ
  فعالیت ثبت می‌شود نه از قواعد ماسکینگ و اعتبارسنجی می‌گذرد. برای دیدن داده عالی است؛
  برای تغییر دادن، تا جای ممکن از خود پنل مدیریت استفاده کنید.
- **قبل از هر تغییر دستی، بکاپ:** `/usr/local/bin/feranocar-backup`

---

## گام ۱۰ — به‌روزرسانی در آینده

**یک دستور، همیشه همین:**

```bash
/opt/feranocar/deploy/update.sh
```

بکاپ می‌گیرد، کد را می‌آورد، build و ری‌استارت می‌کند، و آخرش خودش سلامت سیستم را
بررسی می‌کند و می‌گوید بالا آمد یا نه. مهاجرت دیتابیس خودکار موقع بالا آمدن اعمال می‌شود.

### چرا اسکریپت، و نه چند خط دستور

دو تله در به‌روزرسانی دستی هست که هر دو را خوردیم:

**۱. پوشه‌ی پروژه را جابه‌جا نکنید.** کانتینر `web` پوشه‌های `frontend` و `deploy/nginx`
را mount می‌کند. داکر یک bind mount را **یک بار، موقع ساختِ کانتینر**، به خودِ پوشه گره
می‌زند — نه به مسیر. اگر پوشه را `mv` کنید و نسخه‌ی جدید را جایش بگذارید، کانتینرِ در حال
اجرا هنوز به پوشه‌ی قدیمی چسبیده است؛ و اگر آن قدیمی را `rm -rf` کنید، به هیچ چسبیده است.
نتیجه‌اش **403 Forbidden** روی صفحه‌ی اصلی است — چون document root از دید nginx وجود دارد
ولی `index.html` داخلش نیست. هیچ‌چیز برنامه خراب نیست و هیچ لاگی هم این را نمی‌گوید.
اسکریپت هرگز پوشه را جابه‌جا نمی‌کند؛ محتوای داخلش را عوض می‌کند.

**۲. `docker compose up -d --build` کانتینر `web` را بازنمی‌سازد.** ایمیجش nginx استاندارد
است و تغییری نکرده، پس compose دست به آن نمی‌زند و **کانفیگ nginx قدیمی باقی می‌ماند**.
اسکریپت صریحاً `--force-recreate web` می‌زند.

اگر روزی دستی به‌روزرسانی کردید و صفحه ۴۰۳ داد، درمانش همین یک خط است:

```bash
cd /opt/feranocar && docker compose up -d --force-recreate --no-deps web
```

---

## اگر روزی خواستید سرور را عوض کنید

سیستم عمداً به این سرور گره نخورده است:

1. روی سرور جدید گام‌های ۱ تا ۴ را انجام دهید
2. آخرین بکاپ را منتقل کنید
3. `docker compose up -d --build` و سپس بازگردانی بکاپ
4. رکورد DNS را به IP جدید ببرید

تنها چیزی که منتقل نمی‌شود، فایل `.env` است — رمزها را دوباره تولید کنید یا همان فایل را
امن منتقل کنید.

---

## دستورهای روزمره

| کار | دستور |
|---|---|
| وضعیت سرویس‌ها | `docker compose ps` |
| لاگ زنده | `docker compose logs -f api` |
| ری‌استارت | `docker compose restart api` |
| بکاپ دستی | `/usr/local/bin/feranocar-backup` |
| ورود به دیتابیس (ترمینال) | `docker compose exec db psql -U havale havale` |
| ورود به دیتابیس (گرافیکی) | تونل SSH + `http://localhost:8081` — بخش «مدیریت دیتابیس» |
| مصرف منابع | `docker stats --no-stream` |
