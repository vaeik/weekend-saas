# Phase 3 — migrate Menu Manager to Admin UI SDK V2 / App Management

> ## ✅ UPDATE 2026-08-28 — the V2 migration is DONE and installed.
> The app was migrated to the V2 contract, deployed, and **installed into the
> ACCS Commerce Admin via App Management** (Associate → Install → *Enable Admin
> UI SDK* + *Register Extension* both green). The **Scandiweb → Menu Manager**
> menu appears in the admin nav and its page route loads. Both gates from the
> original plan turned out non-blocking: React 19 was already present, and the
> `installation` action's IMS creds were handled by the build's credential sync.
>
> **What's actually in the repo now:** `commerce/backend-ui/2` (React 19 +
> Spectrum S2 SPA under `src/commerce-backend-ui-2/web-src`) and
> `commerce/extensibility/1` (App Management actions), both wired into
> `app.config.yaml` alongside the kept V1 extension.
>
> **✅ The real admin UI is ported** (replacing the scaffold "Welcome" page):
> - `pages/main-page.tsx` — loads the `main` menu via `menu-list`, its items via
>   `item-list`, renders the tree, and wires add / edit / delete / move-up /
>   move-down. Loading / error / empty states + success/error toasts.
> - `components/item-dialog.tsx` — the add/edit form (title, link type →
>   URL/category/CMS target, open-in-new-tab, active, identifier, CSS class).
> - `lib/menu-api.ts` — thin client over the deployed actions. Auth is the IMS
>   token from `useIms()` sent as `Authorization: Bearer …`; the runtime already
>   returns `Access-Control-Allow-Origin: *` and answers the OPTIONS preflight, so
>   **no CORS shim on the actions was needed** (verified against the live Stage
>   endpoint). `lib/types.ts` mirrors the backend domain shapes.
>
> Reorder maps to `item-reorder` (same parent, new index); the domain layer
> re-densifies sibling positions and re-computes levels. Parcel transpiles the TSX
> without type-checking, so run the S2 prop names past the `.d.ts` before a deploy
> — a wrong prop is silently dropped, not a build error. Confirmed live: the
> deployed bundle contains the new UI strings and no longer the scaffold's.
>
> **Only remaining verification:** the SPA renders **only inside the Experience
> Cloud unified shell** — loading the menu-page URL directly throws `Needs to be
> within an iframe`. Check it in a normal admin session (Scandiweb → Menu
> Manager), not by direct URL.
>
> Everything below is the historical scoping that got us here.

---

Status as of 2026-08-28. This is the remaining work to make the Menu Manager
**appear inside the ACCS Commerce Admin**. Everything up to this point is done
and verified.

## Where we are

- **ACCS instance is live** — `Scandiweb Sandbox`, product *Adobe Commerce as a
  Cloud Service*, instance id `EGD3J2kAQ3pgLrtoWaoCJR`, org `scandiwebptrsd`.
  - Admin: `https://na1-sandbox.admin.commerce.adobe.com/EGD3J2kAQ3pgLrtoWaoCJR`
  - GraphQL: `https://na1-sandbox.api.commerce.adobe.com/EGD3J2kAQ3pgLrtoWaoCJR/graphql`
  - **No sample data** — catalog/orders/customers are empty.
- **Admin UI SDK enabled** in the Admin (Stores → Config → Adobe Services →
  Admin UI SDK = Yes).
- The deployed V1 app **is discoverable** from the Admin:
  - *Configure extensions → Manual Extensions Selection* lists
    `1951857-WeekendMenuManager` (Stage). But that tab is **deprecated** and does
    not register a menu on GA ACCS (Admin UI SDK log stays empty).
  - **Apps → App Management → Associate App** finds the project + Stage
    workspace, but rejects it: **"The selected application is not compatible with
    Adobe Commerce."**

## Root cause (plan finding F2)

