const { FakeDb, FakeState } = require('./fake-db');
const { DbMenuRepository } = require('../src/commerce-backend-ui-1/repository/db-repository');
const { MenuCache } = require('../src/commerce-backend-ui-1/repository/cache');

// Actions destructure `getRepository` at module load, so the module itself is
// mocked rather than spied on — a spy would be installed after the reference
// was already captured.
let db, state, repo, cache;
jest.mock('../src/commerce-backend-ui-1/repository', () => ({
  getRepository: async () => global.__mmClients,
  _reset: () => {}
}));

beforeEach(() => {
  db = new FakeDb();
  state = new FakeState();
  repo = new DbMenuRepository(db);
  cache = new MenuCache(state);
  global.__mmClients = { repo, cache };
});
afterEach(() => jest.restoreAllMocks());

// A syntactically valid unsigned JWT — the shared validator does real
// verification upstream; our guard only needs to read claims.
const jwt = (claims) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64')}.y`;
const AUTH = { __ow_headers: { authorization: `Bearer ${jwt({ user_id: 'admin@scandiweb.com' })}` } };

const menuSave = require('../src/commerce-backend-ui-1/actions/menu/save').main;
const menuList = require('../src/commerce-backend-ui-1/actions/menu/list').main;
const menuDelete = require('../src/commerce-backend-ui-1/actions/menu/delete').main;
const itemSave = require('../src/commerce-backend-ui-1/actions/item/save').main;
const itemReorder = require('../src/commerce-backend-ui-1/actions/item/reorder').main;
const storefront = require('../src/commerce-backend-ui-1/actions/storefront/menu-get').main;
const categoryChanged = require('../src/commerce-backend-ui-1/actions/events/category-changed').main;
const registration = require('../src/commerce-backend-ui-1/actions/registration/index').main;

describe('auth', () => {
  test('every admin action rejects a request with no IMS token', async () => {
    for (const act of [menuList, menuSave, menuDelete, itemSave, itemReorder]) {
      const res = await act({});
      expect(res.statusCode).toBe(401);
    }
  });
});

describe('registration', () => {
  test('registers exactly one menu item plus one section (platform hard limit)', () => {
    const { registration: reg } = registration().body;
    expect(reg.menuItems.filter((m) => !m.isSection)).toHaveLength(1);
    expect(reg.menuItems.filter((m) => m.isSection)).toHaveLength(1);
  });
});

describe('menu-save', () => {
  test('stores the menu and records the IMS user as actor', async () => {
    const res = await menuSave({ ...AUTH, menu: { identifier: 'main', title: 'Main' } });
    expect(res.statusCode).toBe(200);
    expect(res.body.menu.updatedBy).toBe('admin@scandiweb.com');
  });

  test('returns 400 with field detail on invalid input', async () => {
    const res = await menuSave({ ...AUTH, menu: { title: 'No identifier' } });
    expect(res.statusCode).toBe(400);
    expect(res.body.fields[0].field).toBe('identifier');
  });

  test('refuses a duplicate identifier', async () => {
    await menuSave({ ...AUTH, menu: { identifier: 'main', title: 'A' } });
    const res = await menuSave({ ...AUTH, menu: { identifier: 'main', title: 'B' } });
    expect(res.statusCode).toBe(409);
  });

  test('renaming an identifier invalidates the OLD cache key too', async () => {
    const created = await menuSave({ ...AUTH, menu: { identifier: 'old', title: 'M', storeCodes: ['lv'] } });
    state.deletes.length = 0;
    await menuSave({ ...AUTH, id: created.body.menu.id, menu: { identifier: 'new', title: 'M', storeCodes: ['lv'] } });
    expect(state.deletes).toEqual(expect.arrayContaining(['menu:old:lv', 'menu:new:lv']));
  });
});

describe('item-reorder', () => {
  test('rejects a cycle with 409 rather than corrupting the tree', async () => {
    const menu = (await menuSave({ ...AUTH, menu: { identifier: 'main', title: 'M' } })).body.menu;
    const root = (await itemSave({ ...AUTH, item: { menuId: menu.id, title: 'Men', url: '/men' } })).body.item;
    const child = (await itemSave({ ...AUTH, item: { menuId: menu.id, title: 'Shoes', url: '/s', parentId: root.id } })).body.item;
    const res = await itemReorder({ ...AUTH, itemId: root.id, parentId: child.id });
    expect(res.statusCode).toBe(409);
    expect((await repo.getItem(root.id)).parentId).toBeNull();
  });

  test('persists new positions and levels', async () => {
    const menu = (await menuSave({ ...AUTH, menu: { identifier: 'main', title: 'M' } })).body.menu;
    const a = (await itemSave({ ...AUTH, item: { menuId: menu.id, title: 'A', url: '/a', position: 0 } })).body.item;
    const b = (await itemSave({ ...AUTH, item: { menuId: menu.id, title: 'B', url: '/b', position: 1 } })).body.item;
    const res = await itemReorder({ ...AUTH, itemId: b.id, parentId: null, position: 0 });
    expect(res.statusCode).toBe(200);
    expect((await repo.getItem(b.id)).position).toBe(0);
    expect((await repo.getItem(a.id)).position).toBe(1);
  });
});

