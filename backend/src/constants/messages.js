const MESSAGES = {
  AUTH: {
    LOGGED_IN: 'ورود موفق',
    LOGGED_OUT: 'خروج انجام شد',
    INVALID_CREDENTIALS: 'نام کاربری یا رمز عبور نادرست است',
    ACCOUNT_SUSPENDED: 'حساب شما تعلیق شده است',
    LOCKED_OUT: 'به دلیل تلاش‌های ناموفق، حساب موقتاً قفل شده است',
    SESSION_INVALID: 'نشست شما معتبر نیست',
    SESSION_KICKED: 'از دستگاه دیگری وارد حساب شده‌اید',
    PASSWORD_CHANGED: 'رمز عبور تغییر کرد',
    MUST_CHANGE_PASSWORD: 'برای ادامه باید رمز عبور را تغییر دهید',
  },
  SUBSCRIPTION: {
    // Market-neutral on purpose: this banner shows on the خودرو and ثبت‌نامی
    // pages exactly as it does on حواله.
    EXPIRED: 'اشتراک شما تمام شده — برای ثبت آگهی و دیدن مشخصات تمدید کنید',
    GRANTED: 'اشتراک ثبت شد',
  },
  SEAT: {
    NOT_RESELLER: 'حالت ماژول برای این حساب فعال نیست',
    ONE_LEVEL_ONLY: 'زیرنماینده نمی‌تواند زیرنماینده بسازد',
    PARENT_NEEDS_CODE: 'برای ساخت زیرنماینده، کد نمایندگی لازم است',
    NO_CAPACITY: 'ظرفیت خالی ندارید — ابتدا ظرفیت بخرید',
    RECEIPT_REQUIRED: 'فیش واریزی الزامی است — تصویر یا PDF رسید را پیوست کنید',
    USERNAME_TAKEN: 'این نام کاربری قبلاً استفاده شده است',
    ORDER_CREATED: 'درخواست ظرفیت ثبت شد و در انتظار تأیید پرداخت است',
    ALREADY_REVIEWED: 'این درخواست قبلاً بررسی شده است',
    SUBAGENT_CREATED: 'زیرنماینده ساخته شد',
  },
  // Wording that names the حواله — for the havale module alone. The other
  // markets and every shared service (reveal, report) speak in «آگهی» through
  // the LISTING block below, so a خودرو page never says «حواله ثبت شد».
  HAVALE: {
    CREATED: 'حواله ثبت شد',
    UPDATED: 'حواله به‌روز شد',
    RENEWED: 'آگهی تمدید شد',
    FULFILLED: 'حواله «فروخته شد» علامت خورد',
    DELETED: 'حواله حذف شد',
    NOT_EDITABLE: 'این حواله در وضعیت فعلی قابل ویرایش نیست',
    SUSPENDED: 'این حواله تعلیق شده است',
  },
  LISTING: {
    CREATED: 'آگهی ثبت شد',
    UPDATED: 'آگهی به‌روز شد',
    RENEWED: 'آگهی تمدید شد',
    FULFILLED: 'آگهی «انجام شد» علامت خورد',
    DELETED: 'آگهی حذف شد',
    REVEALED: 'مشخصات نمایش داده شد',
    NOT_EDITABLE: 'این آگهی در وضعیت فعلی قابل ویرایش نیست',
    SUSPENDED: 'این آگهی تعلیق شده است',
    OWN_CONTACT: 'این آگهی متعلق به خودتان است',
    // The two ways a listing a reader could see a second ago stops being
    // there. They said the same sentence for a while, and the reader —
    // looking at a card that is still on the page — could not tell whether
    // the advertisement had gone or its agency had. Both are about a listing
    // that was public a moment earlier, so neither sentence discloses
    // anything the card had not already shown.
    GONE: 'این آگهی برداشته شده است',
    OWNER_INACTIVE: 'نمایندگی این آگهی دیگر فعال نیست',
    UNKNOWN_MODEL: 'مدل خودرو در فهرست سامانه نیست',
    UNKNOWN_COLOR: 'رنگ انتخاب‌شده در فهرست سامانه نیست',
    DAILY_LIMIT: 'سقف نمایش مشخصات امروز پر شده است',
    MONTHLY_LIMIT: 'سقف نمایش مشخصات این دوره پر شده است',
  },
  REPORT: {
    FILED: 'گزارش تخلف ثبت شد و بررسی می‌شود',
    REVIEWED: 'گزارش بررسی شد',
    HELD: 'آگهی تا پایان بررسی از دید عموم پنهان شد',
    SUSPENSION_APPROVED: 'تعلیق حساب تأیید و اعمال شد',
    OWN_LISTING: 'نمی‌توانید آگهی خودتان را گزارش کنید',
    ALREADY_REPORTED: 'قبلاً برای این آگهی گزارش ثبت کرده‌اید',
    ALREADY_REVIEWED: 'این گزارش قبلاً بررسی شده است',
    TOO_OLD: 'مهلت گزارش این آگهی تمام شده است',
    DAILY_LIMIT: 'سقف گزارش‌های امروز شما پر شده است',
    NEEDS_CONTACT_FIRST: 'برای دلیل «عدم پاسخگویی» ابتدا باید مشخصات تماس را باز کرده باشید',
    NO_APPROVAL_PENDING: 'این گزارش در صف تأیید تعلیق نیست',
  },
  TICKET: {
    CREATED: 'تیکت ثبت شد',
    REPLIED: 'پاسخ ثبت شد',
    CLOSED: 'این تیکت بسته شده است — برای ادامه تیکت جدید باز کنید',
    AGENT_MAY_ONLY_CLOSE: 'شما فقط می‌توانید تیکت را ببندید',
  },
  ADMIN: {
    USERNAME_TAKEN: 'این نام کاربری قبلاً استفاده شده است',
    CODE_TAKEN: 'این کد نمایندگی قبلاً ثبت شده است',
    PHONE_TAKEN: 'این شماره موبایل قبلاً ثبت شده است',
  },
  USER: {
    CREATED: 'حساب ساخته شد',
    UPDATED: 'حساب به‌روز شد',
    SUSPENDED: 'حساب تعلیق شد',
    ACTIVATED: 'حساب فعال شد',
  },
};

module.exports = { MESSAGES };
