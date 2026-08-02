const monitoringRepository = require('./monitoring.repository');
const { NotFoundError } = require('../../errors/AppError');
const { toPersianDigits } = require('../../utils/persian');

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
  AGENT_CREATED: 'حساب نمایندگی ساخت',
  AGENT_UPDATED: 'مشخصات نمایندگی را ویرایش کرد',
  AGENT_SUSPENDED: 'حساب نمایندگی را تعلیق کرد',
  AGENT_ACTIVATED: 'حساب نمایندگی را فعال کرد',
  AGENT_PASSWORD_RESET: 'رمز نمایندگی را عوض کرد',
  AGENT_FORCE_LOGGED_OUT: 'نشست نمایندگی را قطع کرد',
  AGENT_LIMITS_CHANGED: 'سقف یا حالت ماژول نمایندگی را تغییر داد',
  CATALOG_CHANGED: 'کاتالوگ خودرو را تغییر داد',
};

function actorName(user) {
  if (!user) return 'سیستم';
  if (user.agencyName) return `${user.agencyName}${user.agencyCode ? ` (${user.agencyCode})` : ''}`;
  return user.fullName || user.username;
}

const monitoringService = {
  overview() {
    return monitoringRepository.overview();
  },

  async activity(filters) {
    const [rows, total] = await monitoringRepository.listActivity(filters);
    return {
      total,
      items: rows.map((row) => ({
        id: row.id,
        action: row.action,
        // A one-line summary for the list. The full story is on the detail call,
        // which is the only one that costs extra queries.
        headline: `${actorName(row.user)} ${ACTION_PHRASES[row.action] || row.action}`,
        actor: row.user ? { id: row.user.id, name: actorName(row.user), role: row.user.role } : null,
        targetType: row.targetType,
        targetId: row.targetId,
        ip: row.ip,
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
      createdAt: row.createdAt,
      target: null,
    };

    if (row.targetType === 'HAVALE' && row.targetId) {
      const havale = await monitoringRepository.findHavale(row.targetId);
      if (havale) {
        detail.target = {
          type: 'HAVALE',
          id: havale.id,
          label: `حواله #${toPersianDigits(havale.serial)} — ${havale.carType}`,
          kind: havale.kind,
          status: havale.status,
          amountToman: havale.amountToman === null ? null : Number(havale.amountToman),
          owner: {
            id: havale.owner.id,
            name: `${havale.owner.agencyName} (${havale.owner.agencyCode})`,
            city: havale.owner.city,
          },
        };
        detail.description =
          `${actorName(row.user)} ${ACTION_PHRASES[row.action] || row.action}: ` +
          `«${havale.carType}» متعلق به ${havale.owner.agencyName} (${havale.owner.agencyCode})`;
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
          id: row.havale.id,
          serial: row.havale.serial,
          carType: row.havale.carType,
          kind: row.havale.kind,
        },
        owner: {
          id: row.havale.owner.id,
          name: row.havale.owner.agencyName,
          agencyCode: row.havale.owner.agencyCode,
        },
        // What was actually on screen at that moment, not what the profile says
        // today. Contact details can be corrected through a ticket, and without
        // this the log would quietly rewrite history (review round 3, fix 6).
        shown: { phone: row.phoneShown, agencyCode: row.agencyCodeShown },
        description:
          `${actorName(row.viewer)} مشخصات تماس حواله «${row.havale.carType}» ` +
          `از ${row.havale.owner.agencyName} را دید`,
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
};

module.exports = monitoringService;
module.exports.ACTION_PHRASES = ACTION_PHRASES;
