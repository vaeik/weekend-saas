# One-time Adobe setup — from nothing to a deployed Menu Manager

Do these in order. Steps 1–3 are the part that is currently blocking you
(`aio console project select` → "No results").

Verified against Adobe's docs, August 2026. Console UI labels are quoted exactly.

---

## 0. Before you start — check it is not just the wrong org

`aio console project select` shows "No results" for two very different reasons.
Rule out the cheap one first:

```bash
aio console where      # what is selected right now
aio console org list   # every org this Adobe account can see
```

- **More than one org listed?** You are probably in the wrong one. `aio console org select`,
  pick the org that owns the ACCS instance, then `aio console project list` again.
- **Correct org, still empty?** Either the project does not exist (→ step 1), or your
  Adobe account is not a **Developer** on a product profile in that org. That second
  case shows an empty list, not an error. Only an Admin Console administrator can
  fix it — you cannot fix it from the CLI.
- **`org list` empty too?** Entitlement problem, not a selection problem. Stop and
  get access before doing anything else.

---

## 1. Create the project (Developer Console UI, not the CLI)

`aio console project create` exists but produces a **blank** project with no
Runtime entitlement and no workspaces. Use the template instead.

1. Go to <https://developer.adobe.com/console>
2. Switch org with the **IMS Org Switcher in the upper right corner** — this is the
   step people miss; the default org is usually not the one you want.
3. **Quick Start** → **Create project from template**
4. Choose **App Builder**
5. Fill in:
   - **Project Title**: `Weekend SaaS — Menu Manager`
   - **App Name**: `weekend-saas-menu-manager` — **cannot be changed later**, so
     do not use a throwaway name
6. Leave **Include Runtime with each workspace** checked (default). Unchecking it
   means no Runtime namespace and nothing will deploy.
7. **Save**

You now have two workspaces: **Stage** and **Production**. Deploy to Stage first;
Production is what the submission/distribution flow uses.

---

## 2. Add the services — to BOTH workspaces

Services are per-workspace. Adding them to Stage does not add them to Production,
and a missing service does not fail the deploy — it fails at runtime with a
confusing auth error, which is much harder to diagnose.

Select a workspace → **Add service** → **API**, and add all five:

| Service | Why this app needs it |
|---|---|
| **App Builder Data Services** | **Required for the Database.** Provides auth between runtime actions and Database storage. Without it `aio-lib-db` fails at runtime |
| **I/O Management API** | Required by `require-adobe-auth` — the shared validator needs the `read_organizations` scope |
| **I/O Events** | The category event subscriptions |
| **Adobe I/O Events for Adobe Commerce** | Delivers Commerce events to the app |
| **Adobe Commerce as a Cloud Service** | Category and CMS page lookups for the admin pickers |

Credential type: **OAuth Server-to-Server**. Repeat for the second workspace.

### Why this step is not optional

Adding a service is what CREATES the OAuth Server-to-Server credential. Without
it you get, at the very first database command:

```
Failed to initialize database client: Missing required credentials. Please set
IMS_OAUTH_S2S_CLIENT_ID, IMS_OAUTH_S2S_CLIENT_SECRET, IMS_OAUTH_S2S_ORG_ID,
and IMS_OAUTH_S2S_SCOPES environment variables.
```

Those four values come from the workspace's OAuth S2S credential. After adding
the services, pull them down:

```bash
aio app use -g --overwrite
grep -c IMS_OAUTH_S2S_CLIENT_ID .env      # expect 1
```

If that returns 0, copy them by hand from the credential page in Console
(**Credentials > OAuth Server-to-Server**) into `.env`:

```
IMS_OAUTH_S2S_CLIENT_ID=...
IMS_OAUTH_S2S_CLIENT_SECRET=...
IMS_OAUTH_S2S_ORG_ID=...@AdobeOrg
IMS_OAUTH_S2S_SCOPES=["...","..."]
```

`IMS_OAUTH_S2S_SCOPES` is a JSON array — copy the scope list verbatim from that
page rather than typing it. `.env` is gitignored; never commit these.

