#!/usr/bin/env python3
"""
Replaces the generated placeholder images on every ACCS product with REAL
product photography sourced from Wikimedia Commons (free licences: CC0 /
CC BY / CC BY-SA), matched to each product's type.

Commons requires a descriptive User-Agent or it returns 403.
Each product: add the new image with the image/small_image/thumbnail roles,
then delete the old placeholder entry.

  python3 scripts/set-real-product-images.py [--dry-run] [--limit N]
"""
import urllib.request, urllib.error, json, urllib.parse, base64, re, sys, os, subprocess, random, io
from PIL import Image

EP = "https://na1-sandbox.api.commerce.adobe.com/EGD3J2kAQ3pgLrtoWaoCJR"
BROWSER_UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
              '(KHTML, like Gecko) Chrome/140.0 Safari/537.36')
COMMONS_UA = 'weekend-saas-catalog/1.0 (demo catalog seeding; contact: valerijs.sceglovs@scandiweb.com)'

# SKU prefix -> Commons search terms (kept product-shot oriented)
TERMS = {
    'SNE': ["running shoes", "sneakers shoe", "athletic shoe", "trainer shoe"],
    'BOO': ["leather boots", "hiking boot", "ankle boot", "winter boot"],
    'SAN': ["sandals footwear", "flip flops", "leather sandal"],
    'SPO': ["football boots", "sport shoes", "basketball shoe"],
    'BAG': ["backpack", "duffel bag", "handbag"],
    'SOC': ["socks", "wool socks"],
    'ACC': ["shoe polish", "shoelaces", "shoe insole"],
    'CFG': ["running shoes", "sneakers shoe", "leather boots"],
}

def commons_get(url):
    return urllib.request.urlopen(
        urllib.request.Request(url, headers={'User-Agent': COMMONS_UA}), timeout=45).read()

def search_images(term, n=12):
    q = urllib.parse.urlencode({'action': 'query', 'format': 'json', 'generator': 'search',
        'gsrsearch': f'filetype:bitmap {term}', 'gsrnamespace': 6, 'gsrlimit': n,
        'prop': 'imageinfo', 'iiprop': 'url|extmetadata', 'iiurlwidth': 900})
    d = json.loads(commons_get(f"https://commons.wikimedia.org/w/api.php?{q}"))
    out = []
    for p in (d.get('query', {}).get('pages') or {}).values():
        ii = (p.get('imageinfo') or [{}])[0]
        meta = ii.get('extmetadata') or {}
        lic = (meta.get('LicenseShortName') or {}).get('value', '')
        # free licences only - no NC / ND
        if 'NC' in lic or 'ND' in lic: continue
        url = ii.get('thumburl')
        if not url: continue
        out.append({'title': p['title'][5:], 'license': lic, 'url': url,
                    'artist': re.sub('<[^>]+>', '', (meta.get('Artist') or {}).get('value', ''))[:60]})
    return out

def square(raw):
    """Letterbox onto a white square so the grid stays tidy."""
    im = Image.open(io.BytesIO(raw)).convert('RGB')
    s = max(im.size)
    canvas = Image.new('RGB', (s, s), (255, 255, 255))
    canvas.paste(im, ((s - im.width) // 2, (s - im.height) // 2))
    canvas = canvas.resize((800, 800), Image.LANCZOS)
    b = io.BytesIO(); canvas.save(b, 'JPEG', quality=86)
    return b.getvalue()

def hdrs():
    d = os.path.join(os.path.dirname(__file__), '..')
    t = subprocess.run(['node', '-e', "require('dotenv').config();require('./src/commerce-backend-ui-1/lib/ims-token')"
        ".getServiceToken({}).then(t=>console.log(t))"], cwd=d, capture_output=True, text=True, timeout=120).stdout.strip()
    org = dict(re.findall(r'^([A-Z0-9_]+)=(.*)$', open(os.path.join(d, '.env')).read(), re.M))['IMS_OAUTH_S2S_ORG_ID']
    return {'Authorization': f'Bearer {t}', 'x-gw-ims-org-id': org, 'content-type': 'application/json',
            'User-Agent': BROWSER_UA, 'Accept': 'application/json'}

H = None
def call(m, p, b=None, timeout=120):
    d = json.dumps(b).encode() if b is not None else None
    try:
        r = urllib.request.urlopen(urllib.request.Request(f"{EP}/{p}", data=d, headers=H, method=m), timeout=timeout)
        return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:200].decode('utf8', 'ignore')
    except Exception as e:
        return 'ERR', str(e)[:150]

def main():
    global H
    dry = '--dry-run' in sys.argv
    limit = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else 10**9

    print("building image pool from Wikimedia Commons ...")
    pool, cache = {}, {}
    for key, terms in TERMS.items():
        imgs = []
        for t in terms:
            try: imgs += search_images(t)
            except Exception as e: print(f"  ! {t}: {str(e)[:70]}")
        seen, uniq = set(), []
        for i in imgs:
            if i['url'] in seen: continue
            seen.add(i['url']); uniq.append(i)
        pool[key] = uniq
        print(f"  {key}: {len(uniq)} free-licence images")
    if dry:
        for k, v in pool.items():
            for i in v[:2]: print(f"  {k}: [{i['license']}] {i['title'][:52]}")
        return

    H = hdrs()
    skus = []
    for page in (1, 2):
        st, res = call('GET', f'V1/products?searchCriteria[pageSize]=200&searchCriteria[currentPage]={page}')
        if st != 200:
            print(f"product list failed: {st} {str(res)[:150]}"); return
        skus += [i['sku'] for i in res.get('items', [])]
    # skip configurable child variants (WK-CFG-001-BL38) - they inherit the parent image
    skus = [s for s in skus if not re.match(r'^WK-CFG-\d+-', s)]
    print(f"\n{len(skus)} products to update\n")
    rnd = random.Random(4242)
    ok = fail = 0
    for n, sku in enumerate(skus[:limit], 1):
        key = sku.split('-')[1] if len(sku.split('-')) > 1 else 'SNE'
        cands = pool.get(key) or pool['SNE']
        if not cands: print(f"  [{n}] {sku}: no images for {key}"); fail += 1; continue
        img = cands[(n * 7 + len(sku)) % len(cands)]
        try:
            if img['url'] not in cache:
                cache[img['url']] = base64.b64encode(square(commons_get(img['url']))).decode()
            data = cache[img['url']]
        except Exception as e:
            print(f"  [{n}] {sku}: download failed {str(e)[:60]}"); fail += 1; continue
        st, old = call('GET', f'V1/products/{sku}/media')
        st2, r = call('POST', f'V1/products/{sku}/media', {"entry": {"media_type": "image",
            "label": img['title'][:60], "position": 1, "disabled": False,
            "types": ["image", "small_image", "thumbnail"],
            "content": {"base64_encoded_data": data, "type": "image/jpeg", "name": f"{sku.lower()}-photo.jpg"}}})
        if st2 != 200:
            print(f"  [{n}] {sku}: add failed {st2} {str(r)[:90]}"); fail += 1; continue
        if isinstance(old, list):
            for m in old: call('DELETE', f"V1/products/{sku}/media/{m['id']}")
        ok += 1
        print(f"  [{n}/{len(skus)}] {sku:18s} <- {img['title'][:44]}")
    print(f"\nupdated {ok} | failed {fail}")

main()
