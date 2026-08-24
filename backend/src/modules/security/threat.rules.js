/**
 * What an attack looks like in a request.
 *
 * ── What this is, and what it is not ────────────────────────────────────────
 *
 * This is not a defence. The defences are elsewhere and they are the real ones:
 * every query goes through Prisma with bound parameters, so a SQL payload
 * cannot execute; every interpolation goes through `ui/html.js`, which escapes
 * by default; the Content-Security-Policy refuses inline script even if one got
 * through; and the API validates every field against a Joi schema that strips
 * anything undeclared.
 *
 * This is the *record*. Somebody probing this system with sqlmap will fail —
 * and the owner should still know it happened, from where, and when it started.
 * A system that is attacked and cannot say so is not secure, it is unaware.
 *
 * ── Why the patterns are narrow ─────────────────────────────────────────────
 *
 * Every rule here is written to have almost no chance of matching a Persian
 * car listing. That is a deliberate trade: a security log that cries wolf is
 * read for a week and ignored forever after, and then a real probe scrolls past
 * unnoticed. So `SELECT` alone is not a rule — `UNION … SELECT` is. A single
 * apostrophe is not a rule — `' OR 1=1` is.
 *
 * ── Cost ────────────────────────────────────────────────────────────────────
 *
 * These run on every request, so they are compiled once at module load, tested
 * against a bounded slice of the request, and ordered with the cheapest and
 * most likely first. A request that matches nothing pays for one pass of a
 * handful of regexes over at most a few kilobytes.
 */

/** Severity decides the colour on the screen and whether Telegram rings. */
const SEVERITY = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };

/**
 * Rules matched against the URL and the request body.
 *
 * `where` says what to scan: 'url' is the path and query string, 'body' is the
 * submitted values, 'both' is either.
 */
