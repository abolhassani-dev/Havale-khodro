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
    carType: havale.carType,
    carColor: havale.carColor,
    model: havale.model,
    solh: havale.solh,
    amountToman: toNumber(havale.amountToman),
    paidAmountToman: toNumber(havale.paidAmountToman),
    deliveryDays: havale.deliveryDays,
    depositDays: havale.depositDays,
    supplierCompany: havale.supplierCompany,
    description: havale.description,
    closesAt: havale.closesAt,
    createdAt: havale.createdAt,
    renewedAt: havale.renewedAt,
    renewCount: havale.renewCount,
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
    agency: { name: havale.owner ? havale.owner.agencyName : null },
    contact: null,
    contactRevealed: false,
  };

  // Expired subscription: the agency code and city go too, not just the phone.
  // This is also why a reveal bought last month stops working once the
  // subscription lapses — the check is on the state now, not on the past
  // purchase.
  if (!subscriptionActive) return card;

  card.agency.code = havale.owner ? havale.owner.agencyCode : null;
  card.agency.city = havale.owner ? havale.owner.city : null;

  if (revealed && havale.owner) {
    card.contactRevealed = true;
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
function toRevealResult(owner, usage) {
  return {
    contact: {
      coordinatorName: owner.coordinatorName,
      coordinatorPhone: owner.coordinatorPhone,
      phone: owner.phone,
    },
    agency: { code: owner.agencyCode, name: owner.agencyName, city: owner.city },
    usage,
  };
}

/** Which fields a purchase request is allowed to carry (blueprint 5.2). */
const REQUEST_ONLY_REQUIRED = ['carType', 'solh'];

module.exports = {
  toHavaleCard,
  toOwnHavale,
  toRevealResult,
  HAVALE_KIND,
  REQUEST_ONLY_REQUIRED,
};
