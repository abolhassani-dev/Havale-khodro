const { ValidationError } = require('../errors/AppError');

/**
 * Runs a Joi schema against the request and replaces the raw input with the
 * validated value, so downstream code works with clean, typed data.
 *
 * `stripUnknown` drops fields nobody declared — that stops a client from
 * smuggling extra properties into a create or update call.
 */
function validate(schema) {
  return (req, _res, next) => {
    const targets = ['body', 'params', 'query'];

    for (const target of targets) {
      if (!schema[target]) continue;

      const { error, value } = schema[target].validate(req[target], {
        abortEarly: false,
        stripUnknown: true,
      });

      if (error) {
        return next(
          new ValidationError(
            'Validation failed',
            error.details.map((d) => ({ field: d.path.join('.'), message: d.message }))
          )
        );
      }

      req[target] = value;
    }

    return next();
  };
}

module.exports = validate;
