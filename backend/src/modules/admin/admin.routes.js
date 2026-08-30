const { Router } = require('express');
const Joi = require('joi');

const agentService = require('./agent.service');
const listingService = require('./listing.service');
const monitoringService = require('./monitoring.service');
const catalogAdminRoutes = require('../catalog/catalog.admin.routes');
const staffRoutes = require('./staff.routes');
const brandAccess = require('../catalog/brandAccess.service');
const { allMarkets } = require('../listing/marketRegistry');
const authRepository = require('../auth/auth.repository');
const { ticketRepository } = require('../ticket/ticket.repository');
const subscriptionRepository = require('../subscription/subscription.repository');
const reportRepository = require('../report/report.repository');
const { effectivePermissions } = require('../../constants/roles');
const validate = require('../../middlewares/validate');
const asyncHandler = require('../../utils/asyncHandler');
const { success, created } = require('../../responses/apiResponse');
const {
  authenticate,
  requirePasswordChanged,
  requireAdmin,
  requirePermission,
} = require('../../middlewares/auth');
const { MESSAGES } = require('../../constants/messages');
const { BadRequestError } = require('../../errors/AppError');

const router = Router();

/**
 * The admin panel.
 *
 * Being an admin gets you through the door; each section is then gated by its
 * own named permission, because the three roles exist precisely so that hiring a
 * support person does not hand them the contact data the business rests on
 * (blueprint 11.12).
 */
router.use(authenticate, requirePasswordChanged, requireAdmin);

const idParam = Joi.object({ id: Joi.string().trim().max(40).required() });
const iranMobile = Joi.string()
  .trim()
  .pattern(/^09\d{9}$/)
  .messages({ 'string.pattern.base': 'شماره موبایل باید با ۰۹ شروع شود و ۱۱ رقم باشد' });

// ── catalogue ───────────────────────────────────────────────────────────────

router.use('/catalog', catalogAdminRoutes);
// Owner only — the router itself requires the `staff` permission.
router.use('/staff', staffRoutes);

/**
 * @openapi
 * /admin/badges:
 *   get:
 *     tags: [Admin]
 *     summary: The numbers the sidebar wears — open tickets, pending capacity orders
 *     description: >
 *       Per-permission: a count is null when this account cannot see that queue,
 *       so the menu never advertises work behind a door it cannot open.
 */
router.get(
  '/badges',
  asyncHandler(async (req, res) => {
    const perms = effectivePermissions(req.user);
    const [openTickets, pendingSeatOrders, pendingReports] = await Promise.all([
      perms.tickets ? ticketRepository.countOpen() : null,
      perms.seats ? subscriptionRepository.countPendingSeatOrders() : null,
      // A report sitting unread is a listing the market is still being shown.
      // The tickets queue has worn its number since the beginning; this queue
      // is the one with a deadline on it.
      perms.reports ? reportRepository.countPending() : null,
    ]);
    return success(res, { openTickets, pendingSeatOrders, pendingReports });
  })
);

// ── monitoring ──────────────────────────────────────────────────────────────

/**
 * @openapi
 * /admin/overview:
 *   get:
 *     tags: [Admin]
 *     summary: Dashboard figures
 */
router.get(
  '/overview',
  requirePermission('monitoring'),
  asyncHandler(async (_req, res) => success(res, await monitoringService.overview()))
);

/**
 * @openapi
 * /admin/activity:
 *   get:
 *     tags: [Admin]
 *     summary: The activity timeline
 */
router.get(
  '/activity',
  requirePermission('monitoring'),
  validate({
    query: Joi.object({
      userId: Joi.string().trim().max(40),
      // One exact action, still supported — it is how a link from elsewhere in
      // the panel says «only this». The filter bar offers families instead:
      // forty action names in a dropdown is a list nobody reads. The service
      // owns the grouping and publishes it at /admin/activity/families, so the
      // panel invents none of it.
      action: Joi.string().trim().max(60),
      family: Joi.string().trim().valid(...monitoringService.families().map((f) => f.key)),
      q: Joi.string().trim().max(60),
      serial: Joi.number().integer().min(1),
      from: Joi.date(),
      to: Joi.date(),
      skip: Joi.number().integer().min(0).default(0),
      take: Joi.number().integer().min(1).max(200).default(50),
    }),
  }),
  asyncHandler(async (req, res) => success(res, await monitoringService.activity(req.query)))
);

