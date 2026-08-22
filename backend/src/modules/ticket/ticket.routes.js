const { Router } = require('express');
const Joi = require('joi');

const path = require('path');

const ticketService = require('./ticket.service');
const { upload, UPLOADS_DIR, MAX_FILES } = require('./ticket.upload');
const validate = require('../../middlewares/validate');
const asyncHandler = require('../../utils/asyncHandler');
const { success, created } = require('../../responses/apiResponse');
const {
  authenticate,
  requirePasswordChanged,
  requireRole,
  requirePermission,
} = require('../../middlewares/auth');
const { ROLES } = require('../../constants/roles');
const { MESSAGES } = require('../../constants/messages');

const router = Router();

/**
 * No subscription check anywhere in this file, on purpose.
 *
 * The access table allows an expired agency to open a ticket, because the most
 * common reason to write is to arrange a renewal — locking them out of the only
 * channel for asking how to pay is how an agency stops being a customer.
 */
router.use(authenticate, requirePasswordChanged);

const idParam = Joi.object({ id: Joi.string().trim().max(40).required() });
const bodyText = Joi.string().trim().min(5).max(4000).required();

/**
 * @openapi
 * /tickets:
 *   post:
 *     tags: [Ticket]
 *     summary: Open a ticket
 */
router.post(
  '/',
  requireRole(ROLES.AGENT),
  // Multipart when files ride along, plain JSON otherwise — multer only
  // touches multipart requests and leaves the JSON path exactly as it was.
  upload.array('files', MAX_FILES),
  validate({
    body: Joi.object({
      subject: Joi.string().trim().min(3).max(200).required(),
      priority: Joi.string().valid('LOW', 'NORMAL', 'HIGH').default('NORMAL'),
      body: bodyText,
    }),
  }),
  asyncHandler(async (req, res) => {
    const ticket = await ticketService.create({ user: req.user, ...req.body, files: req.files });
    return created(res, ticket, MESSAGES.TICKET.CREATED);
  })
);

/**
 * @openapi
 * /tickets/attachments/{id}:
 *   get:
 *     tags: [Ticket]
 *     summary: An attached file, behind the ticket's own visibility rules
 */
// Registered before '/:id' — otherwise "attachments" reads as a ticket id.
router.get(
  '/attachments/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const att = await ticketService.attachment({ user: req.user, id: req.params.id });
    res.setHeader('Content-Type', att.mime);
    // Images open in place; anything else downloads. `filename*` carries the
    // Persian original name safely.
    const disposition = att.mime.startsWith('image/') ? 'inline' : 'attachment';
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename*=UTF-8''${encodeURIComponent(att.name)}`
    );
    return res.sendFile(path.join(UPLOADS_DIR, att.storedAs));
  })
);

/**
 * @openapi
 * /tickets:
 *   get:
 *     tags: [Ticket]
 *     summary: Tickets — an agent's own, or the whole queue for staff
 */
router.get(
  '/',
  validate({
    query: Joi.object({ status: Joi.string().valid('OPEN', 'ANSWERED', 'CLOSED') }),
  }),
  asyncHandler(async (req, res) =>
    success(res, await ticketService.list({ user: req.user, status: req.query.status }))
  )
);

/**
 * @openapi
 * /tickets/{id}:
 *   get:
 *     tags: [Ticket]
 *     summary: One ticket with its conversation
 */
router.get(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) =>
    success(res, await ticketService.get({ user: req.user, id: req.params.id }))
  )
);

/**
 * @openapi
 * /tickets/{id}/messages:
 *   post:
 *     tags: [Ticket]
 *     summary: Reply
 *     description: >
 *       A staff reply marks the ticket answered; an agent reply reopens it. The
 *       status and the conversation move together so the queue stays honest.
 */
router.post(
  '/:id/messages',
  upload.array('files', MAX_FILES),
  validate({ params: idParam, body: Joi.object({ body: bodyText }) }),
  asyncHandler(async (req, res) => {
    const ticket = await ticketService.reply({
      user: req.user,
      id: req.params.id,
      body: req.body.body,
      files: req.files,
    });
    return success(res, ticket, MESSAGES.TICKET.REPLIED);
  })
);

/**
 * @openapi
 * /tickets/{id}/status:
 *   put:
 *     tags: [Ticket]
 *     summary: Close or reopen
 *     description: Either side may close; only staff may reopen.
 */
router.put(
  '/:id/status',
  validate({
    params: idParam,
    body: Joi.object({ status: Joi.string().valid('OPEN', 'ANSWERED', 'CLOSED').required() }),
  }),
  asyncHandler(async (req, res) => {
    const ticket = await ticketService.setStatus({
      user: req.user,
      id: req.params.id,
      status: req.body.status,
    });
    return success(res, ticket);
  })
);

/**
 * @openapi
 * /tickets/{id}/priority:
 *   put:
 *     tags: [Ticket]
 *     summary: Change priority — staff only
 */
router.put(
  '/:id/priority',
  requirePermission('tickets'),
  validate({
    params: idParam,
    body: Joi.object({ priority: Joi.string().valid('LOW', 'NORMAL', 'HIGH').required() }),
  }),
  asyncHandler(async (req, res) => {
    const ticket = await ticketService.setPriority({
      id: req.params.id,
      priority: req.body.priority,
    });
    return success(res, ticket);
  })
);

module.exports = router;
