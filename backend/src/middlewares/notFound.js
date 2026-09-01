const { NotFoundError } = require('../errors/AppError');

function notFound(req, _res, next) {
  next(new NotFoundError(`مسیر ${req.method} ${req.originalUrl}`));
}

module.exports = notFound;
