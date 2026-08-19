const { getRepository } = require('../../repository');
const { ok, err, fromError, requireParams } = require('../../lib/http');
const { requireAdmin } = require('../../lib/auth');
const { build } = require('../../lib/logger');
const { assembleTree } = require('../../domain/tree');

async function main (params) {
  const logger = build('menu-get', params);
  try {
    requireAdmin(params);
    requireParams(params, ['id']);
    const { repo } = await getRepository({ params, logger });
    const menu = await repo.getMenu(params.id);
    if (!menu) return err(404, `Menu ${params.id} not found`);
    const items = await repo.listItems(menu.id);
    const { tree, orphaned } = assembleTree(items);
    if (orphaned.length) logger.warn(`menu ${menu.id} has ${orphaned.length} orphaned item(s): ${orphaned.join(',')}`);
    return ok({ menu, items, tree, orphaned });
  } catch (e) { return fromError(e, logger); }
}
exports.main = main;
