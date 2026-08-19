const { DbMenuRepository } = require('../src/commerce-backend-ui-1/repository/db-repository');
const { MenuCache } = require('../src/commerce-backend-ui-1/repository/cache');
const { FakeDb, FakeState } = require('./fake-db');

const mkRepo = () => new DbMenuRepository(new FakeDb(), { now: () => '2026-08-18T00:00:00.000Z' });

describe('DbMenuRepository — menus', () => {
  test('saves, reads back and finds by identifier', async () => {
    const repo = mkRepo();
    const saved = await repo.saveMenu({ identifier: 'main', title: 'Main', storeCodes: ['lv'] }, { actor: 'u1' });
    expect(saved.id).toMatch(/^menu_/);
    expect((await repo.getMenu(saved.id)).title).toBe('Main');
    expect((await repo.getMenuByIdentifier('main')).id).toBe(saved.id);
    expect((await repo.getMenu(saved.id)).updatedBy).toBe('u1');
  });

  test('paginates and reports the unpaginated total', async () => {
    const repo = mkRepo();
    for (let i = 0; i < 7; i++) await repo.saveMenu({ identifier: `m${i}`, title: `Menu ${i}` });
    const page = await repo.listMenus({ page: 2, pageSize: 3 });
    expect(page.items).toHaveLength(3);
    expect(page.total).toBe(7);
  });

  test('filters by store code', async () => {
    const repo = mkRepo();
    await repo.saveMenu({ identifier: 'lv', title: 'LV', storeCodes: ['lv'] });
    await repo.saveMenu({ identifier: 'en', title: 'EN', storeCodes: ['en'] });
    const res = await repo.listMenus({ storeCode: 'lv' });
    expect(res.items.map((m) => m.identifier)).toEqual(['lv']);
  });

  test('search does not blow up on regex metacharacters', async () => {
    const repo = mkRepo();
    await repo.saveMenu({ identifier: 'main', title: 'Main' });
    await expect(repo.listMenus({ search: 'a(b[c' })).resolves.toMatchObject({ total: 0 });
  });

  test('deleting a menu cascades to its items (no FK on ACCS)', async () => {
    const repo = mkRepo();
    const menu = await repo.saveMenu({ identifier: 'main', title: 'Main' });
    await repo.saveItem({ menuId: menu.id, title: 'A' });
    await repo.saveItem({ menuId: menu.id, title: 'B' });
    const res = await repo.deleteMenu(menu.id);
    expect(res.deletedItems).toBe(2);
    expect(await repo.getMenu(menu.id)).toBeNull();
    expect(await repo.listItems(menu.id)).toEqual([]);
  });
});

describe('DbMenuRepository — items', () => {
  test('computes level on save from the real tree depth', async () => {
    const repo = mkRepo();
    const menu = await repo.saveMenu({ identifier: 'main', title: 'Main' });
    const root = await repo.saveItem({ menuId: menu.id, title: 'Men' });
    const child = await repo.saveItem({ menuId: menu.id, title: 'Shoes', parentId: root.id });
    const grand = await repo.saveItem({ menuId: menu.id, title: 'Sneakers', parentId: child.id });
    expect(root.level).toBe(1);
    expect(child.level).toBe(2);
    expect(grand.level).toBe(3);
  });

  test('deleting an item removes its whole subtree', async () => {
    const repo = mkRepo();
    const menu = await repo.saveMenu({ identifier: 'main', title: 'Main' });
    const root = await repo.saveItem({ menuId: menu.id, title: 'Men' });
    const child = await repo.saveItem({ menuId: menu.id, title: 'Shoes', parentId: root.id });
    await repo.saveItem({ menuId: menu.id, title: 'Sneakers', parentId: child.id });
    const res = await repo.deleteItem(root.id);
    expect(res.deleted).toBe(3);
    expect(await repo.listItems(menu.id)).toEqual([]);
  });

  test('findItemsByCategory + setItemsActive reproduce the delete observer', async () => {
    const repo = mkRepo();
    const menu = await repo.saveMenu({ identifier: 'main', title: 'Main' });
    const a = await repo.saveItem({ menuId: menu.id, title: 'Cat 42', categoryId: 42 });
    await repo.saveItem({ menuId: menu.id, title: 'Cat 43', categoryId: 43 });
    const hits = await repo.findItemsByCategory(42);
    expect(hits.map((i) => i.id)).toEqual([a.id]);
    await repo.setItemsActive(hits.map((i) => i.id), false);
    expect((await repo.getItem(a.id)).isActive).toBe(false);
  });

  test('updateCategorySnapshot stamps syncedAt', async () => {
    const repo = mkRepo();
    const menu = await repo.saveMenu({ identifier: 'main', title: 'Main' });
    const it = await repo.saveItem({ menuId: menu.id, title: 'X', categoryId: 7 });
    await repo.updateCategorySnapshot([it.id], { urlKey: 'shoes', name: 'Shoes' });
    const after = await repo.getItem(it.id);
    expect(after.categorySnapshot).toMatchObject({ urlKey: 'shoes', syncedAt: '2026-08-18T00:00:00.000Z' });
  });
});

