const { registerMarket } = require('../listing/marketRegistry');
const { PAYMENT_TYPE } = require('../../constants/havale');

const PAYMENT_LABEL = {
  [PAYMENT_TYPE.CASH]: 'نقد',
  [PAYMENT_TYPE.STAGED]: 'چند مرحله‌ای',
  [PAYMENT_TYPE.INSTALLMENT]: 'اقساط',
};

const SOLH_LABEL = { SOLH: 'صلح', VEKALATI: 'وکالتی' };

const toNumber = (v) => (v === null || v === undefined ? null : Number(v));

/** How the moderation desk reads the حواله market. */
registerMarket('HAVALE', {
  label: 'حواله',

  summarise(row) {
    return {
      carColor: row.carColor || null,
      model: row.model || null,
      solh: SOLH_LABEL[row.solh] || null,
      supplierCompany: row.supplierCompany || null,
      // The transfer amount is what a complaint about this market is usually
      // about, so it is the figure the row carries.
      headlineToman: toNumber(row.amountToman),
      headlineLabel: 'مبلغ حواله',
    };
  },

  /**
   * `icon` names one of the shared interface icons. It is here rather than in
   * the panel because the panel is not allowed to know what these fields mean —
   * matching on a Persian label to pick a picture would be exactly the coupling
   * this registry removes.
   */
  describe(row) {
    return [
      { label: 'واگذاری', value: SOLH_LABEL[row.solh] || '—', icon: 'shield' },
      {
        label: 'رنگ و سال',
        value: [row.carColor, row.model].filter(Boolean).join(' · ') || '—',
        icon: 'car',
      },
      { label: 'مبلغ حواله', value: toNumber(row.amountToman), money: true, icon: 'layers' },
      { label: 'قیمت خودرو', value: toNumber(row.carPriceToman), money: true, icon: 'car' },
      { label: 'مبلغ واریزشده', value: toNumber(row.paidAmountToman), money: true, icon: 'ticket' },
      { label: 'نحوه پرداخت', value: PAYMENT_LABEL[row.paymentType] || '—', icon: 'ticket' },
      {
        label: 'زمان تحویل',
        value: row.deliveryDays ? `${row.deliveryDays} روز` : '—',
        icon: 'clock',
      },
      {
        label: 'مهلت واریز',
        value: row.depositDays ? `${row.depositDays} روز` : '—',
        icon: 'clock',
      },
      { label: 'تأمین‌کننده', value: row.supplierCompany || '—', icon: 'shield' },
    ];
  },
});
