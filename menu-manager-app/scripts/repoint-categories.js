#!/usr/bin/env node
/**
 * Re-points every category menu item from the old demo-catalog ids to the real
 * sandbox categories created in the ACCS instance (ids 3-15). Best-effort map by
 * the item's (Latvian) label. Non-destructive: updates categoryId +
 * categorySnapshot.urlKey in place; leaves link/CMS items untouched.
 *
 *   node scripts/repoint-categories.js
 */
require('dotenv').config();
const dbLib = require('@adobe/aio-lib-db');
const { DbMenuRepository } = require('../src/commerce-backend-ui-1/repository/db-repository');
const { getServiceToken, resolveNamespace } = require('../src/commerce-backend-ui-1/lib/ims-token');

const IDENTIFIER = 'main';

// Real sandbox categories: id -> urlKey (name).
const CAT = {
  3: 'women', 4: 'men', 5: 'kids', 6: 'sneakers', 7: 'boots', 8: 'sandals',
  9: 'sport', 10: 'accessories', 11: 'bags', 12: 'socks', 13: 'brands',
  14: 'sale', 15: 'new-arrivals',
};

/** Map a menu-item label to the best-fitting sandbox category id. */
function pick(title) {
  const t = title.toLowerCase();
  if (/siev/.test(t)) return 3;                        // Sieviešu -> Women
  if (/vīrie|virie/.test(t)) return 4;                 // Vīriešu -> Men
  if (/bērn|bern|rotaļ|rotal|spēl|spel/.test(t)) return 5; // Bērnu / toys -> Kids
  if (/mugursom|som/.test(t)) return 11;               // somas / mugursomas -> Bags
  if (/aksesu|dāvan|davan/.test(t)) return 10;         // accessories / gifts -> Accessories
  if (/cepur/.test(t)) return 10;                      // cepures (hats) -> Accessories
  if (/virsjak|mētel|meteli/.test(t)) return 7;        // jackets / coats -> Boots
  if (/blūz|bluz|krekl/.test(t)) return 8;             // blouses / shirts / tees -> Sandals
  if (/apģērb|apgerb/.test(t)) return 6;               // clothing -> Sneakers
  if (/sport|āra|ara|ūden|uden|pudel/.test(t)) return 9; // sport / outdoor / bottles -> Sport
  if (/māj|maj|atpūt|atput/.test(t)) return 10;        // home & leisure -> Accessories
  return 10;                                           // sensible default
}

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

    let n = 0;
    for (const it of items) {
      if (it.urlType !== 2) continue; // only category items
      const catId = pick(it.title);
      const urlKey = CAT[catId];
      await repo.saveItem({
        ...it,
        categoryId: catId,
        categorySnapshot: { urlKey, name: it.title, isActive: true, includeInMenu: true },
      }, { actor: 'repoint-categories' });
      console.log(`${it.title.padEnd(24)} cat#${it.categoryId ?? '-'} -> ${catId} (${urlKey})`);
      n += 1;
    }
    console.log(`\nre-pointed ${n} category item(s) to sandbox categories`);
  } finally {
    await db.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
