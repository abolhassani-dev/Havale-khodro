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
    EXPIRED: 'اشتراک شما تمام شده — برای ثبت حواله و دیدن مشخصات تمدید کنید',
  },
  HAVALE: {
    CREATED: 'حواله ثبت شد',
    UPDATED: 'حواله به‌روز شد',
    RENEWED: 'آگهی تمدید شد',
    FULFILLED: 'حواله «فروخته شد» علامت خورد',
    DELETED: 'حواله حذف شد',
    REVEALED: 'مشخصات نمایش داده شد',
    NOT_EDITABLE: 'این حواله در وضعیت فعلی قابل ویرایش نیست',
    SUSPENDED: 'این حواله تعلیق شده است',
    OWN_CONTACT: 'این حواله متعلق به خودتان است',
    DAILY_LIMIT: 'سقف نمایش مشخصات امروز پر شده است',
    MONTHLY_LIMIT: 'سقف نمایش مشخصات این دوره پر شده است',
  },
  USER: {
    CREATED: 'حساب ساخته شد',
    UPDATED: 'حساب به‌روز شد',
    SUSPENDED: 'حساب تعلیق شد',
    ACTIVATED: 'حساب فعال شد',
  },
};

module.exports = { MESSAGES };
