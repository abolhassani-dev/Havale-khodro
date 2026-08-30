/**
 * The masking boundary.
 *
 * This is the most security-sensitive file in the project, and the reason is
 * worth stating plainly: if the API returns the coordinator's phone number and
 * the interface merely hides it, then anyone who opens the browser's developer
 * tools reads every number in the database — while consuming none of the daily
 * cap and leaving nothing in the audit log. The whole revenue model and the
 * whole anti-scraping story rest on the number never being serialised in the
 * first place.
 *
 * So contact details are added here, once, and only when the caller has proved
 * the reveal was recorded. There is deliberately no "include everything" branch
 * to reach for by accident.
 */

const { HAVALE_KIND } = require('../../constants/havale');

/** Prisma returns BigInt for money columns, and JSON.stringify throws on those. */
const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

/**
 * The fields every signed-in agent may see, whatever their subscription state.
 * Per the access table this includes the amount, the model, the delivery time
 * and the supplying company — an expired subscription still sees the market, it
 * just cannot act in it or contact anyone.
 */
function baseFields(havale) {
  return {
    id: havale.id,
    serial: havale.serial,
    kind: havale.kind,
    status: havale.status,
    carModelId: havale.carModelId,
    carType: havale.carType,
    carColor: havale.carColor,
    model: havale.model,
    solh: havale.solh,
    amountToman: toNumber(havale.amountToman),
    paidAmountToman: toNumber(havale.paidAmountToman),
    carPriceToman: toNumber(havale.carPriceToman),
    paymentType: havale.paymentType,
    deliveryDays: havale.deliveryDays,
    depositDays: havale.depositDays,
    supplierCompany: havale.supplierCompany,
    description: havale.description,
    closesAt: havale.closesAt,
    createdAt: havale.createdAt,
    renewedAt: havale.renewedAt,
    renewCount: havale.renewCount,
    // Shown on the card as «ویرایش‌شده». An advertisement that has been changed
    // since it was posted is a different thing to read, and the reader is
    // entitled to know that before ringing about it.
    editedAt: havale.editedAt,
    editCount: havale.editCount,
  };
}

/**
 * A listing as it appears to somebody who is not its owner.
 *
 * @param {object} havale        the row, with `owner` included
 * @param {object} ctx
 * @param {boolean} ctx.subscriptionActive  from the access table, clause 7
 * @param {boolean} ctx.revealed            a ContactReveal row exists for this viewer
 */
function toHavaleCard(havale, { subscriptionActive, revealed = false } = {}) {
  const card = {
    ...baseFields(havale),
    isOwn: false,
    // The owner sees this number and nothing else about who looked (blueprint
    // 6.9). Knowing which agencies called would let them arrange the deal
    // outside the system.
    revealCount: havale.revealCount,
    agency: null,
    contact: null,
    contactRevealed: false,
  };

  // The poster's identity is confidential exactly like their phone number —
  // name, code and city included. An agency's name is enough to find its
  // switchboard in one web search, which turns "call the coordinator" into a
  // free action that consumes no allowance and leaves no audit row. So
  // identity and contact open together, on the recorded reveal, and never
  // separately. An expired subscription sees neither, whatever it revealed
  // while it was live — the check is on the state now, not the past purchase.
  if (!subscriptionActive) return card;

  if (revealed && havale.owner) {
    card.contactRevealed = true;
    card.agency = {
      name: havale.owner.agencyName,
      code: havale.owner.agencyCode,
      city: havale.owner.city,
    };
    card.contact = {
      coordinatorName: havale.owner.coordinatorName,
      coordinatorPhone: havale.owner.coordinatorPhone,
      phone: havale.owner.phone,
    };
  }

  return card;
}

/**
 * A listing as it appears to its own owner.
 *
 * Contact details are unconditional here: they are the owner's own, read from
 * their own profile, and hiding them from the person they belong to would be
 * theatre rather than security.
 */
function toOwnHavale(havale) {
  return {
    ...baseFields(havale),
    isOwn: true,
    revealCount: havale.revealCount,
    reportCount: havale.reportCount,
    suspendReason: havale.suspendReason,
    agency: havale.owner
      ? { name: havale.owner.agencyName, code: havale.owner.agencyCode, city: havale.owner.city }
      : null,
    contact: havale.owner
      ? {
          coordinatorName: havale.owner.coordinatorName,
          coordinatorPhone: havale.owner.coordinatorPhone,
          phone: havale.owner.phone,
        }
      : null,
    contactRevealed: true,
  };
}

/** What the reveal endpoint returns — the details, and what it cost. */
/** Which fields a purchase request is allowed to carry (blueprint 5.2). */
const REQUEST_ONLY_REQUIRED = ['carType', 'solh'];

module.exports = {
  toHavaleCard,
  toOwnHavale,
  HAVALE_KIND,
  REQUEST_ONLY_REQUIRED,
};
