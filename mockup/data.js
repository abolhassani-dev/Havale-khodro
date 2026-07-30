/* داده‌ی نمونه‌ی موک‌آپ — هیچ دیتابیسی در کار نیست */

const CARS = [
  'MVM X22 Pro', 'MVM X33 S', 'MVM X55 Pro', 'MVM 110S',
  'فیدلیتی پرایم ۵ نفره', 'فیدلیتی پرستیژ ۷ نفره',
  'آریزو ۵', 'آریزو ۶ پرو', 'تیگو ۷ پرو', 'تیگو ۸ پرو مکس',
];
const COLORS = ['سفید', 'مشکی', 'خاکستری', 'نقره‌ای', 'آبی', 'قرمز'];
const YEARS = ['۱۴۰۴', '۱۴۰۳', '۱۴۰۲'];
const COMPANIES = ['مدیران خودرو'];
const CITIES = ['تهران', 'اصفهان', 'مشهد', 'شیراز', 'تبریز', 'کرج', 'اهواز', 'قم'];
const SOLH = { yes: 'دارد', no: 'ندارد', cond: 'مشروط' };

/* ------------------------------ کاربران ------------------------------ */

const AGENTS = [
  { id: 'a1', name: 'سامان گودرزی',   agency: 'نمایندگی گودرزی',  code: 'MK-1042', city: 'تهران',  phone: '۰۹۱۲۳۳۴۵۵۶۷', coord: 'مهدی رستمی',   sub: 'active',  ends: '۱۴۰۴/۰۶/۱۲', reseller: true,  kids: 50, seats: 50 },
  { id: 'a2', name: 'رضا کاظمی',      agency: 'اتو کاظمی',        code: 'MK-1088', city: 'اصفهان', phone: '۰۹۱۳۴۴۵۶۶۷۸', coord: 'رضا کاظمی',    sub: 'active',  ends: '۱۴۰۴/۰۵/۲۹', reseller: false, kids: 0,  seats: 0 },
  { id: 'a3', name: 'حمید نوروزی',    agency: 'خودرو نوروزی',     code: 'MK-1131', city: 'مشهد',   phone: '۰۹۱۵۵۵۶۷۷۸۹', coord: 'علی نوروزی',   sub: 'expired', ends: '۱۴۰۴/۰۴/۰۲', reseller: false, kids: 0,  seats: 0 },
  { id: 'a4', name: 'مریم شریفی',     agency: 'شریفی موتور',      code: 'MK-1207', city: 'شیراز',  phone: '۰۹۱۷۶۶۷۸۸۹۰', coord: 'مریم شریفی',   sub: 'active',  ends: '۱۴۰۴/۰۶/۰۱', reseller: false, kids: 0,  seats: 0 },
  { id: 'a5', name: 'بهنام اکبری',    agency: 'اکبری خودرو',      code: 'MK-1244', city: 'تبریز',  phone: '۰۹۱۴۷۷۸۹۹۰۱', coord: 'بهنام اکبری',  sub: 'active',  ends: '۱۴۰۴/۰۷/۱۸', reseller: false, kids: 0,  seats: 0 },
  { id: 'a6', name: 'جواد مرادی',     agency: 'گودرزی — شعبه کرج', code: 'MK-1042-07', city: 'کرج', phone: '۰۹۱۲۸۸۹۰۰۱۲', coord: 'جواد مرادی', sub: 'active', ends: '۱۴۰۴/۰۶/۱۲', reseller: false, kids: 0, seats: 0, parent: 'a1' },
];

/* «من» در پنل نماینده */
const ME = AGENTS[0];

/* ------------------------------ حواله‌ها ------------------------------ */
/* revealed: آیا «من» مشخصات این حواله را باز کرده‌ام */

