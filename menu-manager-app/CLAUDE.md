# Menu Manager on Adobe App Builder — working context

Read this before touching anything here. It is the handoff from the Cowork
session that built it (Aug 2026) and exists because several of the decisions below
look arbitrary until you know what they cost to discover.

**Ticket:** EVO-217 · **Client:** Weekend Shoes · **Plan:** `Menu_Manager_App_Builder_Build_Plan.md`
(also in the Claude project "Weekend Shoes") · **Setup:** `SETUP.md`

> ▶ **START HERE — `PHASE3-V2.md`.** A real ACCS instance now exists
> (`Scandiweb Sandbox`, `EGD3J2kAQ3pgLrtoWaoCJR`, org `scandiwebptrsd`) and its
> Commerce Admin has the Admin UI SDK enabled. App Management **found** this app
> but rejects it as "not compatible" because it is on the **V1** contract. The
> remaining work — moving to the **Admin UI SDK V2 / App Management** contract so
> the menu appears in the Admin — is fully scoped in `PHASE3-V2.md` (validated
> `app.commerce.config.ts` seeded; two gates identified: a React 19 web-src
> frontend and the `AIO_COMMERCE_AUTH_IMS_*` technical-account credentials).

## What this is

`ScandiPWA/MenuOrganizer` (80 files, 3 MySQL tables, 13 adminhtml controllers,
2 observers, 1 GraphQL query) rebuilt as an out-of-process App Builder app for
Adobe Commerce as a Cloud Service, because ACCS has a locked core: no plugins,
no observers, no preferences, no custom DB tables.

## State

| | |
|---|---|
| Phase 1 Foundation | ✅ deployed |
| Phase 2 Data layer | ✅ deployed + **verified against the real DB (20/20)** |
| Storefront read path | ✅ deployed + verified returning the seeded menu |
| API Mesh | ✅ created; end-to-end query pending |
| Category event consumer | ✅ coded, ❌ not subscribed yet |
| **Phase 3 React admin SPA** | ❌ **not started — the big one, ~160 h** |
| MySQL importer | ❌ blocked on the DB dump (gate G2) |
| Nightly reconciliation sweep | ❌ not started |

- 85 unit tests (`npm test`) · 18 storefront tests (`npm run test:storefront`)
- 20 integration assertions against the real database (`npm run smoke`)
- Deployed to workspace **Stage** in org **Scandiweb Partner Sandbox**
- Namespace `1951857-weekendmenumanager-stage`, database region **emea**
- Mesh `b5464f6c-b1d1-4d34-9565-4be237bf00ee`

## Verified working (Aug 2026)

The full storefront chain returns the seeded menu:

```bash
export $(grep -E '^STOREFRONT_SHARED_SECRET=' .env | xargs)
curl -s -H "x-mm-secret: $STOREFRONT_SHARED_SECRET" \
  "https://1951857-weekendmenumanager-stage.adobeioruntime.net/api/v1/web/menu-manager/storefront-menu-get?identifier=main"
```

403 without the secret, 200 + the 50-item flat payload with it.

Historical note, because it will happen again to the next action you add: this
returned **HTTP 500** until the IMS S2S credentials were declared as action
`inputs` in `ext.config.yaml`. A deployed action cannot see `.env` through
`process.env`. Every new action that touches the database needs those five inputs
(4 × `IMS_OAUTH_S2S_*` + `AIO_DB_REGION`) or it will 500 while working locally.

## Decisions and WHY (do not undo these casually)

**Database is the system of record; State is only a cache.** State caps TTL at
365 days with no infinite option, has no secondary indexes, and its `list()` is
documented as able to skip or duplicate keys mid-iteration. Menus are permanent
relational data. `MENU_REPOSITORY` in `.env` is the seam; `repository/index.js` is
the only file that knows which backend is live.

**The storefront payload is FLAT, never nested.** API Mesh caps
`queryConfig.maxDepth` at 6 and a recursive `children` field burns ~2 levels per
menu tier. `flattenForStorefront()` emits `parent_id` + `level`; the EDS header
block rebuilds the tree. Field names are the **legacy snake_case GraphQL names**
so the `scandiwebMenu` contract is unchanged.

**Mesh uses a programmatic `fetch` resolver, not the JsonSchema source handler.**
Adobe documents no sample of an App Builder action as a Mesh source; it does
publish a `globalThis.fetch()` resolver example. The shared secret lives in
`mesh/secrets.yaml` as `context.secrets.MM_SECRET` — never forwarded from the
caller, which would let anyone supply their own.

**Foreign keys became application code.** The three FKs crossing into Commerce
(`category_id`, `cms_page_id`, `store_id`) are event-driven reconciliation now;
`menu_id`'s CASCADE is reimplemented in `deleteMenu`/`deleteItem`. All tested.

**`SYNC_ON_SAVE = false`** in `actions/events/category-changed.js`.
`catalog_category_save_after` is `disabled="true"` in Weekend's live `events.xml`,
so the ACCS version preserves that exactly. A test asserts current behaviour, so
flipping it fails loudly rather than silently. This is plan question **Q1**.