The app is built for the **V1 contract** (`commerce/backend-ui/1` + a
`registration` action). GA ACCS **App Management** only accepts the **V2 /
App-Management-compatible** app. Both the deprecated manual path and the
supported App Management path fail for this one reason.

## The V2 shape (already reverse-engineered)

`app.commerce.config.ts` (committed alongside this file, validated against
`@adobe/aio-commerce-lib-app@1.10.1`) is the V2 entry point. Running:

```bash
npx @adobe/aio-commerce-lib-app generate all
```

expands it into two extension points:

| Extension point | What it is |
|---|---|
| `commerce/extensibility/1` | Auto-generated **App Management lifecycle actions** — `app-config`, `association`, `installation` (in `.generated/actions/app-management/`). Node 24 runtime. |
| `commerce/backend-ui/2` | The **React 19 + React-Spectrum-S2 admin SPA** (`src/commerce-backend-ui-2/web-src/`, TSX, `createExtensionApp` from `@adobe/aio-commerce-lib-admin-ui/web`). This is the page the menu opens. |

`generate` also rewrites `ext.config.yaml` per extension and adds `pre-app-build`
hooks that run `aio-commerce-lib-app hooks pre-app-build`.

## The two gates before it deploys + associates

1. **React 19 + Spectrum S2 frontend.** The menu opens this SPA. The repo has
   **no `web-src/`** yet, and a stub `react-dom@0.1.0` blocks the scaffold —
   install real `react@19` + `react-dom@19` first. The scaffold gives a
   "Welcome" starter page; the actual work is porting our admin UI (we already
   built one — `scripts/admin-server.js`'s HTML tree editor) into
   React/Spectrum, calling the deployed menu/item actions with the IMS token the
   Admin UI SDK provides in-iframe.
2. **New IMS technical-account credentials.** The generated `installation` action
   requires `AIO_COMMERCE_AUTH_IMS_CLIENT_ID`,
   `AIO_COMMERCE_AUTH_IMS_CLIENT_SECRETS`,
   `AIO_COMMERCE_AUTH_IMS_TECHNICAL_ACCOUNT_ID`,
   `AIO_COMMERCE_AUTH_IMS_TECHNICAL_ACCOUNT_EMAIL`,
   `AIO_COMMERCE_AUTH_IMS_ORG_ID`, `AIO_COMMERCE_AUTH_IMS_SCOPES` — a **different
   credential set** than our `IMS_OAUTH_S2S_*`. The Console OAuth S2S credential
   does not surface `technical_account_id` / `_email` in those four vars, so this
   credential has to be configured (or a technical-account credential added) or
   installation/association fails.

## Step-by-step to finish

1. `nvm install 22.22.2` (or newer) — the `init`/installer wants node ≥22.22.2
   (`generate` itself runs on 22.22.0).
2. `npm install react@^19 react-dom@^19 @adobe/aio-commerce-lib-admin-ui`
   (remove the `react-dom@0.1.0` stub).
3. `npx @adobe/aio-commerce-lib-app generate all` — scaffolds
   `src/commerce-backend-ui-2/web-src` + `src/commerce-extensibility-1`.
4. Add the two extension points to the root `app.config.yaml` (keep the existing
   `application.database` block for the EU DB region and the storefront
   `commerce/backend-ui/1` package if the storefront read path stays on it, or
   fold the actions under V2 — decide during the build).
5. Set the `AIO_COMMERCE_AUTH_IMS_*` credentials in `.env` (gate 2).
6. Port the admin UI into `web-src/src/pages/main-page.tsx`, calling the deployed
   `menu-*` / `item-*` actions.
7. `aio app deploy`.
8. Commerce Admin → **Apps → App Management → Associate App** → pick project +
   Stage → **Associate** (should now succeed) → the **Scandiweb → Menu Manager**
   menu appears.

## Distribution note

This stays **private / first-party** the whole way: App Management associates the
app to *this instance only*, within org `scandiwebptrsd`. Nothing is published to
the public Adobe Exchange marketplace.