const HAVALES = [
  { id: 2041, kind: 'offer', car: 'MVM X55 Pro',            color: 'سفید',    year: '۱۴۰۴', solh: 'yes',  price: 1_285_000_000, paid: 640_000_000, delivery: 90, deposit: 3, co: 'مدیران خودرو', owner: 'a2', age: '۲ ساعت پیش', left: 3, views: 7,  revealed: false, status: 'active' },
  { id: 2040, kind: 'offer', car: 'تیگو ۸ پرو مکس',          color: 'مشکی',    year: '۱۴۰۴', solh: 'cond', price: 2_940_000_000, paid: 1_500_000_000, delivery: 60, deposit: 5, co: 'مدیران خودرو', owner: 'a4', age: '۴ ساعت پیش', left: 5, views: 12, revealed: true,  status: 'active' },
  { id: 2039, kind: 'offer', car: 'آریزو ۶ پرو',             color: 'خاکستری', year: '۱۴۰۳', solh: 'yes',  price: 1_760_000_000, paid: 900_000_000, delivery: 45, deposit: 2, co: 'مدیران خودرو', owner: 'a5', age: '۶ ساعت پیش', left: 2, views: 4,  revealed: false, status: 'active' },
  { id: 2038, kind: 'offer', car: 'فیدلیتی پرایم ۵ نفره',    color: 'نقره‌ای', year: '۱۴۰۴', solh: 'no',   price: 2_150_000_000, paid: 1_100_000_000, delivery: 120, deposit: 7, co: 'مدیران خودرو', owner: 'a2', age: 'دیروز',     left: 6, views: 19, revealed: true,  status: 'active' },
  { id: 2037, kind: 'offer', car: 'MVM X22 Pro',             color: 'آبی',     year: '۱۴۰۳', solh: 'yes',  price: 895_000_000,   paid: 450_000_000, delivery: 30, deposit: 4, co: 'مدیران خودرو', owner: 'a4', age: 'دیروز',     left: 4, views: 9,  revealed: false, status: 'active' },
  { id: 2036, kind: 'offer', car: 'MVM X33 S',               color: 'سفید',    year: '۱۴۰۴', solh: 'cond', price: 1_120_000_000, paid: 560_000_000, delivery: 75, deposit: 3, co: 'مدیران خودرو', owner: 'a5', age: '۲ روز پیش',  left: 1, views: 15, revealed: false, status: 'active' },
  { id: 2035, kind: 'offer', car: 'تیگو ۷ پرو',              color: 'مشکی',    year: '۱۴۰۴', solh: 'yes',  price: 2_310_000_000, paid: 1_200_000_000, delivery: 50, deposit: 4, co: 'مدیران خودرو', owner: 'a2', age: '۲ روز پیش',  left: 2, views: 22, revealed: false, status: 'active' },
  { id: 2034, kind: 'offer', car: 'فیدلیتی پرستیژ ۷ نفره',  color: 'قرمز',    year: '۱۴۰۳', solh: 'no',   price: 2_480_000_000, paid: 1_250_000_000, delivery: 100, deposit: 6, co: 'مدیران خودرو', owner: 'a4', age: '۳ روز پیش',  left: 3, views: 6,  revealed: false, status: 'active' },

  /* حواله‌های خودِ من */
  { id: 2033, kind: 'offer', car: 'MVM X55 Pro',   color: 'خاکستری', year: '۱۴۰۴', solh: 'yes', price: 1_310_000_000, paid: 655_000_000, delivery: 85, deposit: 4, co: 'مدیران خودرو', owner: 'a1', age: 'دیروز',    left: 4, views: 11, revealed: false, status: 'active' },
  { id: 2028, kind: 'offer', car: 'آریزو ۵',       color: 'سفید',    year: '۱۴۰۳', solh: 'yes', price: 1_040_000_000, paid: 520_000_000, delivery: 40, deposit: 2, co: 'مدیران خودرو', owner: 'a1', age: '۴ روز پیش', left: 1, views: 8,  revealed: false, status: 'active' },
  { id: 2019, kind: 'offer', car: 'MVM 110S',      color: 'آبی',     year: '۱۴۰۲', solh: 'no',  price: 615_000_000,   paid: 300_000_000, delivery: 25, deposit: 3, co: 'مدیران خودرو', owner: 'a1', age: '۹ روز پیش', left: 0, views: 14, revealed: false, status: 'expired' },
  { id: 2012, kind: 'offer', car: 'تیگو ۷ پرو',    color: 'مشکی',    year: '۱۴۰۳', solh: 'yes', price: 2_280_000_000, paid: 1_150_000_000, delivery: 55, deposit: 5, co: 'مدیران خودرو', owner: 'a1', age: '۱۴ روز پیش', left: 0, views: 31, revealed: false, status: 'sold' },

  /* درخواست‌های خرید */
  { id: 2042, kind: 'request', car: 'تیگو ۸ پرو مکس', color: null,   year: '۱۴۰۴', solh: 'yes',  price: 2_900_000_000, paid: null, delivery: 60, deposit: null, co: 'مدیران خودرو', owner: 'a5', age: '۱ ساعت پیش', left: 7, views: 3, revealed: false, status: 'active' },
  { id: 2032, kind: 'request', car: 'MVM X22 Pro',    color: 'سفید', year: null,   solh: 'cond', price: null,          paid: null, delivery: null, deposit: null, co: null, owner: 'a4', age: 'دیروز', left: 6, views: 5, revealed: true, status: 'active' },
  { id: 2030, kind: 'request', car: 'آریزو ۶ پرو',    color: null,   year: '۱۴۰۴', solh: 'yes',  price: 1_800_000_000, paid: null, delivery: 45, deposit: null, co: 'مدیران خودرو', owner: 'a2', age: '۲ روز پیش', left: 5, views: 2, revealed: false, status: 'active' },
  { id: 2025, kind: 'request', car: 'فیدلیتی پرایم ۵ نفره', color: null, year: null, solh: 'no', price: null,          paid: null, delivery: null, deposit: null, co: null, owner: 'a1', age: '۵ روز پیش', left: 2, views: 1, revealed: false, status: 'active' },
];

