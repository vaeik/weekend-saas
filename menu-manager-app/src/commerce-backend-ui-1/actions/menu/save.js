const { getRepository } = require('../../repository');
const { ok, err, fromError } = require('../../lib/http');
const { requireAdmin } = require('../../lib/auth');
const { build } = require('../../lib/logger');
const { validateMenu } = require('../../domain/schema');

async function main (params) {
  const logger = build('menu-save', params);
  try {
    const { userId } = requireAdmin(params);
    const input = validateMenu(params.menu || params);
    const { repo, cache } = await getRepository({ params, logger });

    // `identifier` was a plain btree index in MySQL, not unique, but the
    // storefront looks menus up by it — two menus sharing one identifier makes
    // the storefront result non-deterministic. Enforce uniqueness here and via
    // the unique index created in hooks/post-app-deploy.js.
    const clash = await repo.getMenuByIdentifier(input.identifier);
    const id = params.id || params.menu?.id || null;
    if (clash && String(clash.id) !== String(id)) {
      return err(409, `Menu identifier '${input.identifier}' is already used by menu ${clash.id}`);
    }

    const before = id ? await repo.getMenu(id) : null;
    const saved = await repo.saveMenu({ ...input, id }, { actor: userId });

    await cache.invalidate(saved.identifier, saved.storeCodes);
    // An identifier rename must also drop the cache under the OLD identifier,
    // or the storefront keeps serving the menu at a name that no longer exists.
    if (before && before.identifier !== saved.identifier) {
      await cache.invalidate(before.identifier, before.storeCodes);
    }
    return ok({ menu: saved });
  } catch (e) { return fromError(e, logger); }
}
exports.main = main;
