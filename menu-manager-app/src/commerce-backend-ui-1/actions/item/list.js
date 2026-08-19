const { getRepository } = require('../../repository');
const { ok, fromError, requireParams } = require('../../lib/http');
const { requireAdmin } = require('../../lib/auth');
const { build } = require('../../lib/logger');
const { assembleTree } = require('../../domain/tree');

async function main (params) {
  const logger = build('item-list', params);
  try {
    requireAdmin(params);
    requireParams(params, ['menuId']);
    const { repo } = await getRepository({ params, logger });
    const items = await repo.listItems(params.menuId);
    const { tree, orphaned } = assembleTree(items);
    return ok({ items, tree, orphaned, total: items.length });
  } catch (e) { return fromError(e, logger); }
}
exports.main = main;
