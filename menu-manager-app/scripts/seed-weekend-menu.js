#!/usr/bin/env node
/**
 * Seeds the `main` menu with weekend.lv's real navigation.
 *
 * Structure taken from the live site (weekend.lv, Aug 2026), not invented — 7
 * root items with the Women's three-column subcategory tree, which is the
 * shape that actually stresses the storefront rendering.
 *
 * Idempotent: re-running replaces the menu and its items rather than
 * duplicating them.
 *
 *   node scripts/seed-weekend-menu.js            # seed
 *   node scripts/seed-weekend-menu.js --dry-run  # print the tree, write nothing
 *   node scripts/seed-weekend-menu.js --remove   # delete it again
 */
require('dotenv').config();
const dbLib = require('@adobe/aio-lib-db');
const { DbMenuRepository } = require('../src/commerce-backend-ui-1/repository/db-repository');
const { getServiceToken, resolveNamespace } = require('../src/commerce-backend-ui-1/lib/ims-token');
const { flattenForStorefront } = require('../src/commerce-backend-ui-1/domain/tree');

const IDENTIFIER = 'main';

// url is used verbatim (urlType 0 = link). Paths mirror the live site so the
// seeded nav is comparable against weekend.lv page by page.
const TREE = [
  { title: 'Sieviešu', url: '/sieviesu.html', children: [
    { title: 'APAVI', url: '/sieviesu/apavi.html', children: [
      { title: 'Visi apavi', url: '/sieviesu/apavi.html' },
      { title: 'JAUNS', url: '/sieviesu/apavi/jauns.html' },
      { title: 'Kurpes', url: '/sieviesu/apavi/kurpes.html' },
      { title: 'Brīvā laika apavi', url: '/sieviesu/apavi/briva-laika.html' },
      { title: 'Sporta apavi', url: '/sieviesu/apavi/sporta.html' },
      { title: 'Gumijas zābaki', url: '/sieviesu/apavi/gumijas-zabaki.html' },
      { title: 'Iešļūcenes un sandales', url: '/sieviesu/apavi/sandales.html' },
      { title: 'Zābaki', url: '/sieviesu/apavi/zabaki.html' },
      { title: 'Čības', url: '/sieviesu/apavi/cibas.html' },
      { title: 'Ortopēdiskie apavi', url: '/sieviesu/apavi/ortopediskie.html' }
    ] },
    { title: 'APĢĒRBI', url: '/sieviesu/apgerbi.html', children: [
      { title: 'Jakas/parkas/mēteļi', url: '/sieviesu/apgerbi/jakas.html' },
      { title: 'Kleitas', url: '/sieviesu/apgerbi/kleitas.html' },
      { title: 'T-krekli/blūzes', url: '/sieviesu/apgerbi/krekli.html' },
      { title: 'Svārki', url: '/sieviesu/apgerbi/svarki.html' },
      { title: 'Īsbikses', url: '/sieviesu/apgerbi/isbikses.html' },
      { title: 'Džemperi/puloveri', url: '/sieviesu/apgerbi/dzemperi.html' },
      { title: 'Džinsa bikses', url: '/sieviesu/apgerbi/dzinsi.html' },
      { title: 'Garās bikses', url: '/sieviesu/apgerbi/bikses.html' },
      { title: 'Bikškostīmi', url: '/sieviesu/apgerbi/bikskostimi.html' },
      { title: 'Brīvā laika apģērbi', url: '/sieviesu/apgerbi/briva-laika.html' },
      { title: 'Veļa/apģērbs peldēšanai', url: '/sieviesu/apgerbi/vela.html' },
      { title: 'Lielie izmēri', url: '/sieviesu/apgerbi/lielie-izmeri.html' }
    ] },
    { title: 'AKSESUĀRI', url: '/sieviesu/aksesuari.html', children: [
      { title: 'Bikšu siksnas', url: '/sieviesu/aksesuari/siksnas.html' },
      { title: 'Somas/koferi', url: '/sieviesu/aksesuari/somas.html' },
      { title: 'Cepures', url: '/sieviesu/aksesuari/cepures.html' },
      { title: 'Cimdi', url: '/sieviesu/aksesuari/cimdi.html' },
      { title: 'Šalles', url: '/sieviesu/aksesuari/salles.html' },
      { title: 'Zeķes', url: '/sieviesu/aksesuari/zekes.html' },
      { title: 'Kopšanas līdzekļi', url: '/sieviesu/aksesuari/kopsana.html' },
      { title: 'Rokas pulksteņi', url: '/sieviesu/aksesuari/pulksteni.html' },
      { title: 'Rotaslietas', url: '/sieviesu/aksesuari/rotaslietas.html' },
      { title: 'Saulesbrilles', url: '/sieviesu/aksesuari/saulesbrilles.html' },
      { title: 'Piederumi', url: '/sieviesu/aksesuari/piederumi.html' },
      { title: 'Lietussargi', url: '/sieviesu/aksesuari/lietussargi.html' }
    ] }
  ] },
  { title: 'Vīriešu', url: '/viriesu.html', children: [
    { title: 'APAVI', url: '/viriesu/apavi.html' },
    { title: 'APĢĒRBI', url: '/viriesu/apgerbi.html' },
    { title: 'AKSESUĀRI', url: '/viriesu/aksesuari.html' }
  ] },
  { title: 'Bērnu', url: '/bernu.html', children: [
    { title: 'APAVI', url: '/bernu/apavi.html' },
    { title: 'APĢĒRBI', url: '/bernu/apgerbi.html' },
    { title: 'AKSESUĀRI', url: '/bernu/aksesuari.html' }
  ] },
  { title: 'Zīmoli', url: '/zimoli.html' },
  { title: 'Sports', url: '/sporta-veikals.html' },
  { title: 'OUTLET %', url: '/outlet.html', itemClass: 'nav-outlet' },
  { title: 'Skaistums', url: '/skaistums.html' }
];

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const REMOVE = args.includes('--remove');

