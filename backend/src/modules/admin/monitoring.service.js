const monitoringRepository = require('./monitoring.repository');
const { marketOf } = require('../listing/marketRegistry');
const { NotFoundError } = require('../../errors/AppError');
const { toPersianDigits } = require('../../utils/persian');

/** The `targetType` values that mean «a row in Listing», old and new. */
const LISTING_TARGETS = new Set(['HAVALE', 'REGISTRATION', 'LISTING']);

/**
 * Monitoring: what happened, who did it, and to whom.
 *
 * The requirement was that clicking a line in the timeline says the whole thing
 * in a sentence — "this agency opened the contact details on that listing" —
 * rather than showing a row of identifiers somebody has to decode. An audit
 * trail nobody can read is not an audit trail.
 */

/**
 * One phrase per recorded action.
 *
 * The `{actor}` and `{target}` placeholders are filled from the resolved records
 * rather than from whatever was written into the log at the time, so a renamed
 * agency reads correctly in old entries too.
 */
const ACTION_PHRASES = {
  LOGIN: 'وارد سامانه شد',
  LOGIN_FAILED: 'تلاش ناموفق برای ورود',
  LOGOUT: 'از سامانه خارج شد',
  PASSWORD_CHANGED: 'رمز عبور خود را تغییر داد',
  HAVALE_CREATED: 'حواله ثبت کرد',
  HAVALE_UPDATED: 'حواله را ویرایش کرد',
  HAVALE_RENEWED: 'آگهی را تمدید کرد',
  HAVALE_FULFILLED: 'حواله را «فروخته شد» علامت زد',
  HAVALE_DELETED: 'حواله را حذف کرد',
  // The moderation desk works on every market, so these three are worded for
  // «آگهی» rather than for حواله. The action strings stay as they are: they
  // are what years of history is already written under.
  HAVALE_SUSPENDED_BY_ADMIN: 'آگهی را تعلیق کرد',
  HAVALE_REMOVED_BY_ADMIN: 'آگهی را از سامانه برداشت',
  HAVALE_RESTORED_BY_ADMIN: 'آگهی را بازگرداند',
  REGISTRATION_CREATED: 'آگهی ثبت‌نامی ثبت کرد',
  REGISTRATION_UPDATED: 'آگهی ثبت‌نامی را ویرایش کرد',
  REGISTRATION_RENEWED: 'آگهی ثبت‌نامی را تمدید کرد',
  REGISTRATION_FULFILLED: 'ثبت‌نامی را «واگذار شد» علامت زد',
  REGISTRATION_DELETED: 'آگهی ثبت‌نامی را حذف کرد',
  CONTACT_REVEALED: 'مشخصات تماس این حواله را دید',
  REPORT_FILED: 'برای این حواله گزارش تخلف ثبت کرد',
  REPORT_CONFIRMED: 'گزارش تخلف را تأیید کرد',
  REPORT_REJECTED: 'گزارش تخلف را رد کرد',
  REPORT_MARKED_ABUSIVE: 'گزارش را بی‌مورد تشخیص داد',
  REPORT_HELD: 'حواله را تا پایان بررسی پنهان کرد',
  ACCOUNT_SUSPENDED_BY_STRIKES: 'حساب را به دلیل اخطارها تعلیق کرد',
  TICKET_OPENED: 'تیکت پشتیبانی باز کرد',
  SUBSCRIPTION_GRANTED: 'اشتراک صادر کرد',
  SEAT_ORDER_APPROVED: 'درخواست ظرفیت را تأیید کرد',
  SEAT_ORDER_REJECTED: 'درخواست ظرفیت را رد کرد',
  SUBAGENT_CREATED: 'زیرنماینده ساخت',
  SUBAGENT_SUSPENDED: 'زیرنماینده را تعلیق کرد',
  SUBAGENT_ACTIVATED: 'زیرنماینده را فعال کرد',
  SUBAGENT_PASSWORD_RESET: 'رمز زیرنماینده را عوض کرد',
  SUBAGENT_BRANDS_SET: 'برندهای زیرنماینده را تنظیم کرد',
  AGENT_CREATED: 'حساب نمایندگی ساخت',
  AGENT_UPDATED: 'مشخصات نمایندگی را ویرایش کرد',
  AGENT_SUSPENDED: 'حساب نمایندگی را تعلیق کرد',
  AGENT_ACTIVATED: 'حساب نمایندگی را فعال کرد',
  AGENT_PASSWORD_RESET: 'رمز نمایندگی را عوض کرد',
  AGENT_FORCE_LOGGED_OUT: 'نشست نمایندگی را قطع کرد',
  AGENT_LIMITS_CHANGED: 'سقف یا حالت ماژول نمایندگی را تغییر داد',
  CATALOG_CHANGED: 'کاتالوگ خودرو را تغییر داد',
};

