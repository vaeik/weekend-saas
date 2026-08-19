/**
 * Repository factory. The data layer is behind this one seam so switching
 * Database <-> State is a config change, not a refactor (plan §2).
 */
const { DbMenuRepository } = require('./db-repository');
const { MenuCache } = require('./cache');

let cached = null;

async function getRepository ({ params = {}, logger = null, clients = null } = {}) {
  if (clients) {
    return {
      repo: new DbMenuRepository(clients.db),
      cache: new MenuCache(clients.state, { logger })
    };
  }
  if (cached) return cached;

  const backend = params.MENU_REPOSITORY || process.env.MENU_REPOSITORY || 'db';
  if (backend !== 'db') {
    throw new Error(
      `MENU_REPOSITORY='${backend}' is not implemented. Only 'db' ships today; ` +
      'a State-backed implementation would go here behind the same interface.'
    );
  }

  const dbLib = require('@adobe/aio-lib-db');
  const stateLib = require('@adobe/aio-lib-state');
  const { getServiceToken, resolveNamespace } = require('../lib/ims-token');

  const state = await stateLib.init();

  // aio-lib-db needs THREE things, not one: region, the runtime namespace, and
  // an IMS access token. `init({ region })` throws "Runtime namespace is
  // required". The token is minted from the workspace's OAuth S2S credential and
  // cached in State — see lib/ims-token.js for why it cannot be borrowed from
  // the caller.
  const region = params.AIO_DB_REGION || process.env.AIO_DB_REGION || 'emea';
  const namespace = resolveNamespace(params);
  if (!namespace) {
    throw new Error(
      'Runtime namespace unavailable. Inside an action it comes from __OW_NAMESPACE; '
      + 'locally it comes from AIO_runtime_namespace in .env (run `aio app use -g`).'
    );
  }
  const token = await getServiceToken({ params, state, logger });
  const base = await dbLib.init({ ow: { namespace }, region, token });
  // DbBase -> DbClient. DbMenuRepository expects a CONNECTED client, because
  // collection() only exists after connect().
  const db = await base.connect();

  const ttl = Number(params.MENU_CACHE_TTL_SECONDS || process.env.MENU_CACHE_TTL_SECONDS || 86400);
  cached = { repo: new DbMenuRepository(db), cache: new MenuCache(state, { ttl, logger }) };
  return cached;
}

module.exports = { getRepository, _reset: () => { cached = null; } };
