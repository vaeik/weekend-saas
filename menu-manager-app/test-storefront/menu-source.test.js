import { buildNavList, hrefFor, fetchMenu, applyMenuManagerNav } from '../../blocks/header/menu-source.js';

// The exact payload shape flattenForStorefront() emits, so this test breaks if
// the two ever drift apart.
const ITEMS = [
  { item_id: 'sievietem', parent_id: null, level: 1, position: 0, title: 'Sievietēm', url_type: 2, category_id: 11, category_url_key: 'sievietem', is_active: true },
  { item_id: 'apavi', parent_id: 'sievietem', level: 2, position: 0, title: 'Apavi', url_type: 2, category_id: 111, category_url_key: 'sievietem/apavi', is_active: true },
  { item_id: 'zabaki', parent_id: 'apavi', level: 3, position: 0, title: 'Zābaki', url_type: 2, category_id: 1111, category_url_key: 'sievietem/apavi/zabaki', is_active: true },
  { item_id: 'promo', parent_id: 'sievietem', level: 2, position: 1, title: 'Jaunā kolekcija', url_type: 0, url: '/jauna', advertisement: '/media/aw26.jpg', advertisement_link: '/jauna', is_active: true },
  { item_id: 'outlet', parent_id: null, level: 1, position: 1, title: 'Outlet', url_type: 0, url: '/outlet', is_active: true },
  { item_id: 'about', parent_id: null, level: 1, position: 2, title: 'Par mums', url_type: 1, cms_page_identifier: 'about-us', is_active: true }
];

describe('hrefFor', () => {
  test('category items use the snapshot url key', () => {
    expect(hrefFor({ url_type: 2, category_url_key: 'sievietem/apavi' })).toBe('/sievietem/apavi');
  });
  test('a category with no synced snapshot yields no link rather than a broken one', () => {
    expect(hrefFor({ url_type: 2, category_id: 9, category_url_key: null })).toBeNull();
  });
  test('categoryPathTemplate routes category items through a custom pattern', () => {
    expect(hrefFor(
      { url_type: 2, category_url_key: 'office/pins' },
      { categoryPathTemplate: '/search?filter=categoryPath:{path}' },
    )).toBe('/search?filter=categoryPath:office/pins');
  });
  test('cms pages use the identifier', () => {
    expect(hrefFor({ url_type: 1, cms_page_identifier: 'about-us' })).toBe('/about-us');
  });
  test('absolute urls are left alone, relative ones are root-linked', () => {
    expect(hrefFor({ url_type: 0, url: 'https://x.com/a' })).toBe('https://x.com/a');
    expect(hrefFor({ url_type: 0, url: '/outlet' })).toBe('/outlet');
  });
});

describe('buildNavList', () => {
  test('reassembles the flat payload into the nested ul the header expects', () => {
    const ul = buildNavList(ITEMS);
    expect(ul.tagName).toBe('UL');
    const roots = [...ul.children];
    expect(roots.map((li) => li.querySelector(':scope > a,:scope > span').textContent))
      .toEqual(['Sievietēm', 'Outlet', 'Par mums']);

    const sub = roots[0].querySelector(':scope > ul');
    expect([...sub.children].map((li) => li.querySelector(':scope > a').textContent))
      .toEqual(['Apavi', 'Jaunā kolekcija']);

    const deep = sub.querySelector(':scope > li > ul > li > a');
    expect(deep.textContent).toBe('Zābaki');
    expect(deep.getAttribute('href')).toBe('/sievietem/apavi/zabaki');
  });

  test('the label is the FIRST child node — setupSubmenu reads childNodes[0]', () => {
    const li = buildNavList(ITEMS).children[0];
    expect(li.childNodes[0].textContent).toBe('Sievietēm');
  });

  test('renders the promo image inside its item', () => {
    const promo = buildNavList(ITEMS).querySelector('.nav-promo');
    expect(promo.tagName).toBe('A');
    expect(promo.getAttribute('href')).toBe('/jauna');
    expect(promo.querySelector('img').getAttribute('src')).toBe('/media/aw26.jpg');
  });

  test('an unlinkable item still renders as text rather than vanishing', () => {
    const ul = buildNavList([{ item_id: 'x', parent_id: null, position: 0, title: 'No link', url_type: 0 }]);
    expect(ul.children[0].childNodes[0].tagName).toBe('SPAN');
    expect(ul.children[0].textContent).toBe('No link');
  });

  test('sorts by position even if the payload arrives out of order', () => {
    const shuffled = [ITEMS[4], ITEMS[5], ITEMS[0]];
    const labels = [...buildNavList(shuffled).children].map((li) => li.textContent.slice(0, 4));
    expect(labels[0]).toBe('Siev');
  });
});