/**
 * @openapi
 * /admin/activity/families:
 *   get:
 *     tags: [Admin]
 *     summary: The event groups the timeline can be filtered by
 */
router.get(
  '/activity/families',
  requirePermission('monitoring'),
  asyncHandler(async (req, res) => success(res, { families: monitoringService.families() }))
);

/**
 * @openapi
 * /admin/activity/{id}:
 *   get:
 *     tags: [Admin]
 *     summary: One timeline entry, spelled out
 *     description: >
 *       Resolves the identifiers on the log row into the actual records, so the
 *       answer is a sentence — "this agency opened the contact details on that
 *       listing, which belongs to this agency" — rather than a pair of ids. An
 *       audit trail nobody can read is not an audit trail.
 */
router.get(
  '/activity/:id',
  requirePermission('monitoring'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) =>
    success(res, await monitoringService.activityDetail(req.params.id))
  )
);

/**
 * @openapi
 * /admin/reveals:
 *   get:
 *     tags: [Admin]
 *     summary: Who opened whose contact details, and what they saw
 *     description: >
 *       The record the monitoring feature exists for. The advertiser only ever
 *       sees a count; here the identities are complete. Restricted to the
 *       contact-export permission, which support does not hold — this is a list
 *       of phone numbers.
 */
router.get(
  '/reveals',
  requirePermission('bulkContacts'),
  validate({
    query: Joi.object({
      viewerId: Joi.string().trim().max(40),
      // Accepted under both names while the panel catches up — see the report
      // route for the same courtesy.
      listingId: Joi.string().trim().max(40),
      havaleId: Joi.string().trim().max(40),
      from: Joi.date(),
      to: Joi.date(),
      skip: Joi.number().integer().min(0).default(0),
      take: Joi.number().integer().min(1).max(200).default(50),
    }),
  }),
  asyncHandler(async (req, res) =>
    success(
      res,
      await monitoringService.reveals({
        ...req.query,
        listingId: req.query.listingId || req.query.havaleId,
      })
    )
  )
);

/**
 * @openapi
 * /admin/suspicious:
 *   get:
 *     tags: [Admin]
 *     summary: Agencies whose behaviour is worth a look
 *     description: >
 *       Flagged, not blocked — the caps already stop the volume, so this is about
 *       noticing a shape. An agency opening dozens of numbers while never posting
 *       anything is not buying, it is collecting. Every flag comes with the
 *       numbers behind it.
 */
router.get(
  '/suspicious',
  requirePermission('monitoring'),
  validate({
    query: Joi.object({
      days: Joi.number().integer().min(1).max(90).default(7),
      minReveals: Joi.number().integer().min(1).max(1000).default(20),
    }),
  }),
  asyncHandler(async (req, res) => success(res, await monitoringService.suspicious(req.query)))
);

// ── listings ────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /admin/havales:
 *   get:
 *     tags: [Admin]
 *     summary: Every listing, including suspended and removed ones
 *     description: >
 *       The agency-facing list hides suspended listings, removed ones, and
 *       whose they are. This one shows all three, because the question here is
 *       «what is this listing and who posted it», not «what may I buy».
 *       `market` narrows it to one market; without it the desk sees everything.
 */
