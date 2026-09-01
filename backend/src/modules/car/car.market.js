const { registerMarket } = require('../listing/marketRegistry');
const { GRADE_FA, BODY_TYPE_FA, PAINT_TOLERANCE_FA, PART_BY_KEY, PART_STATUS_FA } = require('./car.constants');
const { toPersianDigits } = require('../../utils/persian');

const toNumber = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * How the moderation desk reads the خودرو market.
 *
 * Registered, not imported: the desk asks the registry, and adding this market
 * edited no shared file. The body table is folded into one Persian sentence
 * here because the desk renders labelled facts, not components.
 */
function bodySentence(bodyStatus) {
  const entries = Object.entries(bodyStatus || {});
  if (!entries.length) return 'بدون رنگ و تعویض';
  return entries
    .map(([key, st]) => `${PART_BY_KEY[key]?.fa || key}: ${PART_STATUS_FA[st] || st}`)
    .join('، ');
}

registerMarket('CAR', {
  label: 'خودرو',
  include: { car: true },

  summarise(row) {
    const d = row.car || {};
    return {
      bodyType: BODY_TYPE_FA[d.bodyType] || null,
      year: d.year ?? null,
      mileageKm: d.mileageKm ?? null,
      bodyGrade: GRADE_FA[d.bodyGrade] || null,
      headlineToman: toNumber(row.carPriceToman),
      headlineLabel: 'قیمت خودرو',
    };
  },

  describe(row) {
    const d = row.car || {};
    const isOffer = row.kind === 'OFFER';
    return [
      { label: 'نوع بدنه', value: BODY_TYPE_FA[d.bodyType] || '—', icon: 'layers' },
      isOffer
        ? { label: 'سال ساخت', value: d.year ? toPersianDigits(d.year) : '—', icon: 'clock' }
        : {
            label: 'سال ساخت',
            value:
              d.yearFrom || d.yearTo
                ? `${d.yearFrom ? toPersianDigits(d.yearFrom) : '—'} تا ${d.yearTo ? toPersianDigits(d.yearTo) : '—'}`
                : '—',
            icon: 'clock',
          },
      isOffer
        ? {
            label: 'کارکرد',
            value:
              d.mileageKm === 0
                ? 'صفر'
                : d.mileageKm
                  ? `${d.mileageKm.toLocaleString('fa-IR')} کیلومتر`
                  : '—',
            icon: 'ticket',
          }
        : {
            label: 'حداکثر کارکرد',
            value: d.maxMileageKm ? `${d.maxMileageKm.toLocaleString('fa-IR')} کیلومتر` : '—',
            icon: 'ticket',
          },
      { label: 'قیمت خودرو', value: toNumber(row.carPriceToman), money: true, icon: 'ticket' },
      { label: 'وضعیت بدنه', value: GRADE_FA[d.bodyGrade] || '—', icon: 'shield' },
      { label: 'جزئیات بدنه', value: bodySentence(d.bodyStatus), icon: 'clipboard' },
      ...(isOffer
        ? []
        : [
            {
              label: 'وضعیت قابل قبول',
              value: PAINT_TOLERANCE_FA[d.paintTolerance] || '—',
              icon: 'shield',
            },
          ]),
    ];
  },
});