describe('fetchMenu — must never break the nav', () => {
  const base = { endpoint: 'https://mesh.example/graphql', identifier: 'main' };

  test('returns null when unconfigured', async () => {
    expect(await fetchMenu({})).toBeNull();
    expect(await fetchMenu({ endpoint: base.endpoint })).toBeNull();
  });

  test('returns null on a non-ok response', async () => {
    expect(await fetchMenu({ ...base, fetchImpl: async () => ({ ok: false, status: 503 }) })).toBeNull();
  });

  test('returns null on GraphQL errors', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ errors: [{ message: 'boom' }] }) });
    expect(await fetchMenu({ ...base, fetchImpl })).toBeNull();
  });

  test('returns null when the network throws', async () => {
    const fetchImpl = async () => { throw new Error('offline'); };
    expect(await fetchMenu({ ...base, fetchImpl })).toBeNull();
  });

  test('returns null on an empty menu rather than blanking the nav', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ data: { scandiwebMenu: { items: [] } } }) });
    expect(await fetchMenu({ ...base, fetchImpl })).toBeNull();
  });

  test('issues a cacheable GET inside the mesh 2048-character limit', async () => {
    let seen;
    const fetchImpl = async (url, init) => {
      seen = { url, method: init.method };
      return { ok: true, json: async () => ({ data: { scandiwebMenu: { items: ITEMS } } }) };
    };
    const menu = await fetchMenu({ ...base, fetchImpl });
    expect(menu.items).toHaveLength(6);
    expect(seen.method).toBe('GET');
    expect(seen.url.length).toBeLessThan(2048);
  });
});

describe('applyMenuManagerNav', () => {
  const mkNav = () => {
    const el = document.createElement('div');
    el.className = 'nav-sections';
    el.innerHTML = '<div class="default-content-wrapper"><ul><li>Authored nav</li></ul></div>';
    return el;
  };

  test('replaces the authored nav when the menu resolves', async () => {
    const nav = mkNav();
    const fetchImpl = async () => ({ ok: true, json: async () => ({ data: { scandiwebMenu: { items: ITEMS, css_class: 'main-nav' } } }) });
    const applied = await applyMenuManagerNav(nav, { endpoint: 'https://m/graphql', identifier: 'main', fetchImpl });
    expect(applied).toBe(true);
    expect(nav.dataset.menuSource).toBe('menu-manager');
    expect(nav.classList.contains('main-nav')).toBe(true);
    expect(nav.textContent).not.toMatch(/Authored nav/);
    expect(nav.querySelectorAll('.default-content-wrapper > ul > li')).toHaveLength(3);
  });

  test('LEAVES the authored nav untouched when the menu fails', async () => {
    const nav = mkNav();
    const fetchImpl = async () => { throw new Error('down'); };
    const applied = await applyMenuManagerNav(nav, { endpoint: 'https://m/graphql', identifier: 'main', fetchImpl });
    expect(applied).toBe(false);
    expect(nav.textContent).toMatch(/Authored nav/);
    expect(nav.dataset.menuSource).toBeUndefined();
  });

  test('is a no-op when not configured, so the block is safe to ship today', async () => {
    globalThis.__cfg = {};
    const nav = mkNav();
    expect(await applyMenuManagerNav(nav)).toBe(false);
    expect(nav.textContent).toMatch(/Authored nav/);
  });
});
