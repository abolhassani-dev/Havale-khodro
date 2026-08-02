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
  USER: {
    CREATED: 'حساب ساخته شد',
    UPDATED: 'حساب به‌روز شد',
    SUSPENDED: 'حساب تعلیق شد',
    ACTIVATED: 'حساب فعال شد',
  },
};

module.exports = { MESSAGES };
