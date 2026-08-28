const { ok, fromError } = require('../../lib/http');
const { requireAdmin } = require('../../lib/auth');
const { build } = require('../../lib/logger');

/**
 * Read-only catalog lookups for the admin pickers: the category tree (and, when
 * a source is available, CMS pages) so the editor can pick a real category
 * instead of typing a raw id.
 *
 * Categories come from the Catalog Service GraphQL (`categories(ids:[...])`,
 * `CategoryView` type — note `urlPath`, camelCase). We walk root 2 → two levels,
 * which mirrors the legacy MenuOrganizer picker depth (MAX_CATEGORY_LEVEL).
 *
 * CMS pages: the storefront GraphQL exposes only `cmsPage(identifier:)`, no
 * list-all query, so `cmsPages` is empty until a REST-admin source is wired
 * against a populated instance. The shape is kept so the UI can light up a CMS
 * picker the moment that list is non-empty.
 */

async function fetchCategories (params, logger) {
  const endpoint = params.COMMERCE_ENDPOINT;
  if (!endpoint) return [];
  const headers = { ...JSON.parse(params.COMMERCE_HEADERS || '{}'), 'content-type': 'application/json' };
  const q = (ids) => fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: `{categories(ids:[${ids.map((i) => `"${i}"`).join(',')}]){id name urlPath children}}`
    })
  }).then((r) => r.json()).then((j) => {
    if (j.errors) logger?.warn(`category query errors: ${JSON.stringify(j.errors)}`);
    return j.data?.categories || [];
  });

  const [root] = await q(['2']);
  if (!root) return [];
  const out = [];
  const level1 = await q((root.children || []).map(String));
  for (const c of level1) {
    out.push({ id: Number(c.id), urlPath: c.urlPath || '', label: c.name.trim(), depth: 0 });
    const level2 = c.children?.length ? await q(c.children.map(String)) : [];
    for (const s of level2) {
      out.push({ id: Number(s.id), urlPath: s.urlPath || '', label: s.name.trim(), depth: 1 });
    }
  }
  return out;
}

async function main (params) {
  const logger = build('catalog-list', params);
  try {
    requireAdmin(params);
    let categories = [];
    try {
      categories = await fetchCategories(params, logger);
    } catch (e) {
      // A catalog outage must not break the editor — fall back to manual entry.
      logger.error(`category fetch failed: ${e.message}`);
    }
    return ok({ categories, cmsPages: [] });
  } catch (e) { return fromError(e, logger); }
}
exports.main = main;
