const { getRepository } = require('../../repository');
const { ok, err, fromError, requireParams } = require('../../lib/http');
const { requireAdmin } = require('../../lib/auth');
const { build } = require('../../lib/logger');
const { reorder } = require('../../domain/tree');

/** Max nesting depth. Mirrors the legacy resolver's MAX_CATEGORY_LEVEL = 4. */
const MAX_LEVEL = 4;

async function main (params) {
  const logger = build('item-reorder', params);
  try {
    requireAdmin(params);
    requireParams(params, ['itemId']);
    const { repo, cache } = await getRepository({ params, logger });

    const item = await repo.getItem(params.itemId);
    if (!item) return err(404, `Item ${params.itemId} not found`);
    const menu = await repo.getMenu(item.menuId);
    const items = await repo.listItems(item.menuId);

    const { updates } = reorder(items, {
      itemId: params.itemId,
      newParentId: params.parentId ?? null,
      newPosition: params.position ?? 0,
      maxLevel: Number(params.maxLevel) || MAX_LEVEL
    });

    const result = await repo.applyReorder(updates);
    if (menu) await cache.invalidate(menu.identifier, menu.storeCodes);
    return ok({ ...result, updates });
  } catch (e) { return fromError(e, logger); }
}
exports.main = main;
