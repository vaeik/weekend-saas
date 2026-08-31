#!/usr/bin/env node
/**
 * Rebuilds the `main` menu directly FROM the live ACCS category tree, so every
 * menu item leads to a real category by construction (no hand-mapped labels,
 * no two items sharing a target).
 *
 * Each item stores the category's full `urlPath` as categorySnapshot.urlKey —
 * the storefront links rootLink(`/${category_url_key}`), so a nested category
 * (shoes/sneakers) resolves correctly.
 *
 *   node scripts/rebuild-menu-from-catalog.js [--dry-run]
 */
require('dotenv').config();
const dbLib = require('@adobe/aio-lib-db');
const { DbMenuRepository } = require('../src/commerce-backend-ui-1/repository/db-repository');
const { getServiceToken, resolveNamespace } = require('../src/commerce-backend-ui-1/lib/ims-token');

const IDENTIFIER = 'main';
const EP = 'https://na1-sandbox.api.commerce.adobe.com/EGD3J2kAQ3pgLrtoWaoCJR';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
// Categories that exist but should not appear in the nav.
const SKIP = new Set(['brands']);

/**
 * Read the tree from the Commerce REST API (source of truth) rather than
 * Catalog Service: CS is the storefront read model and lags a category move by
 * minutes, which would silently drop just-moved categories from the menu.
 */
async function commerceTree() {
  const token = await getServiceToken({});
  const r = await fetch(`${EP}/V1/categories`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'x-gw-ims-org-id': process.env.IMS_OAUTH_S2S_ORG_ID,
      'content-type': 'application/json',
      'User-Agent': UA,
    },
  });
  if (!r.ok) throw new Error(`categories ${r.status}`);
  return r.json();
}

/** Commerce returns url_key per node; the storefront needs the full path. */
function toNodes(children, parentPath = '', depth = 0) {
  return (children || [])
    .filter((c) => c.is_active !== false)
    .map((c) => {
      const key = (c.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const path = parentPath ? `${parentPath}/${key}` : key;
      return {
        id: Number(c.id), title: c.name, urlPath: path,
        children: depth < 1 ? toNodes(c.children_data, path, depth + 1) : [],
      };
    })
    .filter((n) => !SKIP.has(n.urlPath));
}

async function buildTree() {
  const root = await commerceTree();
  return toNodes(root.children_data);
}

const count = (n) => n.reduce((a, x) => a + 1 + count(x.children || []), 0);
const print = (n, d = 1) => n.forEach((x) => {
  console.log(`${'  '.repeat(d)}- ${x.title}  ->  /${x.urlPath}  (cat ${x.id})`);
  print(x.children || [], d + 1);
});

async function main() {
  const tree = await buildTree();
  console.log(`Commerce category tree -> ${count(tree)} menu items\n`);
  print(tree);
  if (process.argv.includes('--dry-run')) return;

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
      console.log(`\nreplaced '${IDENTIFIER}' (removed ${res.deletedItems} old items)`);
    }
    const menu = await repo.saveMenu({
      identifier: IDENTIFIER, title: 'Main menu', cssClass: 'weekend-nav', isActive: true, storeCodes: [],
    }, { actor: 'rebuild-from-catalog' });

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
          // full path so nested categories resolve on the storefront
          categorySnapshot: { urlKey: node.urlPath, name: node.title, isActive: true, includeInMenu: true },
        }, { actor: 'rebuild-from-catalog' });
        n += 1;
        if (node.children?.length) await insert(node.children, saved.id);
      }
    };
    await insert(tree, null);
    console.log(`created menu ${menu.id} with ${n} items, each bound to its own category`);
  } finally { await db.close(); }
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
