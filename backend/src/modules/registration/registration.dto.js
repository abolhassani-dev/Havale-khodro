/**
 * The masking boundary for the ثبت‌نامی market.
 *
 * The same rule as everywhere else in this system, and it is worth restating
 * because it is the one that matters: if the API returns the coordinator's
 * phone number and the interface merely hides it, then anybody who opens the
 * browser's developer tools reads every number in the database — spending none
 * of the daily cap and leaving nothing in the audit log.
 *
 * So contact details are added here, once, and only when the caller has proved
 * the reveal was recorded. There is deliberately no «include everything» branch
 * to reach for by accident.
 */

/** Prisma returns BigInt for money columns, and JSON.stringify throws on those. */
const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

/**
 * What every signed-in agent may see, whatever their subscription state.
 *
 * The scheme, the terms and the prices are the market itself — an agency whose
 * subscription lapsed still sees what is on offer, it just cannot act in it or
 * reach anybody.
 */
function baseFields(row) {
  const d = row.registration || {};
  return {
    id: row.id,
    serial: row.serial,
    kind: row.kind,
    status: row.status,
    carModelId: row.carModelId,
    carType: row.carType,
    planName: d.planName || null,
    method: d.method || null,
    saleType: d.saleType || null,
    capacity: d.capacity ?? null,
    depositToman: toNumber(d.depositToman),
    premiumToman: toNumber(d.premiumToman),
    registerDeadline: d.registerDeadline || null,
    deliveryEstimate: d.deliveryEstimate || null,
    conditions: d.conditions || null,
    description: row.description,
    closesAt: row.closesAt,
    createdAt: row.createdAt,
    renewedAt: row.renewedAt,
    renewCount: row.renewCount,
  };
}

/**
 * An advertisement as it appears to somebody who is not its owner.
 *
 * @param {object} row   the listing, with `owner` and `registration` included
 * @param {object} ctx
 * @param {boolean} ctx.subscriptionActive  from the access table, clause 7
 * @param {boolean} ctx.revealed            a ContactReveal row exists for this viewer
 */
function toCard(row, { subscriptionActive, revealed = false } = {}) {
  const card = {
    ...baseFields(row),
    isOwn: false,
    // The owner sees this number and nothing else about who looked: knowing
    // which agencies called would let them arrange the deal outside the system.
    revealCount: row.revealCount,
    agency: null,
    contact: null,
    contactRevealed: false,
  };

  // Identity is confidential exactly like the phone number — name, code and
  // city included. An agency's name is enough to find its switchboard in one
  // web search, which would turn «call them» into a free action that spends no
  // allowance and leaves no audit row. So identity and contact open together,
  // on the recorded reveal, and never separately.
  if (!subscriptionActive) return card;

  if (revealed && row.owner) {
    card.contactRevealed = true;
    card.agency = { name: row.owner.agencyName, code: row.owner.agencyCode, city: row.owner.city };
    card.contact = {
      coordinatorName: row.owner.coordinatorName,
      coordinatorPhone: row.owner.coordinatorPhone,
      phone: row.owner.phone,
    };
  }

  return card;
}

/**
 * An advertisement as it appears to its own owner — or to the central agency
 * above it.
 *
 * Contact details are unconditional here: they are the family's own, read from
 * their own profile, and hiding them from the people they belong to would be
 * theatre rather than security. `isOwn` still says whose it is, because a
 * parent may look at a sub-agency's advertisement but not edit it.
 */
function toOwn(row, { viewerId } = {}) {
  const mine = !viewerId || row.ownerId === viewerId;
  return {
    ...baseFields(row),
    isOwn: mine,
    ownerId: row.ownerId,
    revealCount: row.revealCount,
    reportCount: row.reportCount,
    suspendReason: row.suspendReason,
    agency: row.owner
      ? { name: row.owner.agencyName, code: row.owner.agencyCode, city: row.owner.city }
      : null,
    contact: row.owner
      ? {
          coordinatorName: row.owner.coordinatorName,
          coordinatorPhone: row.owner.coordinatorPhone,
          phone: row.owner.phone,
        }
      : null,
    contactRevealed: true,
  };
}

module.exports = { toCard, toOwn, baseFields };
