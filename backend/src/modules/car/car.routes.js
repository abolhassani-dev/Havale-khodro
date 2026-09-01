const { Router } = require('express');
const Joi = require('joi');

const carService = require('./car.service');
const schema = require('./car.validator');
const { upload, MAX_FILES } = require('./car.upload');
const { discardOnFailure } = require('../../utils/uploads');
const validate = require('../../middlewares/validate');
const asyncHandler = require('../../utils/asyncHandler');
const { success, created } = require('../../responses/apiResponse');
const { authenticate, requirePasswordChanged, requireRole } = require('../../middlewares/auth');
const { attachAccess, requireActiveSubscription } = require('../../middlewares/access');
const { ROLES } = require('../../constants/roles');
const { MESSAGES } = require('../../constants/messages');

// Announces this market to the shared moderation desk — see
// modules/listing/marketRegistry.
require('./car.market');

const router = Router();

/**
 * What an identifier looks like, written into the route itself.
 *
 * Without it, `/cars/photos` — a path that is a typo, or somebody walking the
 * API by hand — matched `/:id` and was answered «آگهی خودرو پیدا نشد», as
 * though «photos» were an advertisement that had been withdrawn. Nothing was
 * disclosed either way, but a path that is not an id should be told it is not
 * a path, not given a market's answer about a thing that never existed.
 *
 * Ids here are cuid (25 characters); the range is wide enough that a uuid
 * would pass too, if the schema ever changes under this.
 */
const ID = ':id([A-Za-z0-9_-]{10,40})';

/**
 * @openapi
 * /cars/photos/{fileName}:
 *   get:
 *     tags: [Car]
 *     summary: One photo — owner, admin, or a viewer with a recorded reveal
 *     description: >
 *       Registered above the agent-only gate on purpose: a moderator looking
 *       at a reported advertisement must see its photos. Everybody else meets
 *       exactly the reveal boundary the description has — a photo can carry a
 *       phone number on a windshield, so it is never served publicly.
 */
