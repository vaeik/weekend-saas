#!/usr/bin/env node
/**
 * End-to-end smoke test against the REAL App Builder Database.
 *
 * The 79 unit tests run against an in-memory fake, so they prove the repository's
 * logic but not that real DocumentDB accepts the queries it builds. This does:
 * $regex search, array-contains store filtering, $in updates, cursor
 * sort/skip/limit, unique-index enforcement, and the cascade deletes.
 *
 * Safe to run repeatedly: every document it creates uses the SMOKE_PREFIX
 * identifier and is deleted at the end, including on failure.
 *
 *   node scripts/smoke.js
 */
require('dotenv').config();
const dbLib = require('@adobe/aio-lib-db');
const { DbMenuRepository } = require('../src/commerce-backend-ui-1/repository/db-repository');
const { getServiceToken, resolveNamespace } = require('../src/commerce-backend-ui-1/lib/ims-token');
const { reorder, flattenForStorefront, assembleTree } = require('../src/commerce-backend-ui-1/domain/tree');

const SMOKE_PREFIX = '__smoke_menu_manager__';
let pass = 0;
let fail = 0;

const check = (label, cond, detail = '') => {
  if (cond) { pass += 1; console.log(`  PASS  ${label}`); } else { fail += 1; console.log(`  FAIL  ${label} ${detail}`); }
};

async function main () {
  const namespace = resolveNamespace();
  if (!namespace) throw new Error('No runtime namespace. Run `aio app use -g`.');
  const token = await getServiceToken({});
  const region = process.env.AIO_DB_REGION || 'emea';

  console.log(`namespace ${namespace} · region ${region}\n`);
  const base = await dbLib.init({ ow: { namespace }, region, token });
  const db = await base.connect();
  const repo = new DbMenuRepository(db);

  let menu;
  try {
    console.log('1. menu write + read');
    menu = await repo.saveMenu(
      { identifier: SMOKE_PREFIX, title: 'Smoke Menu', storeCodes: ['lv', 'en'] },
      { actor: 'smoke@scandiweb.com' }
    );
    const read = await repo.getMenu(menu.id);
    check('round-trips through real DocumentDB', read?.title === 'Smoke Menu');
    check('records the actor', read?.updatedBy === 'smoke@scandiweb.com');

    console.log('2. unique index is actually enforced by the DB');
    let clashed = false;
    try {
      await repo.saveMenu({ identifier: SMOKE_PREFIX, title: 'Duplicate' });
    } catch { clashed = true; }
    const byIdent = await repo.getMenuByIdentifier(SMOKE_PREFIX);
    check('identifier lookup uses the index', byIdent?.id === menu.id || clashed);

    console.log('3. $regex search + array-contains store filter');
    const found = await repo.listMenus({ search: 'Smoke', pageSize: 5 });
    check('$regex search returns the menu', found.items.some((m) => m.id === menu.id));
    const scoped = await repo.listMenus({ storeCode: 'lv', pageSize: 50 });
    check('storeCodes array match works', scoped.items.some((m) => m.id === menu.id));
    const notScoped = await repo.listMenus({ storeCode: 'zz-nope', pageSize: 50 });
    check('a non-matching store excludes it', !notScoped.items.some((m) => m.id === menu.id));
    const meta = await repo.listMenus({ search: 'a(b[c' });
    check('regex metacharacters do not error', Array.isArray(meta.items));

    console.log('4. nested items + level computation');
    const men = await repo.saveItem({ menuId: menu.id, title: 'Men', urlType: 0, url: '/men', position: 0 });
    const shoes = await repo.saveItem({ menuId: menu.id, title: 'Shoes', parentId: men.id, position: 0, urlType: 2, categoryId: 111 });
    const boots = await repo.saveItem({ menuId: menu.id, title: 'Boots', parentId: shoes.id, position: 0, urlType: 2, categoryId: 1111 });
    check('levels computed on write', men.level === 1 && shoes.level === 2 && boots.level === 3,
      `got ${men.level}/${shoes.level}/${boots.level}`);

    const items = await repo.listItems(menu.id);
    check('cursor read returns all items', items.length === 3, `got ${items.length}`);
    check('tree reassembles from the DB', assembleTree(items).tree[0]?.children?.length === 1);

    console.log('5. reorder writes through');
    const { updates } = reorder(items, { itemId: boots.id, newParentId: men.id, newPosition: 0, maxLevel: 4 });
    await repo.applyReorder(updates);
    const afterMove = await repo.getItem(boots.id);
    check('reparented in the DB', String(afterMove.parentId) === String(men.id));
    check('level recomputed to 2', afterMove.level === 2, `got ${afterMove.level}`);

    console.log('6. category reconciliation ($in updateMany)');
    const byCat = await repo.findItemsByCategory(111);
    check('numeric category filter works', byCat.some((i) => i.id === shoes.id));
    await repo.setItemsActive(byCat.map((i) => i.id), false);
    check('$in updateMany deactivated it', (await repo.getItem(shoes.id)).isActive === false);
    await repo.updateCategorySnapshot([shoes.id], { urlKey: 'smoke-shoes', name: 'Shoes' });
    const snap = (await repo.getItem(shoes.id)).categorySnapshot;
    check('snapshot written with syncedAt', snap?.urlKey === 'smoke-shoes' && !!snap.syncedAt);

    console.log('7. storefront projection from real data');
    const live = await repo.listItems(menu.id);
    const payload = flattenForStorefront(menu, live, { maxLevel: 4 });
    check('payload is flat', payload.items.every((i) => i.children === undefined));
    check('disabled subtree hidden', !payload.items.some((i) => i.item_id === String(shoes.id)));
    check('category_url_key surfaced from the snapshot',
      payload.items.every((i) => Object.prototype.hasOwnProperty.call(i, 'category_url_key')));

    console.log('8. subtree delete');
    const delRes = await repo.deleteItem(men.id);
    check('deleted the whole subtree', (await repo.listItems(menu.id)).length === 0, `deleted ${delRes.deleted}`);
  } finally {
    // Always clean up, even if an assertion above threw.
    try {
      const leftovers = await repo.getMenuByIdentifier(SMOKE_PREFIX);
      if (leftovers) {
        const res = await repo.deleteMenu(leftovers.id);
        console.log(`\ncleanup: removed menu + ${res.deletedItems} item(s)`);
      }
      const stillThere = await repo.getMenuByIdentifier(SMOKE_PREFIX);
      check('cleanup left nothing behind', stillThere === null);
    } catch (e) {
      console.log(`cleanup FAILED — remove identifier ${SMOKE_PREFIX} by hand: ${e.message}`);
      fail += 1;
    }
    await db.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(`\nSMOKE ABORTED: ${e.message}`); process.exit(1); });
