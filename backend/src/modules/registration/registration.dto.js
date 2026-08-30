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

const { maskAllText } = require('../../utils/textGuard');

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
    closesAt: row.closesAt,
    createdAt: row.createdAt,
    renewedAt: row.renewedAt,
    renewCount: row.renewCount,
    // «ویرایش‌شده» on the card — the same marker the حواله market carries, and
    // for the same reason: a changed advertisement is a different thing to read.
    editedAt: row.editedAt,
    editCount: row.editCount,
  };
}

/**
 * The boxes on this market that a person types into, and nothing else.
 *
 * Named once, here, and read by every serialiser below — so «which fields are
 * free text?» has one answer rather than three that can disagree. It is the
 * question the market got wrong twice: «موعد تحویل» was guarded nowhere and
 * «نام طرح» was guarded in one place out of two.
 */
function typedFields(row) {
  const d = row.registration || {};
  return {
    planName: d.planName || null,
    deliveryEstimate: d.deliveryEstimate || null,
    conditions: d.conditions || null,
    description: row.description || null,
  };
}

/** Whether there is anything behind the lock, without saying what. */
const hasTyped = (row) => Object.values(typedFields(row)).some(Boolean);

/**
 * An advertisement as it appears to somebody who is not its owner.
 *
 * @param {object} row   the listing, with `owner` and `registration` included
 * @param {object} ctx
 * @param {boolean} ctx.subscriptionActive  from the access table, clause 7
 * @param {boolean} ctx.revealed            a ContactReveal row exists for this viewer
 */
function toCard(row, { subscriptionActive, revealed = false } = {}) {
  const plain = baseFields(row);

  // Belt and braces on what is left: the typed boxes are not on the card at
  // all (below), so this only ever sees the catalogue's own words.
  const base = revealed ? plain : maskAllText(plain);

  const card = {
    ...base,
    isOwn: false,
    // The owner sees this number and nothing else about who looked: knowing
    // which agencies called would let them arrange the deal outside the system.
    revealCount: row.revealCount,
    agency: null,
    contact: null,
    contactRevealed: false,

    // Four typed boxes on this market, and none of them is on the card.
    //
    // The scheme name most of all: it reads like a title, so it is the field an
    // agency is most tempted to sign — «طرح نمایندگی پارس» — and no rule about
    // what may be written in it survives contact with somebody determined. Not
    // serving it ends that argument instead of winning it.
    //
    // The card keeps everything structured, which is everything the market is
    // searched by: the car, the method, the sale type, the capacity, both
    // figures, the deadline.
    planName: null,
    deliveryEstimate: null,
    conditions: null,
    description: null,
    hasNotes: hasTyped(row),
  };

  // Identity is confidential exactly like the phone number — name, code and
  // city included. An agency's name is enough to find its switchboard in one
  // web search, which would turn «call them» into a free action that spends no
  // allowance and leaves no audit row. So identity and contact open together,
  // on the recorded reveal, and never separately.
  if (!subscriptionActive) return card;

  if (revealed && row.owner) {
    card.contactRevealed = true;
    // Paid for, so handed over whole and unmasked: somebody holding the
    // telephone number gains nothing from a blanked copy of it.
    Object.assign(card, typedFields(row));
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
    // The family's own words, unconditionally — hiding them from the people who
    // wrote them would be theatre rather than security.
    ...typedFields(row),
    hasNotes: hasTyped(row),
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