router.get(
  '/havales',
  requirePermission('listings'),
  validate({
    query: Joi.object({
      query: Joi.string().trim().max(120).allow(''),
      // Checked against the registry at request time rather than against a
      // list written here: a market added tomorrow must not need this file
      // edited before its listings can be moderated.
      market: Joi.string()
        .trim()
        .max(24)
        .custom((value, helpers) =>
          allMarkets().some((m) => m.key === value) ? value : helpers.error('any.invalid')
        ),
      kind: Joi.string().valid('OFFER', 'REQUEST'),
      // LIVE and DELETED are not columns — see the repository.
      status: Joi.string().valid('ALL', 'LIVE', 'DELETED', 'ACTIVE', 'FULFILLED', 'EXPIRED', 'SUSPENDED', 'ARCHIVED'),
      ownerId: Joi.string().trim().max(40),
      skip: Joi.number().integer().min(0).default(0),
      take: Joi.number().integer().min(1).max(100).default(25),
    }),
  }),
  asyncHandler(async (req, res) => success(res, await listingService.list(req.query)))
);

/**
 * @openapi
 * /admin/havales/{id}:
 *   get:
 *     tags: [Admin]
 *     summary: One listing in full, with its reports
 *     description: >
 *       Contact details are included only for an account with the
 *       «bulkContacts» permission — the same rule that governs seeing a number
 *       without spending a reveal anywhere else in the system.
 */
router.get(
  '/havales/:id',
  requirePermission('listings'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) =>
    success(res, await listingService.detail({ actor: req.user, id: req.params.id }))
  )
);

/**
 * @openapi
 * /admin/havales/{id}/status:
 *   put:
 *     tags: [Admin]
 *     summary: Suspend a listing, or put it back
 */
router.put(
  '/havales/:id/status',
  requirePermission('listings'),
  validate({
    params: idParam,
    body: Joi.object({
      status: Joi.string().valid('ACTIVE', 'SUSPENDED').required(),
      // The agency reads this on its own listing, so it is required to suspend
      // and enforced in the service rather than only here.
      reason: Joi.string().trim().max(300).allow('', null),
    }),
  }),
  asyncHandler(async (req, res) =>
    success(
      res,
      await listingService.setStatus({
        actor: req.user,
        id: req.params.id,
        status: req.body.status,
        reason: req.body.reason,
      }),
      MESSAGES.HAVALE.UPDATED
    )
  )
);

/**
 * @openapi
 * /admin/havales/{id}/removed:
 *   put:
 *     tags: [Admin]
 *     summary: Take a listing down, or restore it
 *     description: >
 *       A soft delete: the row stays, so the reveal history and the violation
 *       reports pointing at it survive. Agencies' queries filter on it.
 */
router.put(
  '/havales/:id/removed',
  requirePermission('listings'),
  validate({
    params: idParam,
    body: Joi.object({
      removed: Joi.boolean().required(),
      reason: Joi.string().trim().max(300).allow('', null),
    }),
  }),
  asyncHandler(async (req, res) =>
    success(
      res,
      await listingService.setRemoved({
        actor: req.user,
        id: req.params.id,
        removed: req.body.removed,
        reason: req.body.reason,
      }),
      MESSAGES.HAVALE.UPDATED
    )
  )
);

// ── agencies ────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /admin/agents:
 *   get:
 *     tags: [Admin]
 *     summary: Search agencies
 */
router.get(
  '/agents',
  requirePermission('agents'),
  validate({
    query: Joi.object({
      query: Joi.string().trim().max(120),
      status: Joi.string().valid('ACTIVE', 'SUSPENDED'),
      city: Joi.string().trim().max(60),
      isReseller: Joi.boolean(),
      skip: Joi.number().integer().min(0).default(0),
      take: Joi.number().integer().min(1).max(100).default(25),
    }),
  }),
  asyncHandler(async (req, res) => success(res, await agentService.list(req.query)))
);

/**
 * @openapi
 * /admin/agents:
 *   post:
 *     tags: [Admin]
 *     summary: Create an agency account
 *     description: >
 *       The only door into the system: there is no public registration. The
 *       password is chosen here, shown once so it can be passed on, and must be
 *       replaced by the agency on first sign-in.
 */
