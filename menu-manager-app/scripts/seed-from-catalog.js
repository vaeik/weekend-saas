#!/usr/bin/env node
/**
 * Seeds the `main` menu from the REAL category tree of the configured Commerce
 * backend, so every link resolves to a working PLP.
 *
 * Why this replaces seed-weekend-menu.js for the demo: that script used
 * weekend.lv's own paths (/sieviesu.html ...), which do not exist on this
 * storefront — the backend here is Adobe's demo catalog (Office, Collections,
 * Lifestyle, Apparel, Bags). Links looked right and 404'd.
 *
 * Items are created as urlType 2 (CATEGORY) with categoryId + a categorySnapshot
 * holding urlKey. That is the production-shaped path: the storefront resolves
 * hrefs from category_url_key and never calls Commerce per item, and the category
 * event handler keeps the snapshot fresh.
 *
 *   node scripts/seed-from-catalog.js --dry-run
 *   node scripts/seed-from-catalog.js
 *   node scripts/seed-from-catalog.js --depth 3
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const dbLib = require('@adobe/aio-lib-db');
const { DbMenuRepository } = require('../src/commerce-backend-ui-1/repository/db-repository');
const { getServiceToken, resolveNamespace } = require('../src/commerce-backend-ui-1/lib/ims-token');
const { flattenForStorefront } = require('../src/commerce-backend-ui-1/domain/tree');

const IDENTIFIER = 'main';
const ROOT_CATEGORY_ID = '2';
/** Demo-catalog noise that should not appear in a shop nav. */
const SKIP = new Set(['qa-data', 'ssg-data', 'demo']);

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const depthArg = args.indexOf('--depth');
const MAX_DEPTH = depthArg > -1 ? Number(args[depthArg + 1]) : 3;

/** Reuses the storefront's own config so the seed can never drift from it. */
function commerceConfig () {
  const cfgPath = path.resolve(__dirname, '../../config.json');
  if (!fs.existsSync(cfgPath)) throw new Error(`Storefront config not found at ${cfgPath}`);
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const p = cfg.public?.default;
  if (!p?.['commerce-endpoint']) throw new Error('commerce-endpoint missing from config.json');
  return {
    endpoint: p['commerce-endpoint'],
    headers: { ...(p.headers?.all || {}), ...(p.headers?.cs || {}), 'content-type': 'application/json' }
  };
}

async function fetchCategories (cfg, ids) {
  if (!ids.length) return [];
  const query = `{categories(ids:[${ids.map((i) => JSON.stringify(String(i))).join(',')}]){
    id name urlKey urlPath level children
  }}`;
  const res = await fetch(cfg.endpoint, { method: 'POST', headers: cfg.headers, body: JSON.stringify({ query }) });
  if (!res.ok) throw new Error(`Catalog Service HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(`Catalog Service: ${json.errors[0].message}`);
  return json.data?.categories || [];
}

/** Breadth-first walk so one request per level rather than one per category. */
async function buildTree (cfg, rootId, maxDepth) {
  const [root] = await fetchCategories(cfg, [rootId]);
  if (!root) throw new Error(`Root category ${rootId} not found`);

  const nodes = new Map();
  let frontier = (root.children || []).map(String);
  for (let depth = 1; depth <= maxDepth && frontier.length; depth += 1) {
    const level = await fetchCategories(cfg, frontier);
    const next = [];
    level.forEach((c) => {
      if (SKIP.has(c.urlKey)) return;
      nodes.set(String(c.id), c);
      if (depth < maxDepth) next.push(...(c.children || []).map(String));
    });
    frontier = next;
  }

  // Reattach children only where the parent survived the SKIP filter.
  const childrenOf = new Map();
  nodes.forEach((c) => {
    (c.children || []).forEach((kid) => {
      if (!nodes.has(String(kid))) return;
      if (!childrenOf.has(String(c.id))) childrenOf.set(String(c.id), []);
      childrenOf.get(String(c.id)).push(String(kid));
    });
  });
  const isChild = new Set([...childrenOf.values()].flat());
  const roots = [...nodes.keys()].filter((id) => !isChild.has(id));

  const shape = (id) => ({
    ...nodes.get(id),
    children: (childrenOf.get(id) || []).map(shape)
  });
  return roots.map(shape);
}

const countNodes = (n) => n.reduce((a, x) => a + 1 + countNodes(x.children || []), 0);
const printTree = (n, d = 1) => n.forEach((x) => {
  console.log(`${'  '.repeat(d)}- ${x.name}  (id ${x.id}, /${x.urlKey})`);
  printTree(x.children || [], d + 1);
});

async function main () {
  const cfg = commerceConfig();
  console.log(`catalog: ${cfg.endpoint}\n`);
  const tree = await buildTree(cfg, ROOT_CATEGORY_ID, MAX_DEPTH);
  console.log(`${countNodes(tree)} categories, depth <= ${MAX_DEPTH}\n`);
  printTree(tree);
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
      identifier: IDENTIFIER, title: 'Main menu', cssClass: 'weekend-nav', isActive: true, storeCodes: []
    }, { actor: 'seed-from-catalog' });

    let n = 0;
    const insert = async (nodes, parentId) => {
      for (let i = 0; i < nodes.length; i += 1) {
        const c = nodes[i];
        const saved = await repo.saveItem({
          menuId: menu.id,
          parentId,
          title: c.name,
          urlType: 2,                 // CATEGORY
          categoryId: Number(c.id),
          position: i,
          isActive: true,
          // Pre-populated so the storefront resolves hrefs without calling
          // Commerce. Normally maintained by the category event handler.
          categorySnapshot: { urlKey: c.urlPath || c.urlKey, name: c.name, isActive: true, includeInMenu: true }
        }, { actor: 'seed-from-catalog' });
        n += 1;
        if (c.children?.length) await insert(c.children, saved.id);
      }
    };
    await insert(tree, null);
    console.log(`created menu ${menu.id} with ${n} items`);

    const payload = flattenForStorefront(menu, await repo.listItems(menu.id), { maxLevel: 4 });
    const byLevel = payload.items.reduce((a, i) => { a[i.level] = (a[i.level] || 0) + 1; return a; }, {});
    console.log(`storefront payload: ${payload.items.length} items, by level ${JSON.stringify(byLevel)}`);
    const sample = payload.items.slice(0, 3).map((i) => `${i.title} -> /${i.category_url_key}`);
    console.log(`sample hrefs: ${sample.join(' | ')}`);
  } finally {
    await db.close();
  }
}

main().catch((e) => { console.error(`SEED FAILED: ${e.message}`); process.exit(1); });
