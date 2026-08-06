const { ValidationError } = require('../errors/AppError');
const messages = require('../validators/messages');

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
        // Persian for every schema at once. A schema that forgets to translate
        // itself is the normal case, so the default has to be the right one.
        // Any schema that sets its own .messages() still wins — Joi prefers
        // the more specific definition.
        messages,
        // Drops the «"username" » prefix Joi puts on each sentence. The field
        // is already reported separately as `field`, and the interface uses
        // that to point at the input; repeating it inside a Persian sentence
        // in Latin script only makes the sentence harder to read.
        errors: { wrap: { label: false } },
      });

      if (error) {
        // Persian, because this reaches the user. The details underneath are
        // Joi's own wording and stay as they are — they name the field, which
        // is what makes a long form fixable.
        return next(
          new ValidationError(
            'اطلاعات وارد شده کامل یا معتبر نیست',
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
