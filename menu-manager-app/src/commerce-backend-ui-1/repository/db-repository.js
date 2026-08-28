/**
 * System of record: App Builder Database (@adobe/aio-lib-db).
 *
 * Chosen over State per plan §2 / finding F1 — Database has no TTL (State caps
 * at 365 days), real secondary indexes, and 16MB documents. Menus are permanent
 * business data, so a store with a mandatory expiry was the wrong shape.
 *
 * The db client is INJECTED so every method is unit-testable without Adobe
 * credentials. repository/index.js does the real init().
 */
const { computeLevels } = require('../domain/tree');

/**
 * Real App Builder Database THROWS `Document not found` when findOne matches
 * nothing, where a Mongo driver returns null. Found by scripts/smoke.js, not by
 * the unit tests — the in-memory fake returned null, so every "does this exist?"
 * check in the app looked fine and would have thrown in production:
 *   - menu-save's duplicate-identifier check -> 500 on every new menu
 *   - storefront-menu-get -> 500 instead of 404 for an unknown menu
 * Normalised here, once, so callers can rely on null meaning "absent".
 */
async function findOneOrNull (collection, filter) {
  try {
    return await collection.findOne(filter);
  } catch (err) {
    if (/document not found/i.test(err?.message || '')) return null;
    throw err;
  }
}

const MENUS = 'menus';
const ITEMS = 'menuItems';

class DbMenuRepository {
  constructor (db, { now = () => new Date().toISOString() } = {}) {
    this.db = db;
    this.now = now;
  }

  _menus () { return this.db.collection(MENUS); }
  _items () { return this.db.collection(ITEMS); }

  // ---------------------------------------------------------------- menus

  async listMenus ({ page = 1, pageSize = 20, search = '', isActive = null, storeCode = null } = {}) {
    const filter = {};
    if (search) {
      // Anchored, escaped — an unescaped user string here is a ReDoS vector.
      const safe = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { title: { $regex: safe, $options: 'i' } },
        { identifier: { $regex: safe, $options: 'i' } }
      ];
    }
    if (isActive !== null) filter.isActive = isActive;
    if (storeCode) filter.storeCodes = storeCode;

