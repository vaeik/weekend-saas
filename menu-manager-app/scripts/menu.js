#!/usr/bin/env node
/**
 * Menu Manager CLI — a stand-in for the admin UI until Phase 3 exists.
 *
 * Talks to the repository directly (same code the deployed actions use), so
 * anything done here behaves exactly as it will through the UI: cycle guards,
 * level recomputation, cascade deletes, cache invalidation semantics.
 *
 *   node scripts/menu.js list
 *   node scripts/menu.js tree
 *   node scripts/menu.js add --title "Sale" --url /outlet [--parent <itemId>] [--position 0]
 *   node scripts/menu.js add --title "Bags" --category 63 --category-url-key bags
 *   node scripts/menu.js set  --id <itemId> [--title X] [--url Y] [--active true|false]
 *   node scripts/menu.js move --id <itemId> [--parent <itemId>|root] [--position 2]
 *   node scripts/menu.js rm   --id <itemId>          # deletes the subtree
 *
 * Add `--menu <identifier>` to target a menu other than `main`.
 */
require('dotenv').config();
const dbLib = require('@adobe/aio-lib-db');
const { DbMenuRepository } = require('../src/commerce-backend-ui-1/repository/db-repository');
const { getServiceToken, resolveNamespace } = require('../src/commerce-backend-ui-1/lib/ims-token');
const { assembleTree, reorder } = require('../src/commerce-backend-ui-1/domain/tree');
const { validateItem } = require('../src/commerce-backend-ui-1/domain/schema');

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name, dflt = undefined) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : dflt;
};
const MAX_LEVEL = 4;

async function connect () {
  const namespace = resolveNamespace();
  if (!namespace) throw new Error('No runtime namespace. Run `aio app use -g`.');
  const token = await getServiceToken({});
  const base = await dbLib.init({ ow: { namespace }, region: process.env.AIO_DB_REGION || 'emea', token });
  return base.connect();
}

const printTree = (nodes, depth = 0) => nodes.forEach((n) => {
  const target = n.urlType === 2
    ? `cat ${n.categoryId}${n.categorySnapshot?.urlKey ? ` -> /${n.categorySnapshot.urlKey}` : ''}`
    : (n.url || '(no url)');
  console.log(`${'  '.repeat(depth)}${n.isActive === false ? 'x' : '-'} ${n.title.padEnd(28 - depth * 2)} ${String(n.id).padEnd(30)} ${target}`);
  printTree(n.children || [], depth + 1);
});

async function main () {
  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(require('fs').readFileSync(__filename, 'utf8').split('*/')[0].split('\n').slice(3).join('\n').replace(/^ \* ?/gm, ''));
    return;
  }

  const db = await connect();
  const repo = new DbMenuRepository(db);
  const identifier = flag('menu', 'main');

  try {
    const menu = await repo.getMenuByIdentifier(identifier);
    if (!menu) throw new Error(`Menu '${identifier}' not found. Run \`npm run seed\` first.`);
    const items = await repo.listItems(menu.id);

    switch (cmd) {
      case 'list':
        console.log(`${menu.title} (${identifier}) — ${items.length} items\n`);
        items.sort((a, b) => (a.level - b.level) || (a.position - b.position))
          .forEach((i) => console.log(`  L${i.level} pos${i.position} ${String(i.id).padEnd(30)} ${i.title}`));
        break;

      case 'tree':
        console.log(`${menu.title} (${identifier}) — ${items.length} items\n`);
        printTree(assembleTree(items).tree);
        break;

      case 'add': {
        const title = flag('title');
        if (!title) throw new Error('--title is required');
        const category = flag('category');
        const input = {
          menuId: menu.id,
          parentId: flag('parent') || null,
          title,
          position: Number(flag('position', String(items.filter((i) => !i.parentId).length))),
          urlType: category ? 2 : 0,
          categoryId: category ? Number(category) : null,
          url: flag('url') || null
        };
        // Same validation the action runs, so the CLI cannot create a record the
        // admin UI would reject.
        const validated = validateItem(input);
        const urlKey = flag('category-url-key');
        const saved = await repo.saveItem({
          ...validated,
          categorySnapshot: urlKey ? { urlKey, name: title, isActive: true, includeInMenu: true } : null
        }, { actor: 'cli' });
        console.log(`added ${saved.id} "${saved.title}" at level ${saved.level} position ${saved.position}`);
        break;
      }

      case 'set': {
        const id = flag('id');
        if (!id) throw new Error('--id is required');
        const cur = await repo.getItem(id);
        if (!cur) throw new Error(`Item ${id} not found`);
        const active = flag('active');
        const merged = {
          ...cur,
          title: flag('title', cur.title),
          url: flag('url', cur.url),
          isActive: active === undefined ? cur.isActive : active === 'true'
        };
        const saved = await repo.saveItem(merged, { actor: 'cli' });
        console.log(`updated ${saved.id} "${saved.title}" active=${saved.isActive}`);
        break;
      }

      case 'move': {
        const id = flag('id');
        if (!id) throw new Error('--id is required');
        const parentRaw = flag('parent');
        const parentId = parentRaw === 'root' || parentRaw === undefined ? null : parentRaw;
        const { updates } = reorder(items, {
          itemId: id, newParentId: parentId, newPosition: Number(flag('position', '0')), maxLevel: MAX_LEVEL
        });
        await repo.applyReorder(updates);
        console.log(`moved ${id} -> parent=${parentId ?? 'ROOT'} (${updates.length} rows rewritten)`);
        break;
      }

      case 'rm': {
        const id = flag('id');
        if (!id) throw new Error('--id is required');
        const res = await repo.deleteItem(id);
        console.log(`deleted ${res.deleted} item(s) (item + subtree)`);
        break;
      }

      default:
        throw new Error(`Unknown command '${cmd}'. Try: list | tree | add | set | move | rm`);
    }

    console.log('\nNOTE: the storefront caches the resolved menu in State for 24h.');
    console.log('Actions invalidate it on write; this CLI writes to the DB directly, so');
    console.log('either wait for the TTL or re-run `npm run seed` to force a rebuild.');
  } finally {
    await db.close();
  }
}

main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