/* ------------------------------ تیکت ------------------------------ */

const TICKETS = [
  { id: 318, subject: 'درخواست تغییر شماره‌ی مسئول هماهنگی', owner: 'a1', pr: 'high',   st: 'answered', at: '۱۴۰۴/۰۵/۰۶ — ۱۰:۲۴', unread: true,
    msgs: [
      { me: true,  who: 'سامان گودرزی', t: '۱۴۰۴/۰۵/۰۵ — ۱۶:۴۰', b: 'سلام. شماره‌ی مسئول هماهنگی ما عوض شده. شماره‌ی جدید ۰۹۱۲۳۳۴۵۵۶۷ است. لطفاً اصلاح کنید.' },
      { me: false, who: 'پشتیبانی',      t: '۱۴۰۴/۰۵/۰۶ — ۱۰:۲۴', b: 'سلام. شماره بررسی و ثبت شد. با تأیید نهایی، شماره روی هر ۱۲ آگهی فعال شما یکجا به‌روز می‌شود و نیازی به ویرایش تک‌تک آگهی‌ها نیست.' },
    ] },
  { id: 305, subject: 'تمدید اشتراک و صورتحساب ظرفیت مرداد', owner: 'a1', pr: 'normal', st: 'closed',   at: '۱۴۰۴/۰۵/۰۱ — ۰۹:۱۲', unread: false,
    msgs: [
      { me: true,  who: 'سامان گودرزی', t: '۱۴۰۴/۰۴/۳۱ — ۱۸:۰۲', b: 'صورتحساب مرداد را می‌خواستم. ۵۰ زیرنماینده دارم.' },
      { me: false, who: 'مالی',          t: '۱۴۰۴/۰۵/۰۱ — ۰۹:۱۲', b: 'اشتراک ۲۵٬۰۰۰٬۰۰۰ + ظرفیت ۵۰ نفر × ۱٬۰۰۰٬۰۰۰ = مجموع ۷۵٬۰۰۰٬۰۰۰ تومان. پیش‌پرداخت ماه مرداد دریافت شد.' },
    ] },
  { id: 297, subject: 'آگهی HV-2019 چرا بسته شد؟', owner: 'a1', pr: 'low', st: 'closed', at: '۱۴۰۴/۰۴/۲۴ — ۱۳:۵۰', unread: false,
    msgs: [
      { me: true,  who: 'سامان گودرزی', t: '۱۴۰۴/۰۴/۲۴ — ۱۱:۳۰', b: 'آگهی MVM 110S خودکار بسته شد.' },
      { me: false, who: 'پشتیبانی',      t: '۱۴۰۴/۰۴/۲۴ — ۱۳:۵۰', b: 'مدت واریز آن ۳ روز ثبت شده بود و عمر آگهی برابر همان است. از «حواله‌های من» با یک کلیک دوباره فعالش کنید.' },
    ] },
];