/**
 * Events, grouped the way somebody searching actually thinks.
 *
 * Forty action names in a dropdown is a list nobody reads. Six families is a
 * choice: "I am looking for a login", "I am looking for something an
 * administrator did". The families are arrays and the reverse lookup is derived
 * from them, so an action can never end up in two of them — and a test asserts
 * that every phrase above belongs to exactly one, because the failure mode
 * otherwise is an event that is invisible to every filter.
 */
const ACTION_FAMILIES = [
  {
    key: 'AUTH',
    label: 'ورود و خروج',
    actions: ['LOGIN', 'LOGOUT', 'PASSWORD_CHANGED'],
  },
  {
    key: 'SECURITY',
    label: 'امنیت',
    actions: ['LOGIN_FAILED', 'ACCOUNT_SUSPENDED_BY_STRIKES', 'AGENT_FORCE_LOGGED_OUT',
      'AGENT_PASSWORD_RESET', 'SUBAGENT_PASSWORD_RESET'],
  },
  {
    key: 'LISTING',
    label: 'آگهی‌ها',
    actions: ['HAVALE_CREATED', 'HAVALE_UPDATED', 'HAVALE_RENEWED', 'HAVALE_FULFILLED',
      'HAVALE_DELETED', 'REGISTRATION_CREATED', 'REGISTRATION_UPDATED', 'REGISTRATION_RENEWED',
      'REGISTRATION_FULFILLED', 'REGISTRATION_DELETED'],
  },
  {
    key: 'REVEAL',
    label: 'نمایش مشخصات',
    actions: ['CONTACT_REVEALED'],
  },
  {
    key: 'MODERATION',
    label: 'اقدام مدیریتی',
    actions: ['HAVALE_SUSPENDED_BY_ADMIN', 'HAVALE_REMOVED_BY_ADMIN', 'HAVALE_RESTORED_BY_ADMIN',
      'REPORT_FILED', 'REPORT_CONFIRMED', 'REPORT_REJECTED', 'REPORT_MARKED_ABUSIVE',
      'REPORT_HELD', 'CATALOG_CHANGED'],
  },
  {
    key: 'ACCOUNT',
    label: 'حساب‌ها و اشتراک',
    actions: ['AGENT_CREATED', 'AGENT_UPDATED', 'AGENT_SUSPENDED', 'AGENT_ACTIVATED',
      'AGENT_LIMITS_CHANGED', 'SUBAGENT_CREATED', 'SUBAGENT_SUSPENDED', 'SUBAGENT_ACTIVATED',
      'SUBAGENT_BRANDS_SET', 'SUBSCRIPTION_GRANTED', 'SEAT_ORDER_APPROVED',
      'SEAT_ORDER_REJECTED', 'TICKET_OPENED'],
  },
];

const FAMILY_OF = new Map(
  ACTION_FAMILIES.flatMap((f) => f.actions.map((action) => [action, f.key]))
);

/** How far back the timeline looks when nobody said. */
const DEFAULT_WINDOW_DAYS = 30;

function actorName(user) {
  if (!user) return 'سیستم';
  if (user.agencyName) return `${user.agencyName}${user.agencyCode ? ` (${user.agencyCode})` : ''}`;
  return user.fullName || user.username;
}