---

## 3. Point the CLI at it

```bash
cd ~/Sites/_scandiweb/SAAS/menu-manager-app

aio login
aio console org select        # the org from step 1
aio console project select    # now lists "Weekend SaaS — Menu Manager"
aio console workspace select  # Stage

aio app use --workspace Stage # writes .env and .aio — both gitignored
```

Sanity check before going further:

```bash
aio console where             # org / project / workspace all populated
aio runtime namespace get     # proves the Runtime namespace exists
```

---

## 4. Deploy

```bash
npm install
npm test                      # 60 tests, no Adobe access needed
npm run lint
aio app deploy
```

**Provision the database BEFORE the first deploy** — one command, once per
workspace:

```bash
aio app db provision --region emea
```

Declarative `auto-provision` is documented but the config schema
(`@adobe/aio-cli-lib-app-config` 4.2.0) requires `packages` inside every
`runtimeManifest`, so an `application:` block containing only `database:` fails
validation with `must have required property 'packages'`. The explicit command
sidesteps that and writes the config in whatever shape the tooling expects.

**Region is a data-residency decision, not a performance one.** `emea` keeps menu
data in the EU, which is the right default for a Latvian retailer. If you change
it, change it in `app.config.yaml` **and** `AIO_DB_REGION` — a mismatch silently
resolves to a different, empty database.

**Watch the deploy output for these lines:**

```
[post-app-deploy] index ready: menus.menus_identifier_unique
[post-app-deploy] index ready: menuItems.items_menu_position
... six in total
```

If they are missing, the app deployed but the collections are unindexed and the
uniqueness guarantee on `identifier` does not exist.

---

## 5. Make it appear in Commerce Admin

**Deploying is not enough.** Commerce reads registrations from the App Registry,
and local testing is PaaS-only, so there is no shortcut on ACCS.

1. Deploy to the **Production** workspace (`aio app use --workspace Production && aio app deploy`)
2. In Developer Console, submit the app for approval
3. An **org admin** approves it at <https://exchange.adobe.com/manage> — private
   distribution, so no Adobe review, but the approval itself is not optional
4. In Commerce Admin: **Stores > Configuration > Adobe Services > Admin UI SDK**
   → **Enable Admin UI SDK** = **Yes**
   → **Enable local testing** = **No** (mandatory on ACCS)
   → click **Refresh registrations**
5. **Scandiweb > Menu Manager** appears in the Admin menu

Later code-only redeploys: `aio app deploy --force-deploy`.
**Credential or service changes need revoke + full re-approval, and revoking
un-publishes the app** — do not do that casually on a live tenant.

---

## 6. Subscribe to the category events

Check what the tenant actually supports first — do not trust the names blind:

```
GET /rest/all/V1/eventing/supportedList
```

Then either Commerce Admin → **System > Events > Events Subscriptions**, or POST
the two payloads in `commerce/event-subscriptions.json` to
`/rest/<store_view_code>/V1/eventing/eventSubscribe`.

Note `observer.catalog_category_save_after` currently only refreshes the category
snapshot; it does not change item status, because that observer is
`disabled="true"` in Weekend's live `events.xml`. That is plan question Q1.

---

## 7. API Mesh

```bash
aio plugins:install @adobe/aio-cli-plugin-api-mesh
aio runtime namespace get                       # copy the namespace
# replace {NAMESPACE} in mesh/mesh.json, and set the shared secret
aio api-mesh:create mesh/mesh.json
```

---

## 8. Turn on the storefront

The storefront code is already merged and inert. Set the endpoint in the repo
root `config.json`:

```json
"menu-manager-endpoint": "https://graph.adobe.io/api/<mesh-id>/graphql",
"menu-manager-identifier": "main",
"menu-manager-store-code": "default"
```

Until that endpoint is set, `applyMenuManagerNav()` is a no-op and the storefront
uses the authored `/nav` fragment exactly as it does today. It also falls back to
that fragment if the mesh errors, times out, or returns an empty menu — the nav is
above the fold on every page and must never be the thing that breaks the site.