const ADMIN_TICKETS = [
  { id: 318, subject: 'درخواست تغییر شماره‌ی مسئول هماهنگی', agent: 'a1', pr: 'high',   st: 'answered', at: '۱۰:۲۴' },
  { id: 317, subject: 'تأیید پرداخت اشتراک مرداد',            agent: 'a4', pr: 'normal', st: 'open',     at: '۰۹:۵۱' },
  { id: 316, subject: 'خطا در ثبت حواله',                     agent: 'a5', pr: 'high',   st: 'open',     at: 'دیروز' },
  { id: 315, subject: 'درخواست افزایش سقف روزانه',            agent: 'a2', pr: 'low',    st: 'open',     at: 'دیروز' },
  { id: 314, subject: 'تمدید اشتراک',                         agent: 'a3', pr: 'normal', st: 'closed',   at: '۲ روز پیش' },
];

/* ------------------------------ گزارش تخلف ------------------------------ */

const REPORTS = [
  { id: 91, hv: 2036, reason: 'آگهی جعلی',        by: 'a2', on: 'a5', st: 'pending',  at: 'امروز ۰۹:۱۲', desc: 'شماره‌ی درج‌شده اصلاً در دسترس نیست و کد نمایندگی با شهر نمی‌خواند. مشکوک به آگهی جعلی است.' },
  { id: 90, hv: 2035, reason: 'قبلاً فروخته شده', by: 'a4', on: 'a2', st: 'pending',  at: 'دیروز ۱۷:۴۰', desc: 'تماس گرفتم، گفتند این حواله دو هفته پیش فروخته شده ولی آگهی هنوز فعال است.' },
  { id: 89, hv: 2030, reason: 'مبلغ نادرست',      by: 'a5', on: 'a2', st: 'confirmed',at: '۳ روز پیش',   desc: 'مبلغ درج‌شده با مبلغ اعلامی تلفنی ۲۰۰ میلیون تفاوت دارد.' },
  { id: 88, hv: 2028, reason: 'عدم پاسخگویی',     by: 'a3', on: 'a1', st: 'rejected', at: '۵ روز پیش',   desc: 'چند بار تماس گرفتم جواب ندادند.' },
  { id: 87, hv: 2034, reason: 'کلاهبرداری',       by: 'a2', on: 'a4', st: 'abusive',  at: '۸ روز پیش',   desc: 'به نظرم این آگهی مشکل دارد.' },
];

/* ------------------------------ فعالیت ------------------------------ */

