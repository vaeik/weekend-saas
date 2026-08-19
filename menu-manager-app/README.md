# Weekend Menu Manager — Adobe App Builder app

Out-of-process rebuild of `ScandiPWA/MenuOrganizer` for **Adobe Commerce as a
Cloud Service**. EVO-217. See `Menu_Manager_App_Builder_Build_Plan.md` for the
architecture, sizing and risk register this implements.

**Status:** Phase 1 (Foundation) + Phase 2 (Data layer) + the storefront and
event paths. Phase 3 (the React admin SPA under `web-src/`) is not built yet.

## What works today

| Piece | State |
|---|---|
| Admin UI SDK V1 registration (1 menu + 1 section) | ✅ |
| Menu CRUD actions, incl. cascade delete + identifier uniqueness | ✅ |
| Item CRUD, subtree delete, drag-and-drop reorder with cycle + depth guards | ✅ |
| Database repository (`aio-lib-db`) + State read cache | ✅ |
| Storefront flat-menu action + API Mesh config | ✅ |
| Category event handler (idempotent, dedupes) | ✅ |
| Index creation on deploy | ✅ |
| **React admin SPA** | ❌ Phase 3 |
| **MySQL → Database importer** | ❌ needs the dump (gate G2) |
| **Nightly reconciliation sweep** | ❌ Phase 4 |

`npm test` → 58 tests, no Adobe credentials required. `npm run lint` → clean.

## Layout

```
src/commerce-backend-ui-1/
  domain/      tree.js, schema.js      pure logic, no I/O — the tested core
  repository/  db-repository.js        system of record (App Builder Database)
               cache.js                State read cache for the storefront
               index.js                the one seam where the backend is chosen
  lib/         auth.js, http.js        IMS guard, uniform responses
  actions/     menu/ item/ storefront/ events/ registration/
hooks/         post-app-deploy.js      creates the Database indexes
mesh/          mesh.json               scandiwebMenu over the storefront action
commerce/      event-subscriptions.json  payloads for /V1/eventing/eventSubscribe
test/          fake-db.js + 4 suites
```

## Design decisions worth knowing before you read the code

**Database is the system of record, State is only a cache.** App Builder State
caps TTL at 365 days with no infinite option, has no secondary indexes, and its
`list()` is documented as able to skip or duplicate keys mid-iteration. Menus are
permanent, relational business data. `@adobe/aio-lib-db` has no TTL, real
indexes and 16MB documents. `MENU_REPOSITORY` in `.env` is the switch, and
`repository/index.js` is the only file that knows which backend is live.

**The storefront payload is flat, not nested.** API Mesh caps
`queryConfig.maxDepth` at 6 and a recursive `children` selection burns ~2 levels
per menu tier. `flattenForStorefront()` emits `parent_id` + `level` and the EDS
header block rebuilds the tree. Field names are the **legacy snake_case GraphQL
names**, so the `scandiwebMenu` contract is unchanged.

**Foreign keys became application code.** ACCS has no shared database, so the
three FKs that crossed into Commerce (`category_id`, `cms_page_id`, `store_id`)
are now event-driven reconciliation, and the `menu_id` CASCADE is reimplemented
in `deleteMenu` / `deleteItem`. Every one of those is covered by a test.

**Events are assumed hostile.** At-least-once, duplicates expected, order not
guaranteed, retries stop after 24h with no dead-letter queue. The handler dedupes
on event id in State (48h TTL, twice the retry window) and returns 500 on failure
so Adobe retries — 429 and 5xx are the only codes Adobe retries.

**`catalog_category_save_after` does not change item status.** It is
`disabled="true"` in Weekend's live `events.xml` today, so `SYNC_ON_SAVE` in
`actions/events/category-changed.js` is `false` to preserve current behaviour
exactly. Flip it only when the client answers Q1 in the plan.

## Deploying (Phase 0 runbook)

There is **no local dev loop** — Admin UI SDK local testing is PaaS-only, so on
ACCS "Enable local testing" must be **No** and every iteration is a deploy.

The `aio` CLI is a **global** install — `npm install` in this folder does not
provide it. Requires Node >= 20.

```bash
npm install -g @adobe/aio-cli          # provides `aio`
aio --version                           # expect 11.x
aio plugins:install @adobe/aio-cli-plugin-api-mesh   # only needed for the mesh
```

Then, **from this folder** (`menu-manager-app/`, not the repo root — `aio app`
commands resolve `app.config.yaml` from the working directory):

```bash
aio login
aio console org select && aio console project select && aio console workspace select
aio app use --workspace Stage
cp .env.example .env    # fill in; .env is gitignored
npm ci && npm test && npm run lint
aio app deploy          # runs hooks/post-app-deploy.js -> creates indexes
```

Then, once per app (not once per code change):

1. Deploy to the **Production** workspace.
2. Submit for approval in Adobe Developer Console.
3. An **org admin** approves it in Adobe Exchange (`exchange.adobe.com/manage`).
   Private distribution — no Adobe review, but the approval step is not optional:
   Commerce reads registrations from the App Registry.
4. In Commerce Admin: **Stores > Configuration > Adobe Services > Admin UI SDK**
   → Enable = Yes, then **Refresh registrations**.

Code-only redeploys use `aio app deploy --force-deploy`. **Credential or service
changes require revoke + full re-approval**, and revoking un-publishes the app —
do not do it casually on a live tenant.

Required Developer Console services: I/O Management API, App Builder Data
Services, I/O Events, Adobe I/O Events for Adobe Commerce, and the Adobe Commerce
as a Cloud Service API.

## Known gaps, stated rather than hidden

- **Five legacy GraphQL fields have unknown provenance.** `is_promo`,
  `promo_image`, `is_with_cms_block`, `custom_redirect` appear in the legacy
  `schema.graphqls` but not in `db_schema.xml`. They are carried as optional
  passthrough fields and must be confirmed against the live database before
  go-live. `cms_page_identifier` is derived from `cms_page_id`.
- **App Builder action as an API Mesh source is undocumented by Adobe.** It
  should work; the fallback is a programmatic `fetch` resolver.
- **ACL is coarse.** The legacy module had 6 nested ACL resources. Per-app nested
  ACL (`aclProtected`) is Admin UI SDK V2 only, and V2 is PaaS-only today.
- **Store scope is not supplied by the platform.** V1 `sharedContext` carries only
  `imsToken` and `imsOrgId`. The admin SPA must pass `storeCode` explicitly.
- **Database backups are "best-effort" by Adobe's own wording.** An export job is
  required before this holds production data.
