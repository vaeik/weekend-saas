#!/usr/bin/env node
/**
 * Seeds the `main` menu with weekend.lv's real navigation SHAPE (4 top items,
 * 6 subitems each) but backed by the demo storefront's real categories, so every
 * link renders a populated product listing.
 *
 * Why the mapping: this storefront runs on Adobe's shared demo catalog
 * (aemshop.net — Office/Apparel/Bags), which has no Weekend Shoes products. To
 * give each weekend menu entry a working page with products, each item is bound
 * to the closest real demo category (its `categoryId` + `categorySnapshot.urlKey`).
 * Titles are weekend.lv's Latvian labels; the products behind them are the demo
 * catalog's. Replace the demo backend with a real Weekend catalog and only the
 * category bindings below change — the structure stays.
 *
 * Category ids/urlPaths verified against the live catalog on seed (see MAP), not
 * assumed.
 *
 *   node scripts/seed-weekend-demo.js --dry-run
 *   node scripts/seed-weekend-demo.js
 */
require('dotenv').config();
const dbLib = require('@adobe/aio-lib-db');
const { DbMenuRepository } = require('../src/commerce-backend-ui-1/repository/db-repository');
const { getServiceToken, resolveNamespace } = require('../src/commerce-backend-ui-1/lib/ims-token');
const { flattenForStorefront } = require('../src/commerce-backend-ui-1/domain/tree');

const IDENTIFIER = 'main';

// weekend.lv structure (4 mains x 6 subs). Each node: weekend label -> demo
// category [id, urlPath]. cat() keeps the pairing readable.
const cat = (title, id, urlPath) => ({ title, id, urlPath });

const TREE = [
  {
    title: 'Sieviešu', id: 39, urlPath: 'apparel', children: [
      cat('Apģērbi', 39, 'apparel'),
      cat('Virsjakas & mēteļi', 42, 'apparel/outerwear'),
      cat('Blūzes & T-krekli', 87, 'apparel/shirts'),
      cat('Cepures', 81, 'apparel/hats'),
      cat('Somas', 66, 'bags/speciality'),
      cat('Aksesuāri', 60, 'apparel/accessories'),
    ],
  },
  {
    title: 'Vīriešu', id: 39, urlPath: 'apparel', children: [
      cat('Apģērbi', 39, 'apparel'),
      cat('Virsjakas', 42, 'apparel/outerwear'),
      cat('T-krekli & krekli', 87, 'apparel/shirts'),
      cat('Cepures', 81, 'apparel/hats'),
      cat('Mugursomas', 69, 'bags/backpacks'),
      cat('Aksesuāri', 60, 'apparel/accessories'),
    ],
  },
  {
    title: 'Bērnu', id: 99, urlPath: 'apparel/youth', children: [
      cat('Bērnu apģērbi', 99, 'apparel/youth'),
      cat('T-krekli', 87, 'apparel/shirts'),
      cat('Cepures', 81, 'apparel/hats'),
      cat('Mugursomas', 69, 'bags/backpacks'),
      cat('Rotaļlietas & spēles', 57, 'lifestyle/fun-games'),
      cat('Aksesuāri', 60, 'apparel/accessories'),
    ],
  },
  {
    title: 'Sports & Atpūta', id: 21, urlPath: 'lifestyle', children: [
      cat('Ceļojumu somas', 72, 'lifestyle/travel'),
      cat('Āra izklaide', 57, 'lifestyle/fun-games'),
      cat('Ūdens pudeles', 75, 'lifestyle/drinkware'),
      cat('Mājai & atpūtai', 24, 'lifestyle/at-home'),
      cat('Mugursomas', 69, 'bags/backpacks'),
      cat('Dāvanas', 54, 'collections/gifts'),
    ],
  },
];

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');

const printTree = (nodes, d = 1) => nodes.forEach((n) => {
  console.log(`${'  '.repeat(d)}- ${n.title}  ->  /${n.urlPath} (cat ${n.id})`);
  printTree(n.children || [], d + 1);
});
const count = (nodes) => nodes.reduce((a, n) => a + 1 + count(n.children || []), 0);

async function main() {
  console.log(`${IDENTIFIER}: ${count(TREE)} items (weekend.lv shape, demo-category backed)\n`);
  printTree(TREE);
  if (DRY) return;

  const namespace = resolveNamespace();
  if (!namespace) throw new Error('No runtime namespace. Run `aio app use -g`.');
  const token = await getServiceToken({});
  const base = await dbLib.init({ ow: { namespace }, region: process.env.AIO_DB_REGION || 'emea', token });
  const db = await base.connect();
  const repo = new DbMenuRepository(db);

  try {
    const existing = await repo.getMenuByIdentifier(IDENTIFIER);
    if (existing) {
      const res = await repo.deleteMenu(existing.id);
      console.log(`\nreplaced existing '${IDENTIFIER}' (+${res.deletedItems} items)`);
    }
    const menu = await repo.saveMenu({
      identifier: IDENTIFIER, title: 'Main menu', cssClass: 'weekend-nav', isActive: true, storeCodes: [],
    }, { actor: 'seed-weekend-demo' });

    let n = 0;
    const insert = async (nodes, parentId) => {
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        const saved = await repo.saveItem({
          menuId: menu.id,
          parentId,
          title: node.title,
          urlType: 2, // CATEGORY
          categoryId: node.id,
          position: i,
          isActive: true,
          categorySnapshot: { urlKey: node.urlPath, name: node.title, isActive: true, includeInMenu: true },
        }, { actor: 'seed-weekend-demo' });
        n += 1;
        if (node.children?.length) await insert(node.children, saved.id);
      }
    };
    await insert(TREE, null);
    console.log(`created menu ${menu.id} with ${n} items`);

    const payload = flattenForStorefront(menu, await repo.listItems(menu.id), { maxLevel: 4 });
    const byLevel = payload.items.reduce((a, it) => { a[it.level] = (a[it.level] || 0) + 1; return a; }, {});
    console.log(`storefront payload: ${payload.items.length} items, by level ${JSON.stringify(byLevel)}`);
  } finally {
    await db.close();
  }
}

main().catch((e) => { console.error(`SEED FAILED: ${e.message}`); process.exit(1); });