describe('item-save', () => {
  test('blocks setting a descendant as parent', async () => {
    const menu = (await menuSave({ ...AUTH, menu: { identifier: 'main', title: 'M' } })).body.menu;
    const root = (await itemSave({ ...AUTH, item: { menuId: menu.id, title: 'Men', url: '/m' } })).body.item;
    const child = (await itemSave({ ...AUTH, item: { menuId: menu.id, title: 'S', url: '/s', parentId: root.id } })).body.item;
    const res = await itemSave({ ...AUTH, id: root.id, item: { id: root.id, menuId: menu.id, title: 'Men', url: '/m', parentId: child.id } });
    expect(res.statusCode).toBe(409);
  });
});

describe('storefront-menu-get', () => {
  const SECRET = { STOREFRONT_SHARED_SECRET: 's3cret', __ow_headers: { 'x-mm-secret': 's3cret' } };

  test('is anonymous but refuses a wrong or missing shared secret', async () => {
    expect((await storefront({ STOREFRONT_SHARED_SECRET: 's3cret', identifier: 'main' })).statusCode).toBe(403);
    expect((await storefront({ ...SECRET, __ow_headers: { 'x-mm-secret': 'wrong' }, identifier: 'main' })).statusCode).toBe(403);
  });

  test('serves a flat payload with legacy field names and a cache header', async () => {
    const menu = (await menuSave({ ...AUTH, menu: { identifier: 'main', title: 'Main' } })).body.menu;
    await itemSave({ ...AUTH, item: { menuId: menu.id, title: 'Men', url: '/men' } });
    const res = await storefront({ ...SECRET, identifier: 'main' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toMatch(/max-age=600/);
    expect(res.body.items[0]).toHaveProperty('item_id');
    expect(res.body.items[0]).toHaveProperty('url_type');
  });

  test('second call is served from the State cache', async () => {
    const menu = (await menuSave({ ...AUTH, menu: { identifier: 'main', title: 'Main' } })).body.menu;
    await itemSave({ ...AUTH, item: { menuId: menu.id, title: 'Men', url: '/men' } });
    await storefront({ ...SECRET, identifier: 'main' });
    const spy = jest.spyOn(repo, 'getMenuByIdentifier');
    await storefront({ ...SECRET, identifier: 'main' });
    expect(spy).not.toHaveBeenCalled();
  });

  test('404s an inactive menu and a menu not assigned to the store', async () => {
    await menuSave({ ...AUTH, menu: { identifier: 'off', title: 'Off', isActive: false } });
    await menuSave({ ...AUTH, menu: { identifier: 'lvonly', title: 'LV', storeCodes: ['lv'] } });
    expect((await storefront({ ...SECRET, identifier: 'off' })).statusCode).toBe(404);
    expect((await storefront({ ...SECRET, identifier: 'lvonly', storeCode: 'en' })).statusCode).toBe(404);
  });
});

describe('event: category changed', () => {
  const mkMenuWithCategoryItem = async () => {
    const menu = (await menuSave({ ...AUTH, menu: { identifier: 'main', title: 'M' } })).body.menu;
    const item = (await itemSave({ ...AUTH, item: { menuId: menu.id, title: 'Cat', urlType: 2, categoryId: 42 } })).body.item;
    return { menu, item };
  };

  test('delete event deactivates bound items but does not delete them (legacy parity)', async () => {
    const { item } = await mkMenuWithCategoryItem();
    const res = await categoryChanged({
      type: 'observer.catalog_category_delete_after',
      event_id: 'e1',
      data: { value: { entity_id: 42 } }
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.action).toBe('deactivated');
    const after = await repo.getItem(item.id);
    expect(after).not.toBeNull();
    expect(after.isActive).toBe(false);
  });

  test('duplicate delivery is a no-op (events are at-least-once)', async () => {
    await mkMenuWithCategoryItem();
    await categoryChanged({ type: 'observer.catalog_category_delete_after', event_id: 'dup', data: { value: { entity_id: 42 } } });
    const second = await categoryChanged({ type: 'observer.catalog_category_delete_after', event_id: 'dup', data: { value: { entity_id: 42 } } });
    expect(second.body.deduped).toBe(true);
  });

  test('save event refreshes the snapshot but does NOT change status while Q1 is open', async () => {
    const { item } = await mkMenuWithCategoryItem();
    const res = await categoryChanged({
      type: 'observer.catalog_category_save_after',
      event_id: 'e2',
      data: { value: { entity_id: 42, url_key: 'shoes', name: 'Shoes', is_active: false } }
    });
    expect(res.body.action).toBe('snapshot-refreshed');
    const after = await repo.getItem(item.id);
    expect(after.categorySnapshot.urlKey).toBe('shoes');
    expect(after.isActive).toBe(true); // unchanged — mirrors disabled="true" today
  });

  test('an unknown category is a clean no-op', async () => {
    const res = await categoryChanged({ type: 'observer.catalog_category_delete_after', event_id: 'e3', data: { value: { entity_id: 999 } } });
    expect(res.body.affected).toBe(0);
  });

  test('returns 500 on failure so Adobe retries (only 429/5xx are retried)', async () => {
    jest.spyOn(repo, 'findItemsByCategory').mockRejectedValue(new Error('db down'));
    const res = await categoryChanged({ type: 'observer.catalog_category_delete_after', event_id: 'e4', data: { value: { entity_id: 42 } } });
    expect(res.statusCode).toBe(500);
  });
});