router.get(
  '/photos/:fileName',
  authenticate,
  requirePasswordChanged,
  validate({
    params: Joi.object({
      // The generated name: a UUID plus a verified-type extension. Anything
      // else is not a name this system ever wrote, so it is refused before
      // touching the disk — the filename is the whole address, and this shape
      // check is what keeps traversal characters out of the path join.
      fileName: Joi.string()
        .pattern(/^[0-9a-f-]{36}\.(jpg|png|webp)$/)
        .required(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const file = await carService.photoFile({ user: req.user, fileName: req.params.fileName });
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.sendFile(file.path);
  })
);

/**
 * The خودرو market.
 *
 * The same shape as its two siblings: everything needs a live session and the
 * entitlement resolved; the subscription check gates acting, not browsing.
 *
 * One deliberate difference: no brand-access check anywhere. A finished car
 * on the lot is anybody's to sell — the factory-allocation rule of the حواله
 * market has no meaning here, and the owner asked for the full catalogue.
 */
router.use(authenticate, requirePasswordChanged, requireRole(ROLES.AGENT), attachAccess);

/**
 * @openapi
 * /cars:
 *   get:
 *     tags: [Car]
 *     summary: Browse cars for sale and purchase requests
 */
router.get(
  '/',
  validate(schema.list),
  asyncHandler(async (req, res) =>
    success(res, await carService.list({ user: req.user, access: req.access, filters: req.query }))
  )
);

/**
 * @openapi
 * /cars/mine:
 *   get:
 *     tags: [Car]
 *     summary: The agency's own advertisements, and its sub-agencies'
 */
router.get(
  '/mine',
  validate(schema.own),
  asyncHandler(async (req, res) =>
    success(res, await carService.listOwn({ user: req.user, filters: req.query }))
  )
);

/**
 * @openapi
 * /cars:
 *   post:
 *     tags: [Car]
 *     summary: Post a car for sale, or ask for one
 */
router.post(
  '/',
  requireActiveSubscription,
  validate(schema.create),
  asyncHandler(async (req, res) => {
    const row = await carService.create({ user: req.user, payload: req.body });
    return created(res, row, MESSAGES.LISTING.CREATED);
  })
);

/**
 * @openapi
 * /cars/{id}/photos:
 *   post:
 *     tags: [Car]
 *     summary: Attach photos to a sale advertisement (owner only, six total)
 */
router.post(
  `/${ID}/photos`,
  requireActiveSubscription,
  upload.array('photos', MAX_FILES),
  discardOnFailure,
  validate(schema.byId),
  asyncHandler(async (req, res) =>
    success(
      res,
      await carService.addPhotos({ user: req.user, id: req.params.id, files: req.files }),
      MESSAGES.LISTING.UPDATED
    )
  )
);

/**
 * @openapi
 * /cars/photos/{photoId}:
 *   delete:
 *     tags: [Car]
 *     summary: Remove one photo (owner only)
 */
router.delete(
  '/photos/:photoId',
  validate({ params: Joi.object({ photoId: Joi.string().trim().max(40).required() }) }),
  asyncHandler(async (req, res) =>
    success(res, await carService.removePhoto({ user: req.user, photoId: req.params.photoId }))
  )
);

/**
 * @openapi
 * /cars/{id}:
 *   get:
 *     tags: [Car]
 *     summary: One advertisement, masked unless its contact was revealed
 */
router.get(
  `/${ID}`,
  validate(schema.byId),
  asyncHandler(async (req, res) =>
    success(res, await carService.getById({ user: req.user, access: req.access, id: req.params.id }))
  )
);

/**
 * @openapi
 * /cars/{id}:
 *   patch:
 *     tags: [Car]
 *     summary: Edit an advertisement that is still live
 */
router.patch(
  `/${ID}`,
  requireActiveSubscription,
  validate(schema.update),
  asyncHandler(async (req, res) =>
    success(
      res,
      await carService.update({ user: req.user, id: req.params.id, payload: req.body }),
      MESSAGES.LISTING.UPDATED
    )
  )
);

/**
 * @openapi
 * /cars/{id}/renew:
 *   post:
 *     tags: [Car]
 *     summary: Give it a fresh week
 */
router.post(
  `/${ID}/renew`,
  requireActiveSubscription,
  validate(schema.byId),
  asyncHandler(async (req, res) =>
    success(res, await carService.renew({ user: req.user, id: req.params.id }), MESSAGES.LISTING.RENEWED)
  )
);

/**
 * @openapi
 * /cars/{id}/fulfill:
 *   post:
 *     tags: [Car]
 *     summary: Mark it sold, which closes the advertisement
 */
router.post(
  `/${ID}/fulfill`,
  validate(schema.byId),
  asyncHandler(async (req, res) =>
    success(
      res,
      await carService.markFulfilled({ user: req.user, id: req.params.id }),
      MESSAGES.LISTING.FULFILLED
    )
  )
);

/**
 * @openapi
 * /cars/{id}:
 *   delete:
 *     tags: [Car]
 *     summary: Take it out of the market — the row and its history stay
 */
router.delete(
  `/${ID}`,
  validate(schema.byId),
  asyncHandler(async (req, res) =>
    success(res, await carService.remove({ user: req.user, id: req.params.id }), MESSAGES.LISTING.DELETED)
  )
);

/**
 * @openapi
 * /cars/{id}/reveal:
 *   post:
 *     tags: [Car]
 *     summary: Spend one view on the advertiser's contact details
 *     description: >
 *       The allowance is the account's single one, shared with the other
 *       markets — one subscription, one budget. The reveal also unlocks the
 *       photos and the description on this advertisement.
 */
router.post(
  `/${ID}/reveal`,
  requireActiveSubscription,
  validate(schema.byId),
  asyncHandler(async (req, res) =>
    success(
      res,
      await carService.reveal({ user: req.user, access: req.access, id: req.params.id, ip: req.ip }),
      MESSAGES.LISTING.REVEALED
    )
  )
);

module.exports = router;