const ACTIVITY = [
  { t: 'امروز ۱۱:۴۲', who: 'a2', act: 'باز کردن مشخصات', target: 'HV-2040', ip: '۸۹.۳۲.۱۱.۴',  hot: true },
  { t: 'امروز ۱۱:۳۸', who: 'a2', act: 'باز کردن مشخصات', target: 'HV-2039', ip: '۸۹.۳۲.۱۱.۴',  hot: true },
  { t: 'امروز ۱۱:۳۱', who: 'a2', act: 'باز کردن مشخصات', target: 'HV-2038', ip: '۸۹.۳۲.۱۱.۴',  hot: true },
  { t: 'امروز ۱۰:۵۵', who: 'a4', act: 'ثبت حواله فروش',  target: 'HV-2041', ip: '۵.۱۲۰.۸.۹۱',  hot: false },
  { t: 'امروز ۱۰:۲۰', who: 'a1', act: 'ورود به سامانه',   target: '—',       ip: '۹۱.۹۹.۴۵.۲',  hot: false },
  { t: 'امروز ۰۹:۱۲', who: 'a2', act: 'گزارش تخلف',       target: 'HV-2036', ip: '۸۹.۳۲.۱۱.۴',  hot: false },
  { t: 'دیروز ۱۸:۰۴', who: 'a5', act: 'ساخت زیرنماینده', target: 'MK-1244-03', ip: '۳۷.۱۹.۷۷.۵', hot: false },
  { t: 'دیروز ۱۷:۴۰', who: 'a4', act: 'گزارش تخلف',       target: 'HV-2035', ip: '۵.۱۲۰.۸.۹۱',  hot: false },
  { t: 'دیروز ۱۵:۲۲', who: 'a3', act: 'ورود ناموفق (۳ بار)', target: '—',    ip: '۱۸۸.۵.۲۲.۹',  hot: true },
];

/* ------------------------------ ظرفیت ------------------------------ */

const SEAT_ORDERS = [
  { id: 44, agent: 'a1', seats: 50, unit: 1_000_000, total: 50_000_000, st: 'paid',     at: '۱۴۰۴/۰۵/۰۱', note: 'پیش‌پرداخت مرداد' },
  { id: 43, agent: 'a5', seats: 5,  unit: 1_000_000, total: 5_000_000,  st: 'pending',  at: '۱۴۰۴/۰۵/۰۶', note: 'در انتظار تأیید واریز' },
  { id: 42, agent: 'a1', seats: 50, unit: 1_000_000, total: 50_000_000, st: 'paid',     at: '۱۴۰۴/۰۴/۰۱', note: 'پیش‌پرداخت تیر' },
  { id: 41, agent: 'a2', seats: 10, unit: 1_000_000, total: 10_000_000, st: 'rejected', at: '۱۴۰۴/۰۳/۲۸', note: 'حالت ماژول فعال نبود' },
];

const SUBAGENTS = [
  { code: 'MK-1042-01', name: 'علی صادقی',    city: 'تهران', st: 'active',    last: 'امروز ۰۹:۱۰', hv: 6 },
  { code: 'MK-1042-02', name: 'نیما بهرامی',  city: 'کرج',   st: 'active',    last: 'امروز ۰۸:۴۵', hv: 3 },
  { code: 'MK-1042-03', name: 'سعید قاسمی',   city: 'قم',    st: 'active',    last: 'دیروز',       hv: 9 },
  { code: 'MK-1042-04', name: 'الهام رحیمی',  city: 'تهران', st: 'suspended', last: '۶ روز پیش',   hv: 0 },
  { code: 'MK-1042-05', name: 'کاوه امینی',   city: 'اراک',  st: 'active',    last: 'امروز ۱۰:۰۲', hv: 4 },
  { code: 'MK-1042-06', name: 'شهاب فرجی',    city: 'ساوه',  st: 'active',    last: '۲ روز پیش',   hv: 1 },
  { code: 'MK-1042-07', name: 'جواد مرادی',   city: 'کرج',   st: 'active',    last: 'امروز ۱۱:۱۵', hv: 7 },
];
