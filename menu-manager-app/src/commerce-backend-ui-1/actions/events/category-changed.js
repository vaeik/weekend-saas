/**
 * Replaces the two Magento observers:
 *   catalog_category_delete_after -> Observer/DeleteCategoryItem  (ACTIVE today)
 *   catalog_category_save_after   -> Observer/UpdateCategoryItem  (DISABLED today)
 *
 * Subscribe on ACCS via System > Events > Events Subscriptions, or
 * POST /V1/eventing/eventSubscribe. Verify names against
 * GET /V1/eventing/supportedList on the tenant before relying on them.
 *
 * DELIVERY REALITY (verified): Adobe I/O Events are at-least-once, duplicates
 * are expected, ORDER IS NOT GUARANTEED, retries stop after 24h and there is NO
 * dead-letter queue. So this handler is idempotent, dedupes on event id, and is
 * backed by a nightly reconciliation sweep for anything dropped past 24h.
 *
 * Q1 IN THE PLAN: catalog_category_save_after is disabled="true" in the current
 * events.xml. SYNC_ON_SAVE below defaults to false to preserve today's live
 * behaviour exactly. Flip it only once the client confirms that is wanted.
 */
const { getRepository } = require('../../repository');
const { build } = require('../../lib/logger');

const SYNC_ON_SAVE = false;
const DEDUPE_TTL = 172800; // 48h — twice the 24h retry window

const DELETE_EVENTS = ['observer.catalog_category_delete_after'];
const SAVE_EVENTS = ['observer.catalog_category_save_after'];

async function main (params) {
  const logger = build('event-category-changed', params);
  try {
    const eventType = params.type || params.event_type || params.data?.type;
    const eventId = params.event_id || params.id || null;
    const payload = params.data?.value || params.data || params.value || {};
    const categoryId = payload.entity_id ?? payload.category_id ?? payload.id ?? null;

    if (categoryId === null) {
      logger.warn('event carried no category id; ignoring');
      return { statusCode: 200, body: { skipped: 'no category id' } };
    }

    const { repo, cache } = await getRepository({ params, logger });

    if (eventId && cache.state) {
      const seenKey = `evt:${eventId}`;
      const seen = await cache.state.get(seenKey).catch(() => null);
      if (seen?.value) {
        logger.info(`duplicate event ${eventId}; skipping`);
        return { statusCode: 200, body: { deduped: true } };
      }
      await cache.state.put(seenKey, '1', { ttl: DEDUPE_TTL }).catch(() => {});
    }

    const items = await repo.findItemsByCategory(categoryId);
    if (!items.length) {
      return { statusCode: 200, body: { categoryId, affected: 0 } };
    }
    const ids = items.map((i) => i.id);

    let action = 'none';
    if (DELETE_EVENTS.includes(eventType)) {
      // Legacy parity: DeleteCategoryItem set is_active = 0. It did NOT delete
      // the menu item, so the admin could re-point it at another category.
      await repo.setItemsActive(ids, false);
      action = 'deactivated';
    } else if (SAVE_EVENTS.includes(eventType)) {
      await repo.updateCategorySnapshot(ids, {
        urlKey: payload.url_key ?? null,
        name: payload.name ?? null,
        isActive: payload.is_active ?? null,
        includeInMenu: payload.include_in_menu ?? null
      });
      action = 'snapshot-refreshed';
      if (SYNC_ON_SAVE) {
        await repo.setItemsActive(ids, payload.is_active !== false && payload.is_active !== 0);
        action = 'snapshot-refreshed+status-synced';
      }
    } else {
      logger.warn(`unhandled event type '${eventType}'`);
      return { statusCode: 200, body: { skipped: eventType } };
    }

    const menuIds = [...new Set(items.map((i) => i.menuId))];
    for (const menuId of menuIds) {
      const menu = await repo.getMenu(menuId);
      if (menu) await cache.invalidate(menu.identifier, menu.storeCodes);
    }

    logger.info(`category ${categoryId}: ${action} on ${ids.length} item(s) across ${menuIds.length} menu(s)`);
    return { statusCode: 200, body: { categoryId, action, affected: ids.length, menus: menuIds.length } };
  } catch (e) {
    // Return 500 so Adobe retries (429 and 5xx are the only retried codes).
    logger.error(`event handling failed: ${e.message}`);
    return { statusCode: 500, body: { error: e.message } };
  }
}
exports.main = main;
exports.SYNC_ON_SAVE = SYNC_ON_SAVE;
