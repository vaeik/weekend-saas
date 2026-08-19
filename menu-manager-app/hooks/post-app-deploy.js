#!/usr/bin/env node
/**
 * Creates the Database indexes after every deploy.
 *
 * This is Adobe's documented pattern — indexes are not declarative, so without
 * this hook the collections work but every query is a full scan, and the
 * uniqueness guarantee on `identifier` does not exist.
 *
 * Constraint: "No document may have values for the indexed fields that exceed
 * 2048 bytes combined." All indexed fields here are short ids/slugs.
 */
require('dotenv').config();
const dbLib = require('@adobe/aio-lib-db');
const {
  getServiceToken, resolveNamespace
} = require('../src/commerce-backend-ui-1/lib/ims-token');

const INDEXES = [
  { collection: 'menus', spec: { identifier: 1 }, options: { unique: true, name: 'menus_identifier_unique' } },
  { collection: 'menus', spec: { storeCodes: 1 }, options: { name: 'menus_storeCodes' } },
  { collection: 'menuItems', spec: { menuId: 1, position: 1 }, options: { name: 'items_menu_position' } },
  { collection: 'menuItems', spec: { parentId: 1 }, options: { name: 'items_parent' } },
  { collection: 'menuItems', spec: { categoryId: 1 }, options: { name: 'items_category' } },
  { collection: 'menuItems', spec: { cmsPageId: 1 }, options: { name: 'items_cmsPage' } }
];

const REQUIRED_CREDS = [
  'IMS_OAUTH_S2S_CLIENT_ID',
  'IMS_OAUTH_S2S_CLIENT_SECRET',
  'IMS_OAUTH_S2S_ORG_ID',
  'IMS_OAUTH_S2S_SCOPES'
];

async function run () {
  // Without this guard the hook dies inside aio-lib-db with a stack trace that
  // says nothing about WHICH setup step was skipped. Missing indexes are not a
  // cosmetic problem: menus.identifier loses its uniqueness guarantee and every
  // query becomes a full scan, so this fails loudly rather than warning.
  const missing = REQUIRED_CREDS.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error('[post-app-deploy] Cannot create database indexes.');
    console.error(`[post-app-deploy] Missing in .env: ${missing.join(', ')}`);
    console.error('[post-app-deploy] These come from an OAuth Server-to-Server credential.');
    console.error('[post-app-deploy] Fix: Developer Console > this project > workspace >');
    console.error('[post-app-deploy]      Add service > API > "App Builder Data Services",');
    console.error('[post-app-deploy]      credential type OAuth Server-to-Server, then copy the');
    console.error('[post-app-deploy]      four values into .env. See SETUP.md step 2.');
    console.error('[post-app-deploy] The app IS deployed; only indexes are missing. Re-run:');
    console.error('[post-app-deploy]      node hooks/post-app-deploy.js');
    process.exit(1);
  }

  const namespace = resolveNamespace();
  if (!namespace) {
    console.error('[post-app-deploy] No runtime namespace. Run `aio app use -g` first.');
    process.exit(1);
  }
  const token = await getServiceToken({});
  // init() returns a DbBase (provision/ping/connect). collection() lives on the
  // DbClient that connect() returns — skipping connect() yields the unhelpful
  // "db.collection is not a function".
  const base = await dbLib.init({
    ow: { namespace },
    region: process.env.AIO_DB_REGION || 'emea',
    token
  });
  const db = await base.connect();
  console.log(`[post-app-deploy] namespace ${namespace}`);
  for (const ix of INDEXES) {
    try {
      const name = await db.collection(ix.collection).createIndex(ix.spec, ix.options);
      console.log(`[post-app-deploy] index ready: ${ix.collection}.${name}`);
    } catch (err) {
      // A pre-existing identical index is fine; anything else must be loud.
      if (/already exists/i.test(err.message)) {
        console.log(`[post-app-deploy] index exists: ${ix.collection}.${ix.options.name}`);
      } else {
        console.error(`[post-app-deploy] FAILED ${ix.collection}.${ix.options.name}: ${err.message}`);
        process.exitCode = 1;
      }
    }
  }
  // The hook is a short-lived process, so close explicitly. Actions deliberately
  // do NOT close — the client is reused across warm invocations.
  await db.close();
}

if (require.main === module) run().catch((e) => { console.error(e); process.exit(1); });
module.exports = { INDEXES, run };
