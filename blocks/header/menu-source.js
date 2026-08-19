/**
 * Menu Manager source for the header block.
 *
 * Replaces only the CONTENT of `.nav-sections` — the nested `<ul>` DOM that the
 * existing header decoration already understands. Everything downstream
 * (setupSubmenu, nav-drop, hover/click handlers, all of header.css) is untouched.
 *
 * Falls back silently to the authored /nav fragment when the Menu Manager is not
 * configured, unreachable, or returns nothing. The nav is above the fold on every
 * page — it must never be the thing that breaks the site.
 */
import { getConfigValue } from '@dropins/tools/lib/aem/configs.js';
import { rootLink } from '../../scripts/commerce.js';

const URL_TYPE = { LINK: 0, CMS_PAGE: 1, CATEGORY: 2 };
const TIMEOUT_MS = 2000;

/**
 * Turn one flat item into an href.
 * Category items use the url key kept fresh by the category event handler, so
 * the storefront never calls Commerce to resolve a category id.
 */
export function hrefFor(item, opts = {}) {
  switch (item.url_type) {
    case URL_TYPE.CATEGORY: {
      if (!item.category_url_key) return null;
      // Some storefronts have no per-category page (e.g. a demo backend whose
      // categories are only browsable through search). `categoryPathTemplate`
      // (from the `menu-manager-category-path` config) lets the site route
      // category items through a pattern such as
      // `/search?filter=categoryPath:{path}`. Unset, links stay clean `/urlKey`.
      return opts.categoryPathTemplate
        ? rootLink(opts.categoryPathTemplate.replace('{path}', item.category_url_key))
        : rootLink(`/${item.category_url_key}`);
    }
    case URL_TYPE.CMS_PAGE:
      return item.cms_page_identifier ? rootLink(`/${item.cms_page_identifier}`) : null;
    case URL_TYPE.LINK:
    default:
      if (!item.url) return null;
      return /^https?:\/\//i.test(item.url) ? item.url : rootLink(item.url);
  }
}

/**
 * Build the nested <ul> the header expects from the FLAT payload.
 *
 * The payload is flat because API Mesh caps query depth at 6 — reassembling the
 * tree is the storefront's job, and this is where it happens.
 *
 * Shape produced (matches authored nav content exactly):
 *   <ul><li><a>Label</a><ul><li><a>Child</a></li></ul></li></ul>
 * setupSubmenu() reads childNodes[0].textContent for the submenu title, so the
 * anchor must be the first child.
 */
export function buildNavList(items, doc = document, opts = {}) {
  const roots = [];
  const childrenOf = new Map();

  items.forEach((i) => {
    const key = i.parent_id == null ? '__root__' : String(i.parent_id);
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key).push(i);
  });
  (childrenOf.get('__root__') || []).forEach((i) => roots.push(i));

  // The action already returns depth-first order, but a menu edited mid-flight
  // can arrive unsorted — sorting here keeps rendering deterministic.
  const sortFn = (a, b) => (a.position ?? 0) - (b.position ?? 0);

  const buildList = (nodes, depth) => {
    if (!nodes.length) return null;
    const ul = doc.createElement('ul');
    [...nodes].sort(sortFn).forEach((item) => {
      const li = doc.createElement('li');

      const href = hrefFor(item, opts);
      const label = href ? doc.createElement('a') : doc.createElement('span');
      if (href) label.href = href;
      label.textContent = item.title;
      if (item.item_class) li.className = item.item_class;
      li.append(label);

      if (item.advertisement) {
        // Promo slot. Kept as a plain <img> inside the li so header.css can
        // target it without the header block needing to know it exists.
        const img = doc.createElement('img');
        img.src = item.advertisement;
        img.alt = item.title;
        img.loading = 'lazy';
        img.className = 'nav-promo-image';
        const wrap = item.advertisement_link ? doc.createElement('a') : doc.createElement('div');
        if (item.advertisement_link) wrap.href = item.advertisement_link;
        wrap.className = 'nav-promo';
        wrap.append(img);
        li.append(wrap);
      }

      const kids = childrenOf.get(String(item.item_id)) || [];
      const sub = buildList(kids, depth + 1);
      if (sub) li.append(sub);

      ul.append(li);
    });
    return ul;
  };

  return buildList(roots, 1);
}

/** Fetch the menu through API Mesh. Returns null on any failure — never throws. */
export async function fetchMenu({
  endpoint, identifier, storeCode, maxLevel = 4, fetchImpl,
} = {}) {
  if (!endpoint || !identifier) return null;
  // Resolved lazily, not as a default parameter: a default of `fetch` is
  // evaluated on every call and throws a ReferenceError wherever fetch is
  // absent (SSR, tests) BEFORE the guards above can return cleanly.
  const doFetch = fetchImpl || window.fetch;
  if (typeof doFetch !== 'function') return null;

  const query = `query ScandiwebMenu($identifier:String!,$maxLevel:Int,$storeCode:String){
    scandiwebMenu(identifier:$identifier,maxLevel:$maxLevel,storeCode:$storeCode){
      menu_id title is_active css_class
      items{ item_id parent_id level position title item_class icon url url_type is_active
             category_id category_url_key cms_page_identifier
             advertisement advertisement_link advertisement_second advertisement_second_link
             custom_redirect is_promo promo_image is_with_cms_block }
    }
  }`;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;

  try {
    // GET keeps the request cacheable — API Mesh only caches GET, and only
    // under 2048 characters, which this query stays inside.
    const url = new URL(endpoint);
    url.searchParams.set('query', query.replace(/\s+/g, ' ').trim());
    url.searchParams.set('variables', JSON.stringify({ identifier, maxLevel, storeCode }));

    const res = await doFetch(url.toString(), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller?.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.errors?.length) {
      console.warn('[menu-manager] mesh returned errors', json.errors);
      return null;
    }
    const menu = json.data?.scandiwebMenu;
    return menu?.items?.length ? menu : null;
  } catch (err) {
    console.warn(`[menu-manager] menu fetch failed, falling back to authored nav: ${err.message}`);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Swap `.nav-sections` content for the Menu Manager menu.
 * @returns {boolean} true if the menu was applied, false if the caller should
 *                    keep the authored nav fragment as-is.
 */
export async function applyMenuManagerNav(navSections, opts = {}) {
  if (!navSections) return false;

  const endpoint = opts.endpoint ?? await getConfigValue('menu-manager-endpoint');
  const identifier = opts.identifier ?? await getConfigValue('menu-manager-identifier');
  if (!endpoint || !identifier) return false;

  const menu = await fetchMenu({
    endpoint,
    identifier,
    storeCode: opts.storeCode ?? await getConfigValue('menu-manager-store-code'),
    maxLevel: opts.maxLevel ?? 4,
    fetchImpl: opts.fetchImpl,
  });
  if (!menu) return false;

  const categoryPathTemplate = opts.categoryPathTemplate
    ?? await getConfigValue('menu-manager-category-path');
  const ul = buildNavList(menu.items, opts.document ?? document, { categoryPathTemplate });
  if (!ul || !ul.children.length) return false;

  const wrapper = navSections.querySelector('.default-content-wrapper')
    || navSections.appendChild((opts.document ?? document).createElement('div'));
  wrapper.classList.add('default-content-wrapper');
  wrapper.textContent = '';
  wrapper.append(ul);
  if (menu.css_class) navSections.classList.add(menu.css_class);
  navSections.dataset.menuSource = 'menu-manager';
  return true;
}
