/**
 * Auth guard for admin actions.
 *
 * Primary protection is `require-adobe-auth: true` in ext.config.yaml — Adobe
 * prefixes the action with a shared validator that checks the IMS token against
 * IMS and Adobe Exchange before our code runs. This module is the second layer:
 * it asserts the token actually arrived and exposes the caller identity for
 * audit fields (updatedBy).
 *
 * LIMITATION (plan R3): the Admin UI SDK V1 sharedContext carries only
 * `imsToken` and `imsOrgId` — no storeId, websiteId, storeCode, locale or admin
 * user id. Store scope must therefore be supplied explicitly by our own store
 * picker; it cannot be inferred from the request.
 */
const BEARER = /^Bearer\s+(.+)$/i;

function extractToken (params) {
  const headers = params.__ow_headers || {};
  const raw = headers.authorization || headers.Authorization;
  if (raw) {
    const m = BEARER.exec(raw);
    if (m) return m[1].trim();
  }
  if (params.imsToken) return String(params.imsToken);
  return null;
}

/** Decodes the JWT payload without verifying — verification is Adobe's job. */
function decodeClaims (token) {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch { return null; }
}

/**
 * @returns {{token: string, userId: string|null, imsOrgId: string|null}}
 * @throws {Error} code UNAUTHORIZED
 */
function requireAdmin (params) {
  const token = extractToken(params);
  if (!token) {
    const e = new Error('No IMS token on request');
    e.code = 'UNAUTHORIZED';
    throw e;
  }
  const claims = decodeClaims(token) || {};
  return {
    token,
    userId: claims.user_id || claims.sub || null,
    imsOrgId: params.imsOrgId || claims.org || null
  };
}

/**
 * Storefront actions are anonymous (the EDS storefront has no user), so they
 * are protected by a shared secret that only API Mesh knows.
 * Compared in constant time so the check cannot be probed byte by byte.
 */
function requireSharedSecret (params) {
  const expected = params.STOREFRONT_SHARED_SECRET;
  if (!expected) { const e = new Error('Shared secret not configured'); e.code = 'FORBIDDEN'; throw e; }
  const headers = params.__ow_headers || {};
  const got = headers['x-mm-secret'] || params.secret || '';
  const a = Buffer.from(String(got));
  const b = Buffer.from(String(expected));
  const equal = a.length === b.length && require('crypto').timingSafeEqual(a, b);
  if (!equal) { const e = new Error('Bad shared secret'); e.code = 'FORBIDDEN'; throw e; }
  return true;
}

module.exports = { requireAdmin, requireSharedSecret, extractToken, decodeClaims };
