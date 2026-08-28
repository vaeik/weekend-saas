/**
 * Admin UI SDK V2 / App Management config for the Menu Manager.
 *
 * This is the entry point of the V2 contract that Adobe Commerce App Management
 * requires (the V1 `commerce/backend-ui/1` app is rejected as "not compatible"
 * by App Management on GA ACCS — see PHASE3-V2.md).
 *
 * `npx @adobe/aio-commerce-lib-app generate all` expands this into two
 * extension points:
 *   - commerce/extensibility/1  → App Management lifecycle actions
 *                                 (.generated/actions/app-management/*)
 *   - commerce/backend-ui/2     → the React 19 + Spectrum S2 admin SPA (web-src)
 *
 * Validated against @adobe/aio-commerce-lib-app@1.10.1. Menu ids allow only
 * letters, digits, "/", ":" and "_" — no hyphens.
 */
import { defineConfig } from '@adobe/aio-commerce-lib-app/config';

export default defineConfig({
  metadata: {
    id: 'scandiwebmenumanager',
    displayName: 'Scandiweb Menu Manager',
    version: '1.0.0',
    description: 'Storefront navigation menu manager for Weekend Shoes',
  },
  adminUi: {
    menu: {
      id: 'ScandiwebMenuManager::menu_manager',
      label: 'Menu Manager',
      pageTitle: 'Menu Manager',
      description: 'Manage storefront navigation menus',
    },
  },
});
