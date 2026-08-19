/**
 * Mints and caches an IMS OAuth Server-to-Server access token.
 *
 * WHY THIS EXISTS: @adobe/aio-lib-db's init() requires an IMS access token —
 * `init({ region })` alone throws. Inside a deployed action there is no ambient
 * service token: `require-adobe-auth` validates the CALLER's token, it does not
 * give the action one of its own. And two of our entry points have no caller
 * token at all (the event consumer and the anonymous storefront action), so
 * borrowing the admin's IMS token was never an option.
 *
 * Uses the plain OAuth 2.0 client_credentials grant rather than
 * @adobe/aio-lib-ims: that library's S2S plugin additionally requires
 * technical_account_id and technical_account_email, which the Console OAuth S2S
 * credential does not surface in the four env vars Adobe's own tooling asks for.
 */
const IMS_TOKEN_URL = process.env.IMS_TOKEN_URL || 'https://ims-na1.adobelogin.com/ims/token/v3';
const CACHE_KEY = 'ims:s2s:token';
/** Renew this many seconds early so an in-flight request never uses a token that expires mid-call. */
const SAFETY_WINDOW = 300;

const CRED_KEYS = [
  'IMS_OAUTH_S2S_CLIENT_ID',
  'IMS_OAUTH_S2S_CLIENT_SECRET',
  'IMS_OAUTH_S2S_ORG_ID',
  'IMS_OAUTH_S2S_SCOPES'
];

/**
 * Action `inputs` land in params; the deploy hook runs with process.env. Support both.
 * @returns {{creds: object, missing: string[]}}
 */
function readCredentials (params = {}) {
  const get = (k) => params[k] || process.env[k];
  const creds = {
    clientId: get(CRED_KEYS[0]),
    clientSecret: get(CRED_KEYS[1]),
    orgId: get(CRED_KEYS[2]),
    scopes: get(CRED_KEYS[3])
  };
  const missing = CRED_KEYS.filter((k) => !get(k));
  return { creds, missing };
}

/**
 * The Console credential page shows scopes as a JSON array; .env may hold that
 * array as a string, or a comma-separated list. IMS wants comma-separated.
 */
function parseScopes (raw) {
  if (!raw) return '';
  if (Array.isArray(raw)) return raw.join(',');
  const s = String(raw).trim();
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.join(',');
    } catch { /* fall through to the comma-separated reading */ }
  }
  // Fallback for a comma-separated list, or for a JSON array that failed to
  // parse (a truncated paste). Stripping brackets and quotes means a mangled
  // value still yields usable scope names rather than literal `["a"` garbage
  // that IMS rejects with an opaque 400.
  return s
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((x) => x.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
    .join(',');
}

/** @throws {Error} code IMS_CREDENTIALS | IMS_TOKEN */
async function mintToken (creds, fetchImpl) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    scope: parseScopes(creds.scopes)
  });

  const res = await fetchImpl(IMS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  if (!res.ok) {
    // Deliberately does not echo the response body — IMS error payloads can
    // contain the client_id, and action logs are not a secret store.
    const e = new Error(`IMS token request failed with HTTP ${res.status}`);
    e.code = 'IMS_TOKEN';
    throw e;
  }

  const json = await res.json();
  if (!json.access_token) {
    const e = new Error('IMS token response contained no access_token');
    e.code = 'IMS_TOKEN';
    throw e;
  }
  return { token: json.access_token, expiresIn: Number(json.expires_in) || 3600 };
}

/**
 * Get a service token, cached in State so we mint roughly once per day instead
 * of once per request. A cache failure degrades to minting, never to an error.
 *
 * @returns {Promise<string>} access token
 * @throws {Error} code IMS_CREDENTIALS when the four env vars are absent
 */
async function getServiceToken ({ params = {}, state = null, logger = null, fetchImpl } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  const { creds, missing } = readCredentials(params);

  if (missing.length) {
    const e = new Error(
      `Missing IMS Server-to-Server credentials: ${missing.join(', ')}. `
      + 'These come from the workspace OAuth Server-to-Server credential in '
      + 'Adobe Developer Console (see SETUP.md step 2).'
    );
    e.code = 'IMS_CREDENTIALS';
    throw e;
  }

  if (state) {
    try {
      const hit = await state.get(CACHE_KEY);
      if (hit?.value) return hit.value;
    } catch (err) {
      logger?.warn(`ims token cache read failed: ${err.message}`);
    }
  }

  const { token, expiresIn } = await mintToken(creds, doFetch);

  if (state) {
    try {
      const ttl = Math.max(60, expiresIn - SAFETY_WINDOW);
      await state.put(CACHE_KEY, token, { ttl });
    } catch (err) {
      logger?.warn(`ims token cache write failed: ${err.message}`);
    }
  }
  return token;
}

/**
 * Runtime namespace for aio-lib-db. Set automatically inside a deployed action;
 * for the deploy hook it comes from the aio-written .env.
 */
function resolveNamespace (params = {}) {
  return params.__OW_NAMESPACE
    || process.env.__OW_NAMESPACE
    || process.env.AIO_RUNTIME_NAMESPACE
    || process.env.AIO_runtime_namespace
    || null;
}

module.exports = {
  getServiceToken, readCredentials, parseScopes, mintToken, resolveNamespace,
  CRED_KEYS, CACHE_KEY, SAFETY_WINDOW
};