const countNodes = (nodes) => nodes.reduce((n, x) => n + 1 + countNodes(x.children || []), 0);

function printTree (nodes, depth = 1) {
  nodes.forEach((n) => {
    console.log(`${'  '.repeat(depth)}${'-'.repeat(1)} ${n.title}  ${n.url}`);
    printTree(n.children || [], depth + 1);
  });
}

async function main () {
  if (DRY) {
    console.log(`${IDENTIFIER}: ${countNodes(TREE)} items\n`);
    printTree(TREE);
    return;
  }

  const namespace = resolveNamespace();
  if (!namespace) throw new Error('No runtime namespace. Run `aio app use -g`.');
  const token = await getServiceToken({});
  const base = await dbLib.init({
    ow: { namespace }, region: process.env.AIO_DB_REGION || 'emea', token
  });
  const db = await base.connect();
  const repo = new DbMenuRepository(db);

  try {
    // Replace rather than merge, so the seed is repeatable.
    const existing = await repo.getMenuByIdentifier(IDENTIFIER);
    if (existing) {
      const res = await repo.deleteMenu(existing.id);
      console.log(`removed existing '${IDENTIFIER}' (+${res.deletedItems} items)`);
    }
    if (REMOVE) { console.log('done (--remove)'); return; }

    const menu = await repo.saveMenu({
      identifier: IDENTIFIER,
      title: 'Weekend main menu',
      cssClass: 'weekend-nav',
      isActive: true,
      storeCodes: []          // empty = all stores
    }, { actor: 'seed-script' });
    console.log(`created menu ${menu.id}`);

    let created = 0;
    const insert = async (nodes, parentId) => {
      for (let i = 0; i < nodes.length; i += 1) {
        const n = nodes[i];
        const saved = await repo.saveItem({
          menuId: menu.id,
          parentId,
          title: n.title,
          url: n.url,
          urlType: 0,
          itemClass: n.itemClass || '',
          position: i,
          isActive: true
        }, { actor: 'seed-script' });
        created += 1;
        if (n.children?.length) await insert(n.children, saved.id);
      }
    };
    await insert(TREE, null);
    console.log(`created ${created} items`);

    const items = await repo.listItems(menu.id);
    const payload = flattenForStorefront(menu, items, { maxLevel: 4 });
    const byLevel = payload.items.reduce((a, i) => { a[i.level] = (a[i.level] || 0) + 1; return a; }, {});
    console.log(`storefront payload: ${payload.items.length} items, by level ${JSON.stringify(byLevel)}`);
    console.log(`\nverify: curl -s -H "x-mm-secret: $STOREFRONT_SHARED_SECRET" \\\n  "$MM_ACTION_URL?identifier=${IDENTIFIER}" | head -c 400`);
  } finally {
    await db.close();
  }
}

main().catch((e) => { console.error(`SEED FAILED: ${e.message}`); process.exit(1); });
