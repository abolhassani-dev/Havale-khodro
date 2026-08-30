const reportService = require('../report/report.service');
const { editedSinceRevealFor } = require('../listing/reveal.service');
const noticeRepository = require('./notice.repository');
const { STRIKE_THRESHOLD } = require('../../constants/moderation');

/**
 * The agency's message box.
 *
 * Everything a moderation decision does to an agency happens somewhere the
 * agency cannot see: a listing goes quiet, a counter goes up, and one day the
 * account stops working. There is an SMS on the strike, but an SMS is a line of
 * text on a telephone that may belong to whoever answered it — it is not a
 * record, and it cannot be re-read a week later when somebody asks «why».
 *
 * So: a box, in the panel, saying what happened, on which advertisement, on
 * what grounds, and where to object.
 *
 * There is no notices table. A notice is a *view* of a decision that was
 * already recorded — the report that was upheld, the report that was thrown
 * out, the suspension already stamped on the account. Storing them again would
 * mean a second copy that can disagree with the first, plus rows to write on
 * every verdict and rows to delete for ever afterwards. What is stored is one
 * column, `noticesSeenAt`, which is the only fact the reports do not already
 * hold: whether this person has looked.
 *
 * The panel writes the sentences. What comes back from here are the facts —
 * kind, date, listing, reason — the same division the market modules use.
 */

/** Newest first, whatever produced them. */
const byDate = (a, b) => new Date(b.at) - new Date(a.at);

async function build(user) {
  const [against, filed, edited, suspended] = await Promise.all([
    reportService.listAgainstMe(user),
    reportService.listFiledBy(user),
    editedSinceRevealFor(user.id, null),
    noticeRepository.suspendedListings(user.id),
  ]);

  // Oldest first while numbering, so «strike ۱ of ۳» is the first one they got.
  const strikes = [...against.items].sort((a, b) => new Date(a.reviewedAt || a.createdAt) - new Date(b.reviewedAt || b.createdAt));

  const notices = strikes.map((r, index) => ({
    id: `strike:${r.id}`,
    kind: 'STRIKE',
    at: r.reviewedAt || r.createdAt,
    reason: r.reason,
    note: r.adminNote || null,
    listing: r.havale ? { serial: r.havale.serial, carType: r.havale.carType } : null,
    strikeNumber: index + 1,
    strikeLimit: against.limit ?? STRIKE_THRESHOLD,
  }));

  for (const r of filed) {
    // A report they filed and that was upheld is good news and stays short. One
    // that was judged abusive carries a strike against *them*, which is the
    // whole reason this half of the box exists.
    const kind =
      r.status === 'CONFIRMED'
        ? 'REPORT_UPHELD'
        : r.status === 'ABUSIVE'
          ? 'REPORT_ABUSIVE'
          : 'REPORT_REJECTED';

    notices.push({
      id: `report:${r.id}`,
      kind,
      at: r.reviewedAt || r.createdAt,
      reason: r.reason,
      note: r.adminNote || null,
      listing: r.listing,
      reportSerial: r.serial,
    });
  }

  // Listings an admin has taken down.
  //
  // A second source rather than part of the strike list, because a suspension
  // does not need a report behind it — an admin can take one down directly, and
  // the reason they are made to write is addressed to the agency. It went
  // nowhere until this existed.
  //
  // A suspension that *did* come from a report is skipped: the strike notice
  // above already says the same thing with more in it — which report, which
  // grounds, and which strike of three.
  const struck = new Set(strikes.map((r) => r.havale?.id).filter(Boolean));
  for (const row of suspended) {
    if (struck.has(row.id)) continue;
    notices.push({
      id: `suspended:${row.id}:${row.suspendedAt.toISOString()}`,
      kind: 'LISTING_SUSPENDED',
      at: row.suspendedAt,
      note: row.suspendReason || null,
      listing: { serial: row.serial, carType: row.carType },
      market: row.market,
    });
  }

  // Advertisements they paid to see, changed since they paid. A reveal buys a
  // particular set of numbers; if those move afterwards, the person who spent
  // an allowance on them is the last to find out — an edited row looks exactly
  // like an untouched one.
  for (const row of edited) {
    notices.push({
      id: `edited:${row.listing.id}:${row.listing.editCount}`,
      kind: 'LISTING_EDITED',
      at: row.listing.editedAt,
      listing: { serial: row.listing.serial, carType: row.listing.carType },
      market: row.listing.market,
      revealedAt: row.createdAt,
    });
  }

  // The account itself. It is not a report, it is the consequence of the last
  // one, and it is the single fact the agency most needs in writing.
  if (user.status !== 'ACTIVE' && user.suspendedAt) {
    notices.push({
      id: `account:${user.suspendedAt}`,
      kind: 'ACCOUNT_SUSPENDED',
      at: user.suspendedAt,
      strikeNumber: user.fakeStrikes,
      strikeLimit: against.limit ?? STRIKE_THRESHOLD,
    });
  }

  return notices.sort(byDate);
}

const noticeService = {
  async listFor(user) {
    const items = await build(user);
    const seenAt = user.noticesSeenAt ? new Date(user.noticesSeenAt) : null;
    const unread = items.filter((n) => !seenAt || new Date(n.at) > seenAt).length;
    return { items, unread, seenAt };
  },

  /**
   * Just the number, for the badge in the menu.
   *
   * Called on every navigation, so it must not be the full build. The strike
   * count and the suspension are on the user record already; only the two
   * report queries cost anything, and they are counts rather than rows.
   */
  async unreadFor(user) {
    const since = user.noticesSeenAt ? new Date(user.noticesSeenAt) : null;
    const [against, filed, edited, suspended] = await Promise.all([
      noticeRepository.countStrikesSince(user.id, since),
      noticeRepository.countFiledResolvedSince(user.id, since),
      editedSinceRevealFor(user.id, since),
      noticeRepository.countSuspendedSince(user.id, since),
    ]);

    const suspension =
      user.status !== 'ACTIVE' && user.suspendedAt && (!since || new Date(user.suspendedAt) > since)
        ? 1
        : 0;

    return against + filed + edited.length + suspended + suspension;
  },

  /** Marks the box read up to now. */
  async markSeen(user) {
    const at = new Date();
    await noticeRepository.setSeenAt(user.id, at);
    return { seenAt: at };
  },
};

module.exports = noticeService;
