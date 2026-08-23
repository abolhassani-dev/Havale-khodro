const { registerMarket } = require('../listing/marketRegistry');
const { REGISTRATION_METHOD, REGISTRATION_SALE_TYPE } = require('./registration.constants');

const METHOD_LABEL = {
  [REGISTRATION_METHOD.LOTTERY]: 'قرعه‌کشی',
  [REGISTRATION_METHOD.TIME_PRIORITY]: 'اولویت زمانی',
};

const SALE_LABEL = {
  [REGISTRATION_SALE_TYPE.PRESALE]: 'پیش‌فروش',
  [REGISTRATION_SALE_TYPE.CASH_SINGLE]: 'نقدی تک‌مرحله‌ای',
  [REGISTRATION_SALE_TYPE.CASH_STAGED]: 'نقدی چند مرحله‌ای',
  [REGISTRATION_SALE_TYPE.INSTALLMENT]: 'اقساط',
  [REGISTRATION_SALE_TYPE.PRODUCTION_PARTNERSHIP]: 'مشارکت در تولید',
};

const toNumber = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * How the moderation desk reads this market.
 *
 * Registered rather than imported: the desk asks the registry, the registry
 * answers with whatever markets have announced themselves. Adding a market
 * never edits the desk.
 */
registerMarket('REGISTRATION', {
  label: 'ثبت‌نامی',
  include: { registration: true },

  summarise(row) {
    const d = row.registration || {};
    return {
      planName: d.planName || null,
      method: METHOD_LABEL[d.method] || null,
      saleType: SALE_LABEL[d.saleType] || null,
      capacity: d.capacity ?? null,
      // The headline figure for this market — what the agency is asking for the
      // slot, which is the number a reviewer compares against the complaint.
      headlineToman: toNumber(d.premiumToman),
      headlineLabel: 'مبلغ امتیاز',
    };
  },

  /** `icon` names one of the shared interface icons — see havale.market.js. */
  describe(row) {
    const d = row.registration || {};
    return [
      { label: 'طرح', value: d.planName || '—', icon: 'clipboard' },
      { label: 'روش ثبت‌نام', value: METHOD_LABEL[d.method] || '—', icon: 'users' },
      { label: 'نوع فروش', value: SALE_LABEL[d.saleType] || '—', icon: 'ticket' },
      { label: 'تعداد ظرفیت', value: d.capacity ?? '—', icon: 'layers' },
      {
        label: 'مبلغ واریزی ثبت‌نام',
        value: toNumber(d.depositToman),
        money: true,
        icon: 'ticket',
      },
      { label: 'مبلغ امتیاز', value: toNumber(d.premiumToman), money: true, icon: 'layers' },
      { label: 'مهلت ثبت‌نام', value: d.registerDeadline, date: true, icon: 'clock' },
      { label: 'موعد تحویل', value: d.deliveryEstimate || '—', icon: 'clock' },
      { label: 'شرایط ثبت‌نام‌کننده', value: d.conditions || '—', icon: 'shield' },
    ];
  },
});

