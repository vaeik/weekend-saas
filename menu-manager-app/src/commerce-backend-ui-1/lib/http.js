/** Uniform action responses. Keeps every action's return shape identical. */
const ok = (body, statusCode = 200) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body
});

const err = (statusCode, message, extra = {}) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: { error: message, ...extra }
});

/** Maps domain error codes to HTTP without leaking internals to the client. */
function fromError (e, logger = null) {
  logger?.error(`${e.code || 'ERROR'}: ${e.message}`);
  switch (e.code) {
    case 'VALIDATION': return err(400, e.message, { fields: e.errors });
    case 'CYCLE':
    case 'MAX_LEVEL': return err(409, e.message);
    case 'NOT_FOUND': return err(404, e.message);
    case 'UNAUTHORIZED': return err(401, 'Unauthorized');
    case 'FORBIDDEN': return err(403, 'Forbidden');
    default: return err(500, 'Internal server error');
  }
}

/** Rejects a request missing required params before any I/O happens. */
function requireParams (params, names) {
  const missing = names.filter((n) => params[n] === undefined || params[n] === null || params[n] === '');
  if (missing.length) {
    const e = new Error(`Missing required parameter(s): ${missing.join(', ')}`);
    e.code = 'VALIDATION';
    e.errors = missing.map((f) => ({ field: f, message: 'is required' }));
    throw e;
  }
}

module.exports = { ok, err, fromError, requireParams };