const PAYLOAD_RULES = [
  {
    id: 'SQLI',
    label: 'تلاش برای تزریق SQL',
    severity: SEVERITY.HIGH,
    where: 'both',
    // Deliberately without a bare `select`: the word appears in ordinary text.
    // What does not appear in ordinary text is a union with a select after it,
    // a tautology in a comparison, or a timing function.
    test: /(\bunion\b[\s\S]{0,30}\bselect\b)|(\binformation_schema\b)|(\b(or|and)\b\s*['"`]?\s*\d+\s*['"`]?\s*=\s*['"`]?\s*\d+)|(\b(sleep|pg_sleep|benchmark|waitfor\s+delay)\s*\()|(;\s*\b(drop|truncate|alter)\b\s+\b(table|database|schema)\b)|(\bxp_cmdshell\b)|(\bunion\b\s+\ball\b\s+\bselect\b)/i,
    help: 'کوئری‌های این سامانه پارامتری‌اند (Prisma) و این حمله اجرا نمی‌شود؛ ولی یعنی کسی دارد سامانه را می‌سنجد. اگر تکرار شد، آی‌پی را ببندید.',
  },
  {
    id: 'XSS',
    label: 'تلاش برای تزریق اسکریپت',
    severity: SEVERITY.HIGH,
    where: 'both',
    test: /<\s*script\b|<\s*iframe\b|<\s*object\b|javascript\s*:|\bon(error|load|click|focus|mouseover)\s*=|<\s*img[^>]{0,40}\bonerror\b|document\.cookie|eval\s*\(/i,
    help: 'خروجی این پنل به‌صورت پیش‌فرض escape می‌شود (ui/html.js) و CSP اجرای اسکریپت درون‌خطی را رد می‌کند. اگر در متن یک آگهی دیده شده، آن آگهی را هم نگاه کنید.',
  },
  {
    id: 'TRAVERSAL',
    label: 'تلاش برای خواندن فایل‌های سرور',
    severity: SEVERITY.HIGH,
    where: 'both',
    test: /(\.\.[/\\]){2,}|%2e%2e[/\\%]|\/etc\/(passwd|shadow|hosts)\b|\/proc\/self\/|\bboot\.ini\b|\bwin\.ini\b|\bweb\.config\b/i,
    help: 'مسیر فایل از ورودی ساخته نمی‌شود، پس این حمله جواب نمی‌دهد. تکرارش یعنی اسکنر خودکار.',
  },
  {
    id: 'CMDI',
    label: 'تلاش برای اجرای دستور روی سرور',
    severity: SEVERITY.HIGH,
    where: 'both',
    test: /[;|&]\s*\b(cat|ls|id|whoami|uname|wget|curl|nc|ncat|bash|sh|python|perl|chmod)\b|\$\(\s*\w+\s*\)|`\s*\w+\s*`|\|\s*nc\s+/i,
    help: 'هیچ ورودی‌ای به شل داده نمی‌شود. این هم از همان دسته‌ی سنجیدن است.',
  },
  {
    id: 'PROTO',
    label: 'تلاش برای آلوده کردن prototype',
    severity: SEVERITY.HIGH,
    where: 'body',
    test: /__proto__|constructor\s*[[.]\s*["']?prototype|prototype\s*\[\s*["']__proto__/i,
    help: 'کلیدهای اعلام‌نشده در ورودی حذف می‌شوند (Joi با stripUnknown)، ولی تلاش برای این حمله همیشه عمدی است.',
  },
  {
    id: 'SSRF',
    label: 'تلاش برای رساندن سرور به شبکه‌ی داخلی',
    severity: SEVERITY.HIGH,
    where: 'both',
    test: /169\.254\.169\.254|metadata\.google\.internal|file:\/\/|gopher:\/\/|dict:\/\/|https?:\/\/(127\.\d|localhost|0\.0\.0\.0|\[::1\]|10\.\d|192\.168\.)/i,
    help: 'سرور از روی ورودی کاربر هیچ درخواستی به بیرون نمی‌زند، پس مسیری برای این حمله وجود ندارد.',
  },
  {
    id: 'TEMPLATE',
    label: 'تلاش برای تزریق قالب',
    severity: SEVERITY.MEDIUM,
    where: 'both',
    test: /\{\{[\s\S]{0,40}(constructor|process|require|global)[\s\S]{0,40}\}\}|<%[\s\S]{0,60}%>|\$\{[\s\S]{0,20}(process|require|global)[\s\S]{0,20}\}/i,
    help: 'موتور قالب سمت سرور وجود ندارد. رشته‌ها هرگز به‌عنوان کد ارزیابی نمی‌شوند.',
  },
  {
    id: 'HEADER_INJECT',
    label: 'تلاش برای تزریق در هدر یا پاسخ',
    severity: SEVERITY.MEDIUM,
    where: 'url',
    test: /%0d%0a|%0a%0d|\r\n(set-cookie|location)\s*:/i,
    help: 'هیچ هدری از روی ورودی ساخته نمی‌شود.',
  },
];

/**
 * Paths that exist only in somebody else's software.
 *
 * Nobody using this product ever asks for `/wp-login.php`. A request for one is
 * a scanner working through a list, and it is the single clearest signal there
 * is — no heuristics, no false positives.
 */
const PROBE_PATH = /\/(wp-login|wp-admin|wp-content|xmlrpc\.php|phpmyadmin|\/pma\/|adminer\.php|\.env|\.git\/|\.svn\/|\.aws\/|\.ssh\/|config\.(json|php|yml)|backup\.(sql|zip|tar|gz)|dump\.sql|shell\.php|cgi-bin\/|vendor\/phpunit|solr\/|actuator\/|struts|jenkins\/|\.well-known\/security\.txt$)/i;

/**
 * Tools that announce themselves.
 *
 * Most attackers change the user agent; the ones who do not are the majority of
 * the noise, and catching them costs one regex.
 */
const SCANNER_UA = /sqlmap|nikto|nmap|masscan|zgrab|dirbuster|gobuster|feroxbuster|wpscan|acunetix|nessus|havij|netsparker|hydra|metasploit|arachni|nuclei|whatweb|joomscan/i;

/**
 * Everything that is recorded, including the rules that are counted rather than
 * matched. Named here so the panel's filter and the alert text never invent a
 * label of their own.
 */
const RULE_LABELS = {
  ...Object.fromEntries(PAYLOAD_RULES.map((r) => [r.id, r.label])),
  PROBE_PATH: 'اسکن مسیرهای شناخته‌شده',
  SCANNER_UA: 'ابزار اسکن امنیتی',
  BRUTE_FORCE: 'حمله‌ی حدس رمز',
  PASSWORD_SPRAY: 'حدس رمز روی چند حساب',
  RATE_LIMIT: 'درخواست بیش از حد',
  FORBIDDEN_SWEEP: 'تلاش برای دسترسی غیرمجاز',
  NOT_FOUND_SWEEP: 'جستجوی کورکورانه‌ی شناسه‌ها',
  OVERSIZE: 'ارسال داده‌ی بیش از حد بزرگ',
};

const RULE_SEVERITY = {
  ...Object.fromEntries(PAYLOAD_RULES.map((r) => [r.id, r.severity])),
  PROBE_PATH: SEVERITY.MEDIUM,
  SCANNER_UA: SEVERITY.HIGH,
  BRUTE_FORCE: SEVERITY.HIGH,
  PASSWORD_SPRAY: SEVERITY.HIGH,
  RATE_LIMIT: SEVERITY.LOW,
  FORBIDDEN_SWEEP: SEVERITY.MEDIUM,
  NOT_FOUND_SWEEP: SEVERITY.MEDIUM,
  OVERSIZE: SEVERITY.LOW,
};

const RULE_HELP = {
  ...Object.fromEntries(PAYLOAD_RULES.map((r) => [r.id, r.help])),
  PROBE_PATH: 'مسیرهایی خواسته شده که اصلاً در این سامانه وجود ندارند (وردپرس، phpMyAdmin و مانند آن). یعنی یک اسکنر خودکار دارد فهرست می‌زند.',
  SCANNER_UA: 'ابزار اسکن، خودش را در هدر معرفی کرده. اگر بارها تکرار شد، بستن آی‌پی منطقی است.',
  BRUTE_FORCE: 'رمزهای پیاپی روی یک نام کاربری امتحان شده. قفل خودکار حساب از قبل فعال است؛ این ردیف فقط برای اطلاع شماست.',
  PASSWORD_SPRAY: 'یک آی‌پی روی چند نام کاربری مختلف رمز امتحان کرده — این از حدس رمزِ ساده خطرناک‌تر است، چون قفل هر حساب را دور می‌زند.',
  RATE_LIMIT: 'سقف تعداد درخواست رد شده. معمولاً یعنی اسکریپت یا یک صفحه‌ی گیرکرده، نه لزوماً حمله.',
  FORBIDDEN_SWEEP: 'یک حساب پیاپی به بخش‌هایی سر زده که دسترسی‌اش را ندارد. یا اشتباه است، یا دارد محدوده‌اش را می‌سنجد.',
  NOT_FOUND_SWEEP: 'شناسه‌های پیاپی امتحان شده تا رکوردی پیدا شود. سامانه به هیچ‌کدام جواب نداده.',
  OVERSIZE: 'حجم ارسالی از سقف گذشته. اگر تکرار شد، ممکن است تلاش برای از کار انداختن سرویس باشد.',
};

module.exports = {
  SEVERITY,
  PAYLOAD_RULES,
  PROBE_PATH,
  SCANNER_UA,
  RULE_LABELS,
  RULE_SEVERITY,
  RULE_HELP,
};