**Events are assumed hostile.** At-least-once, duplicates expected, order not
guaranteed, retries stop at 24h, no dead-letter queue. The handler dedupes on
event id in State (48h TTL) and returns 500 on failure so Adobe retries — 429 and
5xx are the only codes it retries.

## Platform gotchas that cost real time

These are not documented anywhere useful. Each one broke a deploy.

1. **`aio app db provision` writes an `application.runtimeManifest.database`
   block with no `packages`, which `aio app deploy` then rejects.** Adobe bug for
   extension-only apps. `app.config.yaml` carries `packages: {}` to satisfy the
   schema. If you re-run provision, put it back.
2. **Real DocumentDB `findOne` THROWS `Document not found`** where a Mongo driver
   returns null. Normalised in `findOneOrNull()`. `test/fake-db.js` now throws too
   — **do not "fix" the fake back to returning null**, that divergence hid a bug
   that would have 500'd every menu creation.
3. **`dbLib.init({region})` is not enough.** Needs `{ow:{namespace}, region, token}`,
   and the token must be minted by the app from the S2S credential
   (`lib/ims-token.js`). `require-adobe-auth` validates the *caller*, it does not
   give the action a token.
4. **`init()` returns a `DbBase`.** `collection()` only exists after `connect()`.
5. **Action `inputs` are the only way to get env into a deployed action.**
   `process.env` does not contain `.env`. Omitting a credential input yields a
   500 that works fine locally.
6. **`aio app use` does not write `IMS_OAUTH_S2S_*`.** Copy them by hand from the
   Console OAuth Server-to-Server credential page.
7. **`aio console project create -n` rejects hyphens and names ≥20 chars.** Undocumented.
8. **Admin UI SDK V2 and local testing are both PaaS-only.** ACCS is on the
   deprecated V1 contract, and there is no localhost dev loop — every iteration is
   a deploy. Measured deploy time: **~36 s**, which is workable.
9. **React Spectrum S2 needs Adobe's build pipeline.** Under plain Vite its
   precompiled styles break (missing `--lightningcss-light/-dark`); layout goes
   wrong with no build error. Build the admin UI inside the real `web-src`
   scaffold, not a side project. See `spikes/tree-editor/FINDINGS.md`.

## The testing rule that matters

Unit tests use an in-memory fake I wrote, so **they cannot catch platform
divergence** — and three separate bugs today lived in `repository/index.js` and
the fake's contract, invisible to 85 green tests. `npm run smoke` found the worst
one in 20 seconds.

**Run `npm run smoke` against a real workspace before calling any change done.**

## Commands

```bash
npm test              # 85 unit tests, no Adobe access needed
npm run test:storefront   # 18 jsdom tests against ../blocks/header/menu-source.js
npm run test:all
npm run lint
npm run smoke         # 20 assertions vs the REAL database — self-cleaning
npm run seed          # weekend.lv's real nav, 50 items, 3 levels (--dry-run / --remove)
aio app deploy
node hooks/post-app-deploy.js    # re-create the 6 DB indexes
```

## Storefront integration

Lives in the EDS repo, not here: `../blocks/header/menu-source.js`, plus 2 lines
in `../blocks/header/header.js`. It replaces only the contents of
`.nav-sections`, so all 892 lines of `header.css` and the existing submenu
decoration keep working. **Fail-safe:** unconfigured, unreachable, erroring or
empty all fall back to the authored `/nav` fragment. `menu-manager-endpoint` in
`../config.json` is the switch.

`../menu-manager-app/` is in `../.hlxignore` — without that, AEM Code Sync would
publish this app's source on the storefront domain.

## Next, in order

1. Query the mesh end to end (see "Storefront integration"), then push the branch
   and verify the nav on `menu-manager--weekend-saas--vaeik.aem.page`.
3. Subscribe the two category events (`commerce/event-subscriptions.json`).
4. **Phase 3: the V2 / App Management app — see `PHASE3-V2.md`.** This is now the
   critical path: App Management on GA ACCS only accepts the **V2** contract
   (`commerce/backend-ui/2` + `commerce/extensibility/1`), so the menu will not
   appear until the app is migrated. R1 is resolved — `TreeView` +
   `useDragAndDrop` works — and the admin UI can be ported from
   `scripts/admin-server.js` into the React 19 `web-src`.

## Governance flag

Everything is in **Scandiweb Partner Sandbox**. If that is not the org owning the
Weekend ACCS tenant, the Admin UI SDK registration will never appear in Commerce
Admin from here, and the Console setup must be repeated in the right org. Fine for
measuring; not where production is built.

## Open questions

- **Q1** Should `catalog_category_save_after` sync item status? Currently disabled in prod.
- **Q2** Are `is_promo`, `promo_image`, `is_with_cms_block`, `custom_redirect` live?
  They are in the legacy `schema.graphqls` but **not** in `db_schema.xml` — provenance
  unknown, carried as optional passthrough. Confirm against the live DB before go-live.
- **Q3** How many menus/items/store views actually exist? (gate G2, blocks the importer)
- **Q4** Is the coarse ACL acceptable until Admin UI SDK V2 reaches ACCS?
