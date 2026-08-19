const { getRepository } = require('../../repository');
const { ok, err, fromError } = require('../../lib/http');
const { requireAdmin } = require('../../lib/auth');
const { build } = require('../../lib/logger');
const { validateItem } = require('../../domain/schema');
const { descendantIds } = require('../../domain/tree');

async function main (params) {
  const logger = build('item-save', params);
  try {
    const { userId } = requireAdmin(params);
    const input = validateItem(params.item || params);
    const id = params.id || params.item?.id || null;

    const { repo, cache } = await getRepository({ params, logger });
    const menu = await repo.getMenu(input.menuId);
    if (!menu) return err(404, `Menu ${input.menuId} not found`);

    if (input.parentId !== null && id) {
      // Editing an item's parent through the form can create the same cycle
      // the drag-and-drop path guards against, so guard it here too.
      const siblings = await repo.listItems(input.menuId);
      if (String(input.parentId) === String(id) || descendantIds(siblings, id).has(String(input.parentId))) {
        return err(409, 'Cannot set a parent that is the item itself or one of its descendants');
      }
    }

    const saved = await repo.saveItem({ ...input, id }, { actor: userId });
    await cache.invalidate(menu.identifier, menu.storeCodes);
    return ok({ item: saved });
  } catch (e) { return fromError(e, logger); }
}
exports.main = main;