router.post(
  '/agents',
  requirePermission('agents'),
  validate({
    body: Joi.object({
      username: Joi.string()
        .trim()
        .lowercase()
        .pattern(/^[a-z0-9._-]+$/)
        .min(3)
        .max(60)
        .required(),
      password: Joi.string().min(8).max(128).required(),
      fullName: Joi.string().trim().min(3).max(120).required(),
      phone: iranMobile.required(),
      // Mandatory for everyone (review round 2, fix 4): without it a reseller
      // has nothing to derive its sub-agency codes from.
      agencyCode: Joi.string().trim().min(2).max(40).required(),
      agencyName: Joi.string().trim().min(2).max(120).required(),
      city: Joi.string().trim().min(2).max(60).required(),
      coordinatorName: Joi.string().trim().min(3).max(120).required(),
      coordinatorPhone: iranMobile.required(),
      isReseller: Joi.boolean().default(false),
      adminNote: Joi.string().trim().max(1000).allow('', null),
      // Required, and required to be non-empty. Brand access is chosen when the
      // agency is made rather than restricted afterwards: an account somebody
      // forgot to configure would otherwise be one that can post anything, and
      // the safe direction to be wrong in is the other one.
      brandIds: Joi.array().items(Joi.string().trim().max(40)).required().messages({
        'any.required': 'انتخاب برند الزامی است',
      }),
      modelIds: Joi.array().items(Joi.string().trim().max(40)).default([]),
    }),
  }),
  asyncHandler(async (req, res) => {
    // Required to add up to something: a whole brand, or at least one model.
    // (Either grain counts — an agency that handles one Fownix model is real.)
    if (!req.body.brandIds.length && !req.body.modelIds.length) {
      throw new BadRequestError('حداقل یک برند یا مدل برای این نمایندگی انتخاب کنید');
    }

    const agent = await agentService.create({ actor: req.user, payload: req.body });
    await brandAccess.setBrands({
      userId: agent.id,
      brandIds: req.body.brandIds,
      modelIds: req.body.modelIds,
    });
    // Echoed once, deliberately: it is the only moment anyone can read it, and
    // it is not stored anywhere in plain text.
    return created(res, { ...agent, initialPassword: req.body.password }, MESSAGES.USER.CREATED);
  })
);

/**
 * @openapi
 * /admin/agents/{id}:
 *   get:
 *     tags: [Admin]
 *     summary: One agency with its headline counts
 */
router.get(
  '/agents/:id',
  requirePermission('agents'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => success(res, await agentService.get(req.params.id)))
);

/**
 * @openapi
 * /admin/agents/{id}/brands:
 *   get:
 *     tags: [Admin]
 *     summary: Every brand, flagged with whether this agency may post under it
 *     description: >
 *       All of them, not only the allowed ones — the picker has to show what is
 *       unticked as much as what is ticked.
 */
router.get(
  '/agents/:id/brands',
  requirePermission('agents'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => success(res, await agentService.brandChoicesFor(req.params.id)))
);

/**
 * @openapi
 * /admin/agents/{id}/brands:
 *   put:
 *     tags: [Admin]
 *     summary: Replace the brands an agency may post under
 *     description: >
 *       PUT rather than PATCH because it replaces the whole set — which is what
 *       a screen full of checkboxes submits, and what makes "untick this one"
 *       expressible at all.
 */
router.put(
  '/agents/:id/brands',
  requirePermission('agents'),
  validate({
    params: idParam,
    body: Joi.object({
      // Allowed to be empty here, unlike on create: taking every brand away
      // from an existing agency is a deliberate act with a visible effect —
      // they stop being able to post — whereas a *new* account with none is
      // usually somebody who skipped the field.
      brandIds: Joi.array().items(Joi.string().trim().max(40)).required(),
      // Single-model grants, for the agency whose whole job is one car.
      modelIds: Joi.array().items(Joi.string().trim().max(40)).default([]),
    }),
  }),
  asyncHandler(async (req, res) => {
    const count = await agentService.setBrands({
      id: req.params.id,
      brandIds: req.body.brandIds,
      modelIds: req.body.modelIds,
    });
    await authRepository.recordActivity({
      userId: req.user.id,
      action: 'AGENT_UPDATED',
      targetType: 'USER',
      targetId: req.params.id,
      summary: `brands:${count}`,
    });
    return success(res, { count });
  })
);