describe('MenuCache', () => {
  test('round-trips JSON and sets a TTL inside State limits', async () => {
    const state = new FakeState();
    const cache = new MenuCache(state, { ttl: 86400 });
    await cache.put('main', 'lv', { items: [1] });
    expect(await cache.get('main', 'lv')).toEqual({ items: [1] });
    expect(state.puts[0].opts.ttl).toBe(86400);
    expect(state.puts[0].opts.ttl).toBeLessThanOrEqual(31536000); // State max TTL, 365d
  });

  test('invalidates every store variant plus default', async () => {
    const state = new FakeState();
    const cache = new MenuCache(state);
    await cache.invalidate('main', ['lv', 'en']);
    expect(state.deletes.sort()).toEqual(['menu:main:default', 'menu:main:en', 'menu:main:lv']);
  });

  test('a cache failure degrades to a miss rather than throwing', async () => {
    const broken = { get: async () => { throw new Error('state down'); }, put: async () => { throw new Error('nope'); } };
    const cache = new MenuCache(broken, { logger: { warn: () => {} } });
    expect(await cache.get('main', 'lv')).toBeNull();
    expect(await cache.put('main', 'lv', {})).toBe(false);
  });
});

describe('findOne divergence — real DB throws where a Mongo driver returns null', () => {
  // Regression guard for the bug scripts/smoke.js caught. The real App Builder
  // Database throws "Document not found"; every absence check in the app relies
  // on getting null instead.
  test('getMenu returns null for a missing id', async () => {
    await expect(mkRepo().getMenu('nope')).resolves.toBeNull();
  });

  test('getMenuByIdentifier returns null for a missing identifier', async () => {
    await expect(mkRepo().getMenuByIdentifier('nope')).resolves.toBeNull();
  });

  test('getItem returns null for a missing id', async () => {
    await expect(mkRepo().getItem('nope')).resolves.toBeNull();
  });

  test('a duplicate-identifier check on a fresh identifier does NOT throw', async () => {
    // This is the exact path that would have 500'd on every new menu creation.
    const repo = mkRepo();
    await expect(repo.getMenuByIdentifier('brand-new')).resolves.toBeNull();
    await expect(repo.saveMenu({ identifier: 'brand-new', title: 'New' })).resolves.toBeTruthy();
  });

  test('a genuine database error is still propagated, not swallowed as null', async () => {
    const repo = mkRepo();
    repo._menus = () => ({ findOne: async () => { throw new Error('connection reset'); } });
    await expect(repo.getMenu('x')).rejects.toThrow(/connection reset/);
  });

  test('deleteItem on a missing item is a clean no-op', async () => {
    await expect(mkRepo().deleteItem('nope')).resolves.toEqual({ deleted: 0 });
  });
});
