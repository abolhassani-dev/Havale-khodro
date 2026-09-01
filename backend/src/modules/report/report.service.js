const reportRepository = require('./report.repository');
const authRepository = require('../auth/auth.repository');
const settingsService = require('../settings/settings.service');
const smsService = require('../sms/sms.service');
const { MESSAGES } = require('../../constants/messages');
const { ROLES, can } = require('../../constants/roles');
const { addDays } = require('../../utils/time');
const {
  REPORT_STATUS,
  REPORT_WINDOW_DAYS,
  STRIKE_THRESHOLD,
  REASONS_REQUIRING_CONTACT,
} = require('../../constants/moderation');
const {
  NotFoundError,
  ForbiddenError,
  BadRequestError,
  ConflictError,
} = require('../../errors/AppError');

/**
 * Violation reports, which cut both ways.
 *
 * The requirement was two things at once: stop fake listings, and stop
 * vexatious reports. A system that only punishes the accused becomes a weapon
 * for a competitor — report every rival three times and they are suspended. So
 * a verdict can land on either party, and both sides accumulate strikes.
 */

const reportService = {
  /**
   * File a report.
   *
   * Everything refused here is refused because of a specific way the feature
   * could be abused; none of it is defensive coding for its own sake.
   */
  async create({ user, listingId, reason, description }) {
    const havale = await reportRepository.findHavaleIncludingDeleted(listingId);
    if (!havale) throw new NotFoundError('آگهی');

    if (havale.ownerId === user.id) throw new BadRequestError(MESSAGES.REPORT.OWN_LISTING);

    // Deliberately still reportable after it closed, and after it was deleted.
    // Otherwise the escape route is obvious: take the calls, then delete the
    // listing before anyone complains (review round 3, fix 7).
    const closed = havale.deletedAt || havale.closesAt;
    if (closed && addDays(new Date(closed), REPORT_WINDOW_DAYS) < new Date()) {
      throw new BadRequestError(MESSAGES.REPORT.TOO_OLD);
    }

    const existing = await reportRepository.findByHavaleAndReporter(listingId, user.id);
    // One report per agent per listing. Without it, three colleagues could file
    // fifteen reports and manufacture a suspension.
    if (existing) throw new ConflictError(MESSAGES.REPORT.ALREADY_REPORTED);

    const dailyLimit = await settingsService.get('report.dailyLimit');
    const recent = await reportRepository.countRecentByReporter(
      user.id,
      new Date(Date.now() - 24 * 60 * 60 * 1000)
    );
    if (recent >= dailyLimit) throw new ForbiddenError(MESSAGES.REPORT.DAILY_LIMIT);

    // "Nobody answers" is a claim only somebody who tried to call can make, and
    // the reveal log is the proof they tried (blueprint 8.2).
    if (REASONS_REQUIRING_CONTACT.includes(reason)) {
      const revealed = await reportRepository.hasRevealed(listingId, user.id);
      if (!revealed) throw new BadRequestError(MESSAGES.REPORT.NEEDS_CONTACT_FIRST);
    }

    const [report] = await reportRepository.create({
      listingId,
      reporterId: user.id,
      reason,
      description,
    });

    await authRepository.recordActivity({
      userId: user.id,
      action: 'REPORT_FILED',
      targetType: 'HAVALE',
      targetId: listingId,
      summary: reason,
    });

    return toReport(await reportRepository.findById(report.id));
  },

  /**
   * The admin verdict. Four outcomes, and each lands somewhere different
   * (blueprint 8.3).
   *
   * The third strike is the one that suspends an account, and support staff do
   * not have that authority — so when a verdict would be somebody's third, it is
   * recorded and queued for the super admin instead of taking effect (review
   * round 3, fix 4). Support can still do their job; they just cannot end an
   * agency's month on their own.
   */
  async review({ actor, reportId, verdict, note }) {
    const report = await reportRepository.findById(reportId);
    if (!report) throw new NotFoundError('گزارش تخلف');

    if (report.status !== REPORT_STATUS.PENDING) {
      throw new BadRequestError(MESSAGES.REPORT.ALREADY_REVIEWED);
    }

    if (verdict === REPORT_STATUS.REJECTED) {
      await reportRepository.update(reportId, {
        status: REPORT_STATUS.REJECTED,
        reviewedById: actor.id,
        reviewedAt: new Date(),
        adminNote: note,
      });
      await this.log(actor, 'REPORT_REJECTED', report);
      return toReport(await reportRepository.findById(reportId));
    }

    if (verdict === REPORT_STATUS.CONFIRMED) {
      return this.confirm({ actor, report, note });
    }

    return this.markAbusive({ actor, report, note });
  },

  /** Upheld: the listing goes down and the advertiser takes a strike. */
  async confirm({ actor, report, note }) {
    const owner = report.listing.owner;
    const wouldReachThreshold = owner.fakeStrikes + 1 >= STRIKE_THRESHOLD;
    const maySuspend = can(actor.role, 'thirdStrike');

    await reportRepository.confirmAgainstOwner({
      reportId: report.id,
      reviewerId: actor.id,
      note,
      ownerId: owner.id,
      listingId: report.listingId,
      needsSuperApproval: wouldReachThreshold && !maySuspend,
    });

    if (wouldReachThreshold && maySuspend) {
      await reportRepository.suspendAccount(owner.id);
    }

    // Told, not ambushed. Before this, an advertiser found out about the
    // warnings against them at the moment their account stopped working
    // (blueprint 8.5) — and they get to answer through a ticket.
    await this.notifyStrike({
      report,
      userId: owner.id,
      phone: owner.phone,
      strikes: owner.fakeStrikes + 1,
    });

    await this.log(actor, 'REPORT_CONFIRMED', report);
    return toReport(await reportRepository.findById(report.id));
  },

  /** Vexatious: nothing happens to the advertiser, and the reporter takes the strike. */
  async markAbusive({ actor, report, note }) {
    const reporter = report.reporter;
    const wouldReachThreshold = reporter.falseReportStrikes + 1 >= STRIKE_THRESHOLD;
    const maySuspend = can(actor.role, 'thirdStrike');

    await reportRepository.markAbusive({
      reportId: report.id,
      reviewerId: actor.id,
      note,
      reporterId: reporter.id,
      needsSuperApproval: wouldReachThreshold && !maySuspend,
    });

    if (wouldReachThreshold && maySuspend) {
      await reportRepository.suspendAccount(reporter.id);
    }

    await this.log(actor, 'REPORT_MARKED_ABUSIVE', report);
    return toReport(await reportRepository.findById(report.id));
  },

  /**
   * The fourth outcome: not decided yet, but the listing should not stay up
   * while it is being looked into (blueprint 8.3).
   *
   * The report stays PENDING on purpose — this is an interim measure, not a
   * verdict, and treating it as one would put a strike on an unproven claim.
   */
  async hold({ actor, reportId, note }) {
    const report = await reportRepository.findById(reportId);
    if (!report) throw new NotFoundError('گزارش تخلف');
    if (report.status !== REPORT_STATUS.PENDING) {
      throw new BadRequestError(MESSAGES.REPORT.ALREADY_REVIEWED);
    }

    await reportRepository.hideHavale(report.listingId, 'در دست بررسی');
    await reportRepository.update(reportId, { adminNote: note });
    await this.log(actor, 'REPORT_HELD', report);

    return toReport(await reportRepository.findById(reportId));
  },

  /**
   * The super admin signing off on a suspension support could not carry out.
   *
   * Reads the strike count fresh rather than trusting the number recorded when
   * the report was queued — by the time somebody looks at the queue, the count
   * may have moved.
   */
  async approveSuspension({ actor, reportId }) {
    const report = await reportRepository.findById(reportId);
    if (!report) throw new NotFoundError('گزارش تخلف');
    if (!report.needsSuperApproval) throw new BadRequestError(MESSAGES.REPORT.NO_APPROVAL_PENDING);

    const target =
      report.status === REPORT_STATUS.ABUSIVE ? report.reporter : report.listing.owner;

    await reportRepository.suspendAccount(target.id);
    await reportRepository.update(reportId, { needsSuperApproval: false });

    await authRepository.recordActivity({
      userId: actor.id,
      action: 'ACCOUNT_SUSPENDED_BY_STRIKES',
      targetType: 'USER',
      targetId: target.id,
      summary: report.id,
    });

    return toReport(await reportRepository.findById(reportId));
  },

  async notifyStrike({ report, userId, phone, strikes }) {
    await reportRepository.update(report.id, { ownerNotifiedAt: new Date() });
    // Fire and forget by design: an SMS panel being down must not roll back a
    // moderation decision.
    await smsService.send({
      to: phone,
      template: 'VIOLATION_STRIKE',
      params: { strikes, limit: STRIKE_THRESHOLD },
      userId,
    });
  },

  async log(actor, action, report) {
    return authRepository.recordActivity({
      userId: actor.id,
      action,
      targetType: 'REPORT',
      targetId: report.id,
      summary: report.reason,
    });
  },

  async list(filters) {
    const reports = await reportRepository.list(filters);
    return reports.map(toReport);
  },

  /**
   * The reports this agency filed, with what came of them.
   *
   * The other half of the file: `listAgainstMe` says what was upheld against
   * them, this says what happened to the ones they raised. Without it a report
   * is a thing you send into silence — and one of the outcomes carries a strike
   * of its own, which nobody should learn about only from the count on their
   * dashboard.
   *
   * The accused agency's identity is not on it, exactly as it is not on the
   * accuser's side.
   */
  async listFiledBy(user, take = 50) {
    const reports = await reportRepository.list({ reporterId: user.id, take });
    return reports
      .filter((r) => r.status !== 'PENDING')
      .map((r) => ({
        id: r.id,
        serial: r.serial,
        status: r.status,
        reason: r.reason,
        adminNote: r.adminNote,
        listing: { serial: r.listing.serial, carType: r.listing.carType },
        createdAt: r.createdAt,
        reviewedAt: r.reviewedAt,
      }));
  },

  /**
   * What the accused agency sees about itself.
   *
   * Only upheld reports, and without the reporter — telling an advertiser who
   * reported them turns the feature into a way to find out who to lean on.
   */
  async listAgainstMe(user) {
    const reports = await reportRepository.listAgainstOwner(user.id);
    return {
      strikes: user.fakeStrikes,
      limit: STRIKE_THRESHOLD,
      items: reports.map((r) => ({
        id: r.id,
        serial: r.serial,
        reason: r.reason,
        havale: { id: r.listing.id, serial: r.listing.serial, carType: r.listing.carType },
        adminNote: r.adminNote,
        createdAt: r.createdAt,
        reviewedAt: r.reviewedAt,
      })),
    };
  },
};