/**
 * @openapi
 * /admin/agents/{id}:
 *   patch:
 *     tags: [Admin]
 *     summary: Edit an agency's profile and contact details
 *     description: >
 *       Contact details are locked for the agency itself and changed only here,
 *       on the back of a ticket — otherwise an agency could take payment for
 *       contact reveals and then change the number. Support holds this
 *       permission because it is the one change they are meant to be able to
 *       make.
 */
router.patch(
  '/agents/:id',
  requirePermission('contactEdit'),
  validate({
    params: idParam,
    body: Joi.object({
      fullName: Joi.string().trim().min(3).max(120),
      phone: iranMobile,
      agencyName: Joi.string().trim().min(2).max(120),
      city: Joi.string().trim().min(2).max(60),
      coordinatorName: Joi.string().trim().min(3).max(120),
      coordinatorPhone: iranMobile,
      adminNote: Joi.string().trim().max(1000).allow('', null),
    }).min(1),
  }),
  asyncHandler(async (req, res) => {
    const agent = await agentService.update({
      actor: req.user,
      id: req.params.id,
      payload: req.body,
    });
    return success(res, agent, MESSAGES.USER.UPDATED);
  })
);

/**
 * @openapi
 * /admin/agents/{id}/status:
 *   put:
 *     tags: [Admin]
 *     summary: Suspend or reactivate an agency
 *     description: >
 *       Suspending ends every live session at once and leaves the subscription
 *       untouched — suspended, not refunded.
 */
router.put(
  '/agents/:id/status',
  requirePermission('agents'),
  validate({
    params: idParam,
    body: Joi.object({ status: Joi.string().valid('ACTIVE', 'SUSPENDED').required() }),
  }),
  asyncHandler(async (req, res) => {
    const agent = await agentService.setStatus({
      actor: req.user,
      id: req.params.id,
      status: req.body.status,
    });
    return success(res, agent);
  })
);

/**
 * @openapi
 * /admin/agents/{id}/password:
 *   put:
 *     tags: [Admin]
 *     summary: Set an agency's password
 */
router.put(
  '/agents/:id/password',
  requirePermission('agents'),
  validate({
    params: idParam,
    body: Joi.object({ password: Joi.string().min(8).max(128).required() }),
  }),
  asyncHandler(async (req, res) => {
    const result = await agentService.resetPassword({
      actor: req.user,
      id: req.params.id,
      password: req.body.password,
    });
    return success(res, result, MESSAGES.AUTH.PASSWORD_CHANGED);
  })
);

/**
 * @openapi
 * /admin/agents/{id}/logout:
 *   post:
 *     tags: [Admin]
 *     summary: Sign an agency out of wherever it is signed in
 */
router.post(
  '/agents/:id/logout',
  requirePermission('agents'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) =>
    success(res, await agentService.forceLogout({ actor: req.user, id: req.params.id }))
  )
);

/**
 * @openapi
 * /admin/agents/{id}/limits:
 *   put:
 *     tags: [Admin]
 *     summary: Module mode and per-account reveal caps
 *     description: >
 *       The levers for handling one large customer without inventing a plan for
 *       them. A null override falls back to the plan's own cap.
 */
router.put(
  '/agents/:id/limits',
  requirePermission('agents'),
  validate({
    params: idParam,
    body: Joi.object({
      isReseller: Joi.boolean(),
      seatCredits: Joi.number().integer().min(0).max(10000),
      dailyRevealLimitOverride: Joi.number().integer().min(0).max(10000).allow(null),
      monthlyRevealLimitOverride: Joi.number().integer().min(0).max(100000).allow(null),
    }).min(1),
  }),
  asyncHandler(async (req, res) => {
    const agent = await agentService.setLimits({
      actor: req.user,
      id: req.params.id,
      payload: req.body,
    });
    return success(res, agent);
  })
);

module.exports = router;