const monitoringService = {
  overview() {
    return monitoringRepository.overview();
  },

  /** The families, for the filter bar. Named here so the panel invents none. */
  families() {
    return ACTION_FAMILIES.map(({ key, label }) => ({ key, label }));
  },

  /** Which actions a family covers. Exposed so the mapping can be tested. */
  actionsOf(key) {
    return ACTION_FAMILIES.find((f) => f.key === key)?.actions || [];
  },

  async activity({ family, action, serial, from, to, ...rest }) {
    // Always a window. Without one the `count` behind the pager is a full scan,
    // which is invisible while the table is small and is the reason this page
    // would have got slower every month.
    const since = from || new Date(Date.now() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // A serial nobody has used resolves to nothing — and must return nothing,
    // not everything. `null` would be dropped by the repository's `if`, so it
    // is turned into an id that cannot match.
    const targetId = serial
      ? (await monitoringRepository.listingIdBySerial(serial)) || '—none—'
      : undefined;

    const [rows, total] = await monitoringRepository.listActivity({
      ...rest,
      from: since,
      to,
      targetId,
      // One exact action beats a family — a link that says «only reveals»
      // means only reveals, even if the family it belongs to is also named.
      actions: action ? [action] : ACTION_FAMILIES.find((f) => f.key === family)?.actions,
    });

    return {
      total,
      from: since,
      to: to || null,
      items: rows.map((row) => ({
        id: row.id,
        action: row.action,
        family: FAMILY_OF.get(row.action) || null,
        // A one-line summary for the list. The full story is on the detail call,
        // which is the only one that costs extra queries.
        headline: `${actorName(row.user)} ${ACTION_PHRASES[row.action] || row.action}`,
        actor: row.user ? { id: row.user.id, name: actorName(row.user), role: row.user.role } : null,
        targetType: row.targetType,
        targetId: row.targetId,
        ip: row.ip,
        device: row.device,
        // The count, not the diff: the list shows «۲ تغییر» and the detail call
        // spells them out. A page of fifty rows should not carry fifty diffs.
        changeCount: Array.isArray(row.changes) ? row.changes.length : 0,
        createdAt: row.createdAt,
      })),
    };
  },

  /**
   * One timeline entry, spelled out.
   *
   * The identifiers on the log row are resolved into the actual records, so the
   * answer is a sentence and a set of facts rather than a pair of ids.
   */
  async activityDetail(id) {
    const row = await monitoringRepository.findActivity(id);
    if (!row) throw new NotFoundError('رکورد فعالیت');

    const detail = {
      id: row.id,
      action: row.action,
      description: `${actorName(row.user)} ${ACTION_PHRASES[row.action] || row.action}`,
      actor: row.user
        ? {
            id: row.user.id,
            name: actorName(row.user),
            username: row.user.username,
            agencyCode: row.user.agencyCode,
            role: row.user.role,
          }
        : null,
      ip: row.ip,
      device: row.device,
      // What the edit actually changed, with the labels recorded at the time.
      changes: Array.isArray(row.changes) ? row.changes : [],
      createdAt: row.createdAt,
      target: null,
    };

    // Every market writes its own word into `targetType`, and older rows say
    // «HAVALE» whatever they meant. They all point at the same table, so they
    // all resolve the same way — and the market's own name comes off the row.
    if (LISTING_TARGETS.has(row.targetType) && row.targetId) {
      const listing = await monitoringRepository.findListing(row.targetId);
      if (listing) {
        const label = marketOf(listing.market)?.label || 'آگهی';
        detail.target = {
          type: listing.market || 'LISTING',
          id: listing.id,
          label: `${label} #${toPersianDigits(listing.serial)} — ${listing.carType}`,
          kind: listing.kind,
          status: listing.status,
          amountToman: listing.amountToman === null ? null : Number(listing.amountToman),
          owner: {
            id: listing.owner.id,
            name: `${listing.owner.agencyName} (${listing.owner.agencyCode})`,
            city: listing.owner.city,
          },
        };
        detail.description =
          `${actorName(row.user)} ${ACTION_PHRASES[row.action] || row.action}: ` +
          `«${listing.carType}» متعلق به ${listing.owner.agencyName} (${listing.owner.agencyCode})`;
      }
    }

    if (row.targetType === 'USER' && row.targetId) {
      const target = await monitoringRepository.findUserBrief(row.targetId);
      if (target) {
        detail.target = { type: 'USER', id: target.id, label: actorName(target) };
        detail.description = `${actorName(row.user)} ${ACTION_PHRASES[row.action] || row.action}: ${actorName(target)}`;
      }
    }

    return detail;
  },

  async reveals(filters) {
    const [rows, total] = await monitoringRepository.listReveals(filters);

    return {
      total,
      items: rows.map((row) => ({
        id: row.id,
        at: row.createdAt,
        ip: row.ip,
        viewer: {
          id: row.viewer.id,
          name: actorName(row.viewer),
          agencyCode: row.viewer.agencyCode,
        },
        havale: {
          id: row.listing.id,
          serial: row.listing.serial,
          carType: row.listing.carType,
          kind: row.listing.kind,
        },
        owner: {
          id: row.listing.owner.id,
          name: row.listing.owner.agencyName,
          agencyCode: row.listing.owner.agencyCode,
        },
        // What was actually on screen at that moment, not what the profile says
        // today. Contact details can be corrected through a ticket, and without
        // this the log would quietly rewrite history (review round 3, fix 6).
        shown: { phone: row.phoneShown, agencyCode: row.agencyCodeShown },
        description:
          `${actorName(row.viewer)} مشخصات تماس حواله «${row.listing.carType}» ` +
          `از ${row.listing.owner.agencyName} را دید`,
      })),
    };
  },

  /**
   * Agencies worth a look.
   *
   * Blueprint 6.7 asked for suspicious behaviour to be flagged rather than
   * blocked, and the distinction matters: the caps already stop the volume, so
   * this is about noticing a shape. An agency opening dozens of numbers while
   * never posting anything is not buying — it is collecting.
   *
   * Every flag comes back with the numbers behind it. A flag somebody has to
   * take on trust gets ignored after the first false positive.
   */
  async suspicious({ days = 7, minReveals = 20 } = {}) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [reveals, havales] = await Promise.all([
      monitoringRepository.revealsPerAgency(since),
      monitoringRepository.havalesPerAgency(since),
    ]);

    const havaleCounts = new Map(havales.map((h) => [h.ownerId, h._count._all]));
    const candidates = reveals
      .map((r) => ({
        userId: r.viewerId,
        reveals: r._count._all,
        havales: havaleCounts.get(r.viewerId) || 0,
      }))
      .filter((row) => row.reveals >= minReveals);

    if (!candidates.length) return { days, minReveals, items: [] };

    const agencies = await monitoringRepository.agenciesByIds(candidates.map((c) => c.userId));
    const byId = new Map(agencies.map((a) => [a.id, a]));

    return {
      days,
      minReveals,
      items: candidates
        .map((row) => {
          const agency = byId.get(row.userId);
          const flags = [];

          if (row.havales === 0) flags.push('NO_LISTINGS_MANY_REVEALS');
          if (row.reveals >= minReveals * 3) flags.push('VERY_HIGH_VOLUME');
          if (agency && agency.fakeStrikes > 0) flags.push('HAS_STRIKES');

          return {
            agency: agency
              ? {
                  id: agency.id,
                  name: agency.agencyName,
                  agencyCode: agency.agencyCode,
                  city: agency.city,
                  status: agency.status,
                }
              : { id: row.userId },
            reveals: row.reveals,
            havales: row.havales,
            flags,
            // Stated in words so the reader does not have to reconstruct the
            // reasoning from two numbers.
            reason:
              row.havales === 0
                ? `در ${toPersianDigits(days)} روز گذشته ${toPersianDigits(row.reveals)} بار مشخصات دیده و هیچ حواله‌ای ثبت نکرده`
                : `در ${toPersianDigits(days)} روز گذشته ${toPersianDigits(row.reveals)} بار مشخصات دیده در برابر ${toPersianDigits(row.havales)} حواله`,
          };
        })
        .filter((row) => row.flags.length)
        .sort((a, b) => b.reveals - a.reveals),
    };
  },

  /**
   * The other shape: agencies nobody ever asks to contact.
   *
   * This is the check that catches a leak no text filter can. An agency that
   * has written its telephone number into its advertisements — spelled out,
   * split with stars, hidden behind a Telegram handle, or simply signed with
   * its own name — gets exactly the calls it wanted and *no reveals at all*,
   * because nobody needs to spend an allowance on a number already on the page.
   *
   * So the signal is not in the text, and does not have to be: many
   * advertisements, standing long enough to have been read, and not one person
   * who paid to see the contact. That is either an agency nobody wants to talk
   * to, or one being talked to off the platform — and both are worth a minute
   * of somebody's time.
   *
   * Nothing is blocked and nothing is written. It is a list a person reads.
   *
   * The age floor is what keeps it honest: an agency that joined on Tuesday and
   * posted six advertisements has no reveals yet because it is Wednesday.
   */
  async contactBypass({ days = 30, minListings = 5, minAgeDays = 7 } = {}) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const oldEnough = new Date(Date.now() - minAgeDays * 24 * 60 * 60 * 1000);

    const groups = await monitoringRepository.listingsPerAgency(since);
    const candidates = groups
      .map((g) => ({
        userId: g.ownerId,
        listings: g._count._all,
        reveals: g._sum.revealCount || 0,
        oldest: g._min.createdAt,
      }))
      .filter(
        (row) => row.listings >= minListings && row.reveals === 0 && row.oldest <= oldEnough
      );

    if (!candidates.length) return { days, minListings, items: [] };

    const agencies = await monitoringRepository.agenciesByIds(candidates.map((c) => c.userId));
    const byId = new Map(agencies.map((a) => [a.id, a]));

    return {
      days,
      minListings,
      items: candidates
        .map((row) => {
          const agency = byId.get(row.userId);
          return {
            agency: agency
              ? {
                  id: agency.id,
                  name: agency.agencyName,
                  agencyCode: agency.agencyCode,
                  city: agency.city,
                  status: agency.status,
                }
              : { id: row.userId },
            listings: row.listings,
            oldest: row.oldest,
            // Said in words, because two numbers and a flag name is a thing
            // people take on trust once and ignore afterwards.
            reason:
              `${toPersianDigits(row.listings)} آگهی در ${toPersianDigits(days)} روز گذشته، ` +
              'و حتی یک بار هم کسی مشخصات تماسشان را باز نکرده است',
          };
        })
        .sort((a, b) => b.listings - a.listings),
    };
  },
};

module.exports = monitoringService;
module.exports.ACTION_PHRASES = ACTION_PHRASES;
