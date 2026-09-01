/**
 * The masking boundary for the خودرو market.
 *
 * The same rule as every other market: contact and identity are added here,
 * once, only when the caller has proved the reveal was recorded. What is new
 * in this market is the photograph — and a photograph is free text with
 * pixels: a windshield can carry a telephone number in tape. So photos follow
 * the description behind the reveal, and the card only says how many wait
 * there.
 *
 * What stays public is everything structured, which is everything the market
 * is searched by — year, mileage, colour, price, body type, and the body
 * table itself. A chip matrix has nowhere to hide a phone number.
 */

const { maskAllText } = require('../../utils/textGuard');

const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

function baseFields(row) {
  const d = row.car || {};
  return {
    id: row.id,
    serial: row.serial,
    kind: row.kind,
    status: row.status,
    carModelId: row.carModelId,
    carType: row.carType,
    bodyType: d.bodyType || 'SEDAN',

    year: d.year ?? null,
    yearFrom: d.yearFrom ?? null,
    yearTo: d.yearTo ?? null,
    mileageKm: d.mileageKm ?? null,
    maxMileageKm: d.maxMileageKm ?? null,
    carColor: row.carColor || null,
    carPriceToman: toNumber(row.carPriceToman),
    priceFromToman: toNumber(d.priceFromToman),

    // The body table is structured input — public by design, on the card and
    // under the cut-out map. The grade is derived server-side and cannot
    // disagree with it.
    bodyStatus: d.bodyStatus || {},
    bodyGrade: d.bodyGrade || 'NO_PAINT',
    paintTolerance: d.paintTolerance || null,

    closesAt: row.closesAt,
    createdAt: row.createdAt,
    renewedAt: row.renewedAt,
    renewCount: row.renewCount,
    editedAt: row.editedAt,
    editCount: row.editCount,
  };
}

/** The photo list as the panel consumes it — gated URLs, never disk paths. */
function photoList(row) {
  return (row.carPhotos || []).map((p) => ({
    id: p.id,
    // Served by the gated photo route; the random name is the whole address.
    url: `/api/v1/cars/photos/${p.fileName}`,
  }));
}

/**
 * An advertisement as it appears to somebody who is not its owner.
 */
function toCard(row, { subscriptionActive, revealed = false } = {}) {
  const plain = baseFields(row);

  // Belt and braces: the typed box is not on the card at all, so this only
  // ever sees catalogue words — but a second lock costs nothing.
  const base = revealed ? plain : maskAllText(plain);

  const card = {
    ...base,
    isOwn: false,
    revealCount: row.revealCount,
    agency: null,
    contact: null,
    contactRevealed: false,

    // The typed box and the photos live behind the reveal, together with the
    // identity they could carry. The card says only that they exist.
    description: null,
    hasDescription: Boolean(row.description),
    photos: [],
    photoCount: (row.carPhotos || []).length,
  };

  if (!subscriptionActive) return card;

  if (revealed && row.owner) {
    card.contactRevealed = true;
    card.description = row.description || null;
    card.photos = photoList(row);
    card.agency = { name: row.owner.agencyName, code: row.owner.agencyCode, city: row.owner.city };
    card.contact = {
      coordinatorName: row.owner.coordinatorName,
      coordinatorPhone: row.owner.coordinatorPhone,
      phone: row.owner.phone,
    };
  }

  return card;
}

/** An advertisement as its own family sees it — nothing masked. */
function toOwn(row, { viewerId } = {}) {
  const mine = !viewerId || row.ownerId === viewerId;
  return {
    ...baseFields(row),
    description: row.description || null,
    hasDescription: Boolean(row.description),
    photos: photoList(row),
    photoCount: (row.carPhotos || []).length,
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