    const skip = Math.max(0, (Number(page) - 1) * Number(pageSize));
    const [docs, total] = await Promise.all([
      this._menus().find(filter).sort({ title: 1 }).skip(skip).limit(Number(pageSize)).toArray(),
      this._menus().countDocuments(filter)
    ]);
    return { items: docs.map(toMenu), total, page: Number(page), pageSize: Number(pageSize) };
  }

  async getMenu (id) {
    const doc = await findOneOrNull(this._menus(), { _id: id });
    return doc ? toMenu(doc) : null;
  }

  async getMenuByIdentifier (identifier) {
    const doc = await findOneOrNull(this._menus(), { identifier });
    return doc ? toMenu(doc) : null;
  }

  async saveMenu (menu, { actor = null } = {}) {
    const id = menu.id || newId('menu');
    const doc = {
      _id: id,
      identifier: menu.identifier,
      title: menu.title,
      cssClass: menu.cssClass || null,
      isActive: menu.isActive !== false,
      storeCodes: menu.storeCodes || [],
      updatedAt: this.now(),
      updatedBy: actor
    };
    if (!menu.id) doc.createdAt = this.now();
    await this._menus().replaceOne({ _id: id }, doc, { upsert: true });
    return toMenu(doc);
  }

  /**
   * Reimplements the ON DELETE CASCADE that scandiweb_menumanager_item had on
   * menu_id. There are no foreign keys on ACCS — deleting the menu without this
   * would orphan every item row silently.
   */
  async deleteMenu (id) {
    const items = await this._items().deleteMany({ menuId: id });
    await this._menus().deleteOne({ _id: id });
    return { deletedItems: items?.deletedCount ?? 0 };
  }

  // ---------------------------------------------------------------- items

  async listItems (menuId) {
    const docs = await this._items().find({ menuId }).toArray();
    return docs.map(toItem);
  }

  async getItem (id) {
    const doc = await findOneOrNull(this._items(), { _id: id });
    return doc ? toItem(doc) : null;
  }

  async saveItem (item, { actor = null } = {}) {
    const id = item.id || newId('item');
    const siblings = await this.listItems(item.menuId);
    const levels = computeLevels([...siblings.filter((s) => s.id !== id), { ...item, id }]);

    const doc = {
      _id: id,
      menuId: item.menuId,
      parentId: item.parentId ?? null,
      title: item.title,
      itemClass: item.itemClass ?? '',
      identifier: item.identifier ?? '',
      url: item.url ?? null,
      openType: item.openType ?? 0,
      urlType: item.urlType ?? 0,
      cmsPageId: item.cmsPageId ?? null,
      categoryId: item.categoryId ?? null,
      position: item.position ?? 0,
      isActive: item.isActive !== false,
      urlAttributes: item.urlAttributes ?? null,
      icon: item.icon ?? null,
      iconAlt: item.iconAlt ?? null,
      advertisement: item.advertisement ?? null,
      advertisementLink: item.advertisementLink ?? null,
      advertisementSecond: item.advertisementSecond ?? null,
      advertisementSecondLink: item.advertisementSecondLink ?? null,
      promoImage: item.promoImage ?? null,
      isPromo: item.isPromo ?? false,
      isWithCmsBlock: item.isWithCmsBlock ?? false,
      customRedirect: item.customRedirect ?? null,
      level: levels.get(String(id)) ?? 1,
      categorySnapshot: item.categorySnapshot ?? null,
      legacyId: item.legacyId ?? null,
      updatedAt: this.now(),
      updatedBy: actor
    };
    await this._items().replaceOne({ _id: id }, doc, { upsert: true });
    return toItem(doc);
  }

  /** Deletes an item and its entire subtree (legacy self-referencing CASCADE). */
  async deleteItem (id) {
    const item = await this.getItem(id);
    if (!item) return { deleted: 0 };
    const all = await this.listItems(item.menuId);
    const { descendantIds } = require('../domain/tree');
    const ids = [String(id), ...descendantIds(all, id)];
    const res = await this._items().deleteMany({ _id: { $in: ids } });
    return { deleted: res?.deletedCount ?? ids.length, ids };
  }

  async applyReorder (updates) {
    for (const u of updates) {
      await this._items().updateOne(
        { _id: u.id },
        { $set: { parentId: u.parentId, position: u.position, level: u.level, updatedAt: this.now() } }
      );
    }
    return { updated: updates.length };
  }

  // -------------------------------------------------- category reconciliation

  async findItemsByCategory (categoryId) {
    const docs = await this._items().find({ categoryId: Number(categoryId) }).toArray();
    return docs.map(toItem);
  }

  async setItemsActive (ids, isActive) {
    if (!ids.length) return { updated: 0 };
    const res = await this._items().updateMany(
      { _id: { $in: ids.map(String) } },
      { $set: { isActive, updatedAt: this.now() } }
    );
    return { updated: res?.modifiedCount ?? ids.length };
  }

  async updateCategorySnapshot (ids, snapshot) {
    if (!ids.length) return { updated: 0 };
    const res = await this._items().updateMany(
      { _id: { $in: ids.map(String) } },
      { $set: { categorySnapshot: { ...snapshot, syncedAt: this.now() }, updatedAt: this.now() } }
    );
    return { updated: res?.modifiedCount ?? ids.length };
  }
}

function newId (prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

const toMenu = (d) => ({
  id: d._id,
  identifier: d.identifier,
  title: d.title,
  cssClass: d.cssClass ?? null,
  isActive: d.isActive !== false,
  storeCodes: d.storeCodes || [],
  createdAt: d.createdAt ?? null,
  updatedAt: d.updatedAt ?? null,
  updatedBy: d.updatedBy ?? null
});

const toItem = (d) => {
  const { _id, ...rest } = d;
  return { id: _id, ...rest };
};

module.exports = { DbMenuRepository, MENUS, ITEMS, toMenu, toItem, newId, findOneOrNull };