/**
 * The admin-facing shape.
 *
 * The advertiser's phone number is not on it. Support handles reports and does
 * not hold the contact-export permission, so a moderation screen must not become
 * the way around that (blueprint 11.12).
 */
function toReport(report) {
  return {
    id: report.id,
    serial: report.serial,
    reason: report.reason,
    description: report.description,
    status: report.status,
    needsSuperApproval: report.needsSuperApproval,
    adminNote: report.adminNote,
    ownerNotifiedAt: report.ownerNotifiedAt,
    createdAt: report.createdAt,
    reviewedAt: report.reviewedAt,
    reporter: {
      id: report.reporter?.id,
      agencyCode: report.reporter?.agencyCode,
      agencyName: report.reporter?.agencyName,
      falseReportStrikes: report.reporter?.falseReportStrikes,
    },
    havale: {
      id: report.listing.id,
      serial: report.listing.serial,
      carType: report.listing.carType,
      status: report.listing.status,
      owner: {
        id: report.listing.owner.id,
        agencyCode: report.listing.owner.agencyCode,
        agencyName: report.listing.owner.agencyName,
        fakeStrikes: report.listing.owner.fakeStrikes,
        status: report.listing.owner.status,
      },
    },
  };
}

module.exports = reportService;
module.exports.ROLES = ROLES;
