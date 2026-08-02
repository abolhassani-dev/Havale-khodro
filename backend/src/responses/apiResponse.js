/**
 * One response shape for the whole API.
 *
 * Consumers can rely on `success`, `data`, and `error` always being in the same
 * place, which means no endpoint-by-endpoint guesswork on the client.
 */

function success(res, data = null, message = null, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

function created(res, data, message = 'Created') {
  return success(res, data, message, 201);
}

function noContent(res) {
  return res.status(204).send();
}

function paginated(res, items, { page, limit, total }, message = null) {
  return res.status(200).json({
    success: true,
    message,
    data: items,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit) || 0,
      hasNext: page * limit < total,
    },
  });
}

function failure(res, { message, code, statusCode = 500, details = null, requestId = null }) {
  return res.status(statusCode).json({
    success: false,
    error: { code, message, details },
    requestId,
  });
}

module.exports = { success, created, noContent, paginated, failure };
