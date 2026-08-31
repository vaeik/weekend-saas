# Making category URLs work (`/women`, `/shoes/sneakers`)

## Why they 404 today

Creating a category in Commerce creates **data**, not a page. The storefront is
Edge Delivery Services — a separate platform that serves pages from the content
source (da.live). It never reads Magento's `url_rewrite` table, so a category's
`url_path` means nothing to it.

Evidence from this site:

| URL | Result | Meaning |
|---|---|---|
| `/products/geox-cloud-step-cfg-1/WK-CFG-001` | 200 | PDP works |
| `/products/total-nonsense/XYZ999` | 200 | works for a product that doesn't exist → it's a **wildcard mapping** to one template |
| `/search.plain.html` | 200 | `/search` is a real authored page |
| `/women.plain.html` | 404 | **no page, no mapping** for categories |

## The approach Adobe recommends

Not folder mapping. Adobe's own guidance is that folder mapping "is rarely the
right tool" where SEO matters — and for category pages it does. The supported
pattern is **one authored page per category** carrying the `product-list-page`
block, with the Commerce category path in its `urlPath` parameter.

Our block already implements it (`blocks/product-list-page/product-list-page.js`):

```js
const config = readBlockConfig(block);
// ...
{ attribute: 'categoryPath', eq: config.urlpath }
```

## Steps

For each category below, in **https://da.live/#/vaeik/weekend-saas**:

1. Create a new document at the **page path** (left column).
   Nested paths need the folder first: create a `shoes` folder, then `sneakers`
   inside it.
2. In the document, insert a **two-row table**:
   - Row 1, single cell: `product-list-page`
   - Row 2: `urlPath` | `<value from the right column>`
3. **Preview**, then **Publish**.

> ⚠️ **No leading slash on the value.** Adobe's docs show `/women/dresses`, but
> verified against this instance: `categoryPath: "women"` returns 46 products,
> `"/women"` returns **0**. Use the value exactly as listed.

| Page path (the URL you want) | `urlPath` value | Products |
|---|---|---|
| `/women` | `women` | 46 |
| `/men` | `men` | 49 |
| `/kids` | `kids` | 25 |
| `/sport` | `sport` | 16 |
| `/accessories` | `accessories` | 34 |
| `/accessories/bags` | `accessories/bags` | 12 |
| `/accessories/socks` | `accessories/socks` | 16 |
| `/sale` | `sale` | 28 |
| `/new-arrivals` | `new-arrivals` | 31 |
| `/shoes` | `shoes` | 70 |
| `/shoes/sneakers` | `shoes/sneakers` | 26 |
| `/shoes/boots` | `shoes/boots` | 24 |
| `/shoes/sandals` | `shoes/sandals` | 20 |

A page with an **empty** `urlPath` is a search results page — that is exactly
what `/search` already is. Do not blank it on a category page.

## After the pages exist

Drop the search-redirect workaround so links become clean paths:

```bash
# config.json -> public.default
# remove:  "menu-manager-category-path": "/search?filter=categoryPath:{path}"
```

The menu already stores each category's full path (`shoes/sneakers`), so with
that key removed `hrefFor()` emits `/shoes/sneakers` directly — no other change
needed. Menu items are generated from the live category tree by
`menu-manager-app/scripts/rebuild-menu-from-catalog.js`, so if you add or move a
category in Commerce, re-run it and create the matching page.

## Checking it worked

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://menu-manager--weekend-saas--vaeik.aem.page/shoes/sneakers
```

200 with products = done. 404 = the page isn't published yet.
