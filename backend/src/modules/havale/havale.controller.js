const havaleService = require('./havale.service');
const asyncHandler = require('../../utils/asyncHandler');
const { success, created } = require('../../responses/apiResponse');
const { MESSAGES } = require('../../constants/messages');

const havaleController = {
  create: asyncHandler(async (req, res) => {
    const havale = await havaleService.create({ user: req.user, payload: req.body });
    return created(res, havale, MESSAGES.HAVALE.CREATED);
  }),

  list: asyncHandler(async (req, res) => {
    const result = await havaleService.list({
      user: req.user,
      access: req.access,
      filters: req.query,
    });
    return success(res, result);
  }),

  listOwn: asyncHandler(async (req, res) => {
    const result = await havaleService.listOwn({ user: req.user, filters: req.query });
    return success(res, result);
  }),

  getById: asyncHandler(async (req, res) => {
    const havale = await havaleService.getById({
      user: req.user,
      access: req.access,
      id: req.params.id,
    });
    return success(res, havale);
  }),

  update: asyncHandler(async (req, res) => {
    const havale = await havaleService.update({
      user: req.user,
      id: req.params.id,
      payload: req.body,
    });
    return success(res, havale, MESSAGES.HAVALE.UPDATED);
  }),

  renew: asyncHandler(async (req, res) => {
    const havale = await havaleService.renew({
      user: req.user,
      id: req.params.id,
      deliveryDays: req.body.deliveryDays,
      depositDays: req.body.depositDays,
    });
    return success(res, havale, MESSAGES.HAVALE.RENEWED);
  }),

  markFulfilled: asyncHandler(async (req, res) => {
    const havale = await havaleService.markFulfilled({ user: req.user, id: req.params.id });
    return success(res, havale, MESSAGES.HAVALE.FULFILLED);
  }),

  remove: asyncHandler(async (req, res) => {
    const result = await havaleService.remove({ user: req.user, id: req.params.id });
    return success(res, result, MESSAGES.HAVALE.DELETED);
  }),

  reveal: asyncHandler(async (req, res) => {
    const result = await havaleService.reveal({
      user: req.user,
      access: req.access,
      id: req.params.id,
      ip: req.ip,
    });
    return success(res, result, MESSAGES.LISTING.REVEALED);
  }),

  usage: asyncHandler(async (req, res) => {
    const usage = await havaleService.revealUsage({ user: req.user, access: req.access });
    return success(res, usage);
  }),
};

module.exports = havaleController;
