const { getRepository } = require('../../repository');
const { ok, err, fromError, requireParams } = require('../../lib/http');
const { requireAdmin } = require('../../lib/auth');
const { build } = require('../../lib/logger');

async function main (params) {
  const logger = build('menu-delete', params);
  try {
    requireAdmin(params);
    requireParams(params, ['id']);
    const { repo, cache } = await getRepository({ params, logger });
    const menu = await repo.getMenu(params.id);
    if (!menu) return err(404, `Menu ${params.id} not found`);
    const result = await repo.deleteMenu(menu.id);
    await cache.invalidate(menu.identifier, menu.storeCodes);
    logger.info(`deleted menu ${menu.id} and ${result.deletedItems} item(s)`);
    return ok({ deleted: true, ...result });
  } catch (e) { return fromError(e, logger); }
}
exports.main = main;
