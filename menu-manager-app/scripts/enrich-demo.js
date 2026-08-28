#!/usr/bin/env node
/**
 * Additively enriches the existing `main` menu so the storefront mega-menu shows
 * its full form: a promo image on each top-level item, and a third level of
 * sub-items under the first child of the first top item. Non-destructive — it
 * updates existing items in place and only inserts level-3 if none exist yet.
 *
 *   node scripts/enrich-demo.js
 */
require('dotenv').config();
const dbLib = require('@adobe/aio-lib-db');
const { DbMenuRepository } = require('../src/commerce-backend-ui-1/repository/db-repository');
const { getServiceToken, resolveNamespace } = require('../src/commerce-backend-ui-1/lib/ims-token');

const IDENTIFIER = 'main';

// Short promo image URLs (the `advertisement` field caps at 255 chars, so no
// data-URIs). Seeded picsum images are deterministic and render anywhere.
const PROMO = {
  Sievie: 'https://picsum.photos/seed/weekend-women/320/420',
  Vīrie: 'https://picsum.photos/seed/weekend-men/320/420',
  Bērnu: 'https://picsum.photos/seed/weekend-kids/320/420',
  Sports: 'https://picsum.photos/seed/weekend-sport/320/420',
};

// Level-3 under the first child of the first top item (real demo subcategories).
const LEVEL3 = [
  { title: 'Virsjakas', id: 42, urlPath: 'apparel/outerwear' },
  { title: 'Krekli', id: 87, urlPath: 'apparel/shirts' },
  { title: 'Aksesuāri', id: 60, urlPath: 'apparel/accessories' },
];

async function main() {
  const namespace = resolveNamespace();
  if (!namespace) throw new Error('No runtime namespace. Run `aio app use -g`.');
  const token = await getServiceToken({});
  const base = await dbLib.init({ ow: { namespace }, region: process.env.AIO_DB_REGION || 'emea', token });
  const db = await base.connect();
  const repo = new DbMenuRepository(db);

  try {
    const menu = await repo.getMenuByIdentifier(IDENTIFIER);
    if (!menu) throw new Error(`menu '${IDENTIFIER}' not found`);
    const items = await repo.listItems(menu.id);
    const tops = items.filter((i) => i.parentId == null).sort((a, b) => a.position - b.position);

    // 1. Promo image on each top-level item.
    for (const top of tops) {
      const key = Object.keys(PROMO).find((k) => top.title.includes(k));
      if (key) {
        await repo.saveItem({ ...top, advertisement: PROMO[key] }, { actor: 'enrich-demo' });
        console.log(`promo set: ${top.title}`);
      }
    }
    // Mark the last top item as a promo highlight (e.g. an Outlet-style entry).
    const last = tops[tops.length - 1];
    if (last) {
      await repo.saveItem({ ...last, isPromo: true }, { actor: 'enrich-demo' });
      console.log(`is_promo highlight: ${last.title}`);
    }

    // 2. Level-3 under the first child of the first top item (idempotent).
    const firstTop = tops[0];
    const firstChild = items
      .filter((i) => String(i.parentId) === String(firstTop.id))
      .sort((a, b) => a.position - b.position)[0];
    if (firstChild) {
      const kids = items.filter((i) => String(i.parentId) === String(firstChild.id));
      if (!kids.length) {
        for (let i = 0; i < LEVEL3.length; i += 1) {
          const n = LEVEL3[i];
          await repo.saveItem({
            menuId: menu.id,
            parentId: firstChild.id,
            title: n.title,
            urlType: 2,
            categoryId: n.id,
            position: i,
            isActive: true,
            categorySnapshot: { urlKey: n.urlPath, name: n.title, isActive: true, includeInMenu: true },
          }, { actor: 'enrich-demo' });
        }
        console.log(`added ${LEVEL3.length} level-3 items under: ${firstChild.title}`);
      } else {
        console.log(`level-3 already present under ${firstChild.title} (${kids.length}) — skipped`);
      }
    }

    const after = await repo.listItems(menu.id);
    const byLevel = after.reduce((a, it) => { a[it.level] = (a[it.level] || 0) + 1; return a; }, {});
    console.log(`\nmenu now has ${after.length} items, by level ${JSON.stringify(byLevel)}`);
  } finally {
    await db.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
