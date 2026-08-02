/**
 * Message bodies.
 *
 * Kept together so the wording can be reviewed in one sitting, and so a template
 * name — not a sentence — is what the rest of the code passes around. The text
 * that actually went out is copied onto the outbox row, so rewording a template
 * never rewrites the history of what was sent.
 *
 * Iranian service lines require pre-approved patterns, so keep these stable once
 * the panel is registered; changing the wording usually means re-approval.
 */

const TEMPLATES = {
  OTP: {
    name: 'OTP',
    build: ({ code }) => `کد ورود شما: ${code}\nاین کد تا ۲ دقیقه معتبر است.`,
  },

  PASSWORD_RESET: {
    name: 'PASSWORD_RESET',
    build: ({ code }) => `کد بازیابی رمز عبور: ${code}\nاگر شما درخواست نداده‌اید، این پیام را نادیده بگیرید.`,
  },

  /** Sent at the halfway point of the listing's life, not the day before —
   *  a one-day listing would never have received a day-before warning. */
  HAVALE_CLOSING: {
    name: 'HAVALE_CLOSING',
    build: ({ carType, hoursLeft }) =>
      `آگهی «${carType}» تا ${hoursLeft} ساعت دیگر بسته می‌شود. برای تمدید وارد پنل شوید.`,
  },

  SUBSCRIPTION_EXPIRING: {
    name: 'SUBSCRIPTION_EXPIRING',
    build: ({ daysLeft }) =>
      `اشتراک شما تا ${daysLeft} روز دیگر تمام می‌شود. برای جلوگیری از قطع دسترسی تمدید کنید.`,
  },

  /** The owner is told when a report against them is upheld, so they can answer
   *  through a ticket rather than discovering it at suspension (blueprint 8.5). */
  VIOLATION_STRIKE: {
    name: 'VIOLATION_STRIKE',
    build: ({ strikes, limit }) =>
      `یک گزارش تخلف علیه شما تأیید شد (${strikes} از ${limit}). برای پیگیری از بخش تیکت اقدام کنید.`,
  },
};

function render(templateName, params = {}) {
  const template = TEMPLATES[templateName];
  if (!template) throw new Error(`Unknown SMS template: ${templateName}`);
  return template.build(params);
}

module.exports = { TEMPLATES, render };
