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
const { maskAllText } = require('../../utils/textGuard');

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
  const plain = baseFields(havale);

  // Whatever remains a string on a public card, with contact details blanked.
  //
  // Belt and braces now rather than the main defence: the free-text boxes are
  // no longer on the card at all (see below), so what is left here is the
  // catalogue's own words — a car's name, a colour. Kept because it costs
  // nothing and because the day somebody adds a string to `baseFields`, it is
  // covered without their having to think about it.
  const base = revealed ? plain : maskAllText(plain);

  const card = {
    ...base,
    isOwn: false,
    // The owner sees this number and nothing else about who looked (blueprint
    // 6.9). Knowing which agencies called would let them arrange the deal
    // outside the system.
    revealCount: havale.revealCount,
    agency: null,
    contact: null,
    contactRevealed: false,

    // The free text is not on the card, and no filter is trying to make it
    // safe to put there.
    //
    // This is the change that ends the argument rather than winning it. Every
    // rule about what may be written in a description is a rule somebody works
    // out how to write around — spelled-out digits, a Telegram handle, an
    // agency's own name, a box nobody thought to guard. None of that matters
    // if the box is simply not served: there is nothing to encode into.
    //
    // What stays on the card is everything the market is actually searched by,
    // and all of it is structured — the car, the colour, the year, all three
    // figures, the payment terms, the windows. The typing goes behind the
    // reveal, where the reader has the telephone number anyway.
    description: null,
    // Said, not hidden. «There is a note here» is itself a reason to open the
    // contact; pretending the field does not exist would just make the card
    // look thinner than the listing is.
    hasDescription: Boolean(havale.description),
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
    // Paid for, so handed over — and unmasked, because somebody holding the
    // telephone number gains nothing from a blanked copy of it.
    card.description = havale.description;
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
    // Their own text, unconditionally: it is theirs, and hiding it from the
    // person who wrote it would be theatre rather than security.
    description: havale.description,
    hasDescription: Boolean(havale.description),
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
