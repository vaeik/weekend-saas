/**
 * Storefront read path. Called by API Mesh, which exposes it as
 * `scandiwebMenu(identifier: String!, maxLevel: Int)` — the same signature the
 * legacy Magento GraphQL resolver had, so the storefront contract is preserved.
 *
 * Returns a FLAT item array (plan §3): API Mesh caps queryConfig.maxDepth at 6
 * and a recursive `children` selection burns ~2 levels per menu tier. The EDS
 * header block reassembles the tree client-side from parent_id + level.
 */
const { getRepository } = require('../../repository');
const { ok, err, fromError, requireParams } = require('../../lib/http');
const { requireSharedSecret } = require('../../lib/auth');
const { build } = require('../../lib/logger');
const { flattenForStorefront } = require('../../domain/tree');

const MAX_LEVEL = 4;
const CACHE_CONTROL = 'public, max-age=600';

async function main (params) {
  const logger = build('storefront-menu-get', params);
  try {
    requireSharedSecret(params);
    requireParams(params, ['identifier']);

    const identifier = String(params.identifier);
    const storeCode = params.storeCode || 'default';
    const maxLevel = Math.min(Number(params.maxLevel) || MAX_LEVEL, MAX_LEVEL);

    const { repo, cache } = await getRepository({ params, logger });

    // maxLevel varies per caller, so it is part of nothing — the cache always
    // stores the FULL menu and we trim on read. Otherwise one cache key would
    // serve two different depths.
    const cached = await cache.get(identifier, storeCode);
    if (cached) {
      return { ...ok(trim(cached, maxLevel)), headers: headers() };
    }

    const menu = await repo.getMenuByIdentifier(identifier);
    if (!menu) return err(404, `Menu '${identifier}' not found`);
    if (menu.isActive === false) return err(404, `Menu '${identifier}' is not active`);
    if (menu.storeCodes?.length && !menu.storeCodes.includes(storeCode)) {
      return err(404, `Menu '${identifier}' is not assigned to store '${storeCode}'`);
    }

    const items = await repo.listItems(menu.id);
    const payload = flattenForStorefront(menu, items, { maxLevel: MAX_LEVEL });

    await cache.put(identifier, storeCode, payload);
    return { ...ok(trim(payload, maxLevel)), headers: headers() };
  } catch (e) { return fromError(e, logger); }
}

const trim = (payload, maxLevel) => ({
  ...payload,
  items: payload.items.filter((i) => i.level <= maxLevel)
});

const headers = () => ({ 'Content-Type': 'application/json', 'Cache-Control': CACHE_CONTROL });

exports.main = main;
exports.trim = trim;
