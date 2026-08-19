const { getRepository } = require('../../repository');
const { ok, err, fromError, requireParams } = require('../../lib/http');
const { requireAdmin } = require('../../lib/auth');
const { build } = require('../../lib/logger');

async function main (params) {
  const logger = build('item-delete', params);
  try {
    requireAdmin(params);
    requireParams(params, ['id']);
    const { repo, cache } = await getRepository({ params, logger });
    const item = await repo.getItem(params.id);
    if (!item) return err(404, `Item ${params.id} not found`);
    const menu = await repo.getMenu(item.menuId);
    const result = await repo.deleteItem(item.id);
    if (menu) await cache.invalidate(menu.identifier, menu.storeCodes);
    logger.info(`deleted item ${item.id} and subtree (${result.deleted} row(s))`);
    return ok({ deleted: true, ...result });
  } catch (e) { return fromError(e, logger); }
}
exports.main = main;
