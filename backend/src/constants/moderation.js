/**
 * Numbers behind violation reports, in one place with the clause they came from.
 */

const REPORT_REASON = {
  FAKE_LISTING: 'FAKE_LISTING',
  WRONG_PRICE: 'WRONG_PRICE',
  UNREACHABLE: 'UNREACHABLE',
  ALREADY_SOLD: 'ALREADY_SOLD',
  FRAUD: 'FRAUD',
  // Contact details written into the advertisement's own text, to be read
  // without anybody spending an allowance on the reveal. No filter catches
  // every encoding of a telephone number — but a competitor reading the market
  // catches all of them, and has every reason to look.
  CONTACT_IN_TEXT: 'CONTACT_IN_TEXT',
  OTHER: 'OTHER',
};

const REPORT_STATUS = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  REJECTED: 'REJECTED',
  ABUSIVE: 'ABUSIVE',
};

/**
 * Blueprint 8.1: an explanation is mandatory and has to be long enough to say
 * something. A one-word report cannot be investigated and cannot be answered.
 */
const DESCRIPTION_MIN_LENGTH = 20;

/**
 * Blueprint 8.2: reports stay open for thirty days after the listing closes, and
 * that includes deleted listings. Somebody who called yesterday about a listing
 * that closed today must still be able to report it — otherwise closing or
 * deleting a listing would be an escape route (review round 3, fix 7).
 */
const REPORT_WINDOW_DAYS = 30;

/** Blueprint 8.4 and decision 23: three warnings on each side. */
const STRIKE_THRESHOLD = 3;

/**
 * Reasons that require the reporter to have opened the contact details first.
 *
 * "Nobody answers" is only a claim somebody can make if they actually tried to
 * call, and the reveal log is the proof (blueprint 8.2).
 */
const REASONS_REQUIRING_CONTACT = [REPORT_REASON.UNREACHABLE];

module.exports = {
  REPORT_REASON,
  REPORT_STATUS,
  DESCRIPTION_MIN_LENGTH,
  REPORT_WINDOW_DAYS,
  STRIKE_THRESHOLD,
  REASONS_REQUIRING_CONTACT,
};
