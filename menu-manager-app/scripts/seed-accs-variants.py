#!/usr/bin/env python3
"""
Adds configurable products (size x colour variants) to the ACCS sandbox.

Requires the `color` and `size` select attributes to exist and be attached to
attribute set 4 (see seed-accs-attributes step in git history).

For each configurable it creates:
  - N simple child variants (one per size x colour), each with its own SKU,
    stock and price, not individually visible
  - the configurable parent, linked to the children via the two attributes

Idempotent: existing SKUs are skipped.
  python3 scripts/seed-accs-variants.py [--limit N] [--dry-run]
"""
import urllib.request, urllib.error, json, re, sys, random, io, base64, os, subprocess
from PIL import Image, ImageDraw

EP = "https://na1-sandbox.api.commerce.adobe.com/EGD3J2kAQ3pgLrtoWaoCJR"
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/140.0 Safari/537.36')
CAT = dict(women=3, men=4, kids=5, sneakers=6, boots=7, sandals=8, sport=9,
           accessories=10, bags=11, socks=12, brands=13, sale=14, new=15)
RGB = {"Black":(28,28,30),"White":(238,238,238),"Navy":(28,45,84),"Grey":(120,124,130),
       "Beige":(214,196,168),"Olive":(96,104,72),"Burgundy":(102,36,52),"Tan":(176,132,92)}
BRANDS=["Nike","Adidas","Puma","New Balance","Reebok","Converse","Vans","Timberland","Ecco","Geox","Salomon","Clarks"]
# (type, gender, models, price range, sizes, colours)
LINES=[("sneakers","women",["Air Flow","Court Classic","Runner Lite","Cloud Step"],(59,149),["37","38","39","40","41"],["Black","White","Navy"]),
       ("sneakers","men",["Trail Runner","Court Pro","Urban Flex","Daily Trainer"],(69,169),["41","42","43","44","45"],["Black","Grey","Olive"]),
       ("boots","women",["Chelsea","Ankle Warm","Winter Guard"],(99,239),["37","38","39","40"],["Black","Tan","Burgundy"]),
       ("boots","men",["Hiker Pro","Snow Trek","Chelsea Classic"],(109,269),["42","43","44","45"],["Black","Tan"]),
       ("sport","women",["Studio Trainer","Running Elite"],(69,179),["37","38","39","40"],["Black","White"]),
       ("sport","men",["Training Shoe","Football Boot"],(79,199),["42","43","44","45"],["Black","Navy"]),
       ("sandals","women",["Summer Slide","Comfort Sandal"],(29,89),["37","38","39","40"],["Beige","Black"]),
       ("kids-sneakers","kids",["Mini Runner","Playground","School Sport"],(35,79),["36","37","38"],["Navy","Grey"])]

def hdrs():
    d=os.path.join(os.path.dirname(__file__),'..')
    t=subprocess.run(['node','-e',"require('dotenv').config();require('./src/commerce-backend-ui-1/lib/ims-token')"
        ".getServiceToken({}).then(t=>console.log(t))"],cwd=d,capture_output=True,text=True,timeout=120).stdout.strip()
    org=dict(re.findall(r'^([A-Z0-9_]+)=(.*)$',open(os.path.join(d,'.env')).read(),re.M))['IMS_OAUTH_S2S_ORG_ID']
    return {'Authorization':f'Bearer {t}','x-gw-ims-org-id':org,'content-type':'application/json',
            'User-Agent':UA,'Accept':'application/json'}

H=None
def call(m,p,b=None,timeout=120):
    d=json.dumps(b).encode() if b is not None else None
    try:
        r=urllib.request.urlopen(urllib.request.Request(f"{EP}/{p}",data=d,headers=H,method=m),timeout=timeout)
        return r.status,json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code,e.read()[:250].decode('utf8','ignore')
    except Exception as e: return 'ERR',str(e)[:150]

def img(name,rgb):
    im=Image.new("RGB",(700,700),(247,247,248)); d=ImageDraw.Draw(im)
    d.rounded_rectangle([70,70,630,630],radius=36,fill=rgb)
    d.ellipse([180,300,520,470],fill=tuple(min(255,c+38) for c in rgb))
    d.rectangle([180,430,520,470],fill=tuple(max(0,c-28) for c in rgb))
    d.text((80,650),name[:44],fill=(60,60,64))
    b=io.BytesIO(); im.save(b,format="JPEG",quality=80); return base64.b64encode(b.getvalue()).decode()

def media(name,rgb,sku):
    return [{"media_type":"image","label":name,"position":1,"disabled":False,
             "types":["image","small_image","thumbnail"],
             "content":{"base64_encoded_data":img(name,rgb),"type":"image/jpeg","name":f"{sku.lower()}.jpg"}}]

def build(limit):
    rnd=random.Random(20260829); out=[]; n=0
    while len(out)<limit:
        for (typ,gender,models,(lo,hi),sizes,colors) in LINES:
            if len(out)>=limit: break
            n+=1; brand=rnd.choice(BRANDS); model=rnd.choice(models)
            base=typ.replace('kids-','')
            name=f"{brand} {model}"
            cats=[CAT[base],CAT[gender]]
            if rnd.random()<0.25: cats.append(CAT['sale'])
            if rnd.random()<0.25: cats.append(CAT['new'])
            out.append(dict(n=n,name=name,brand=brand,typ=base,gender=gender,cats=cats,
                price=round(rnd.uniform(lo,hi),2),sizes=sizes,colors=colors,
                sku=f"WK-CFG-{n:03d}",
                url_key=re.sub(r'[^a-z0-9]+','-',name.lower()).strip('-')+f"-cfg-{n}"))
    return out

def main():
    global H
    limit=20; dry='--dry-run' in sys.argv
    if '--limit' in sys.argv: limit=int(sys.argv[sys.argv.index('--limit')+1])
    items=build(limit)
    tv=sum(len(p['sizes'])*len(p['colors']) for p in items)
    print(f"{len(items)} configurables, {tv} variants total")
    if dry:
        for p in items[:6]:
            print(f"  {p['sku']} {p['name']:26s} {len(p['sizes'])}x{len(p['colors'])}={len(p['sizes'])*len(p['colors']):2d} EUR{p['price']:7.2f} cats={p['cats']}")
        return
    H=hdrs()
    COL=json.load(open('/tmp/opt_color.json')); SIZ=json.load(open('/tmp/opt_size.json'))
    made=skipped=failed=0
    for idx,p in enumerate(items,1):
        st,_=call('GET',f"V1/products/{p['sku']}",timeout=40)
        if st==200: skipped+=1; print(f"[{idx}/{len(items)}] skip {p['sku']}"); continue
        child_skus=[]
        for c in p['colors']:
            for s in p['sizes']:
                csku=f"{p['sku']}-{c[:2].upper()}{s}"
                body={"product":{"sku":csku,"name":f"{p['name']} {c} {s}","attribute_set_id":4,
                  "price":p['price'],"status":1,"visibility":1,"type_id":"simple","weight":1.0,
                  "extension_attributes":{"website_ids":[1],
                    "stock_item":{"qty":random.Random(idx*100+len(child_skus)).randint(0,40),"is_in_stock":True,
                                  "manage_stock":True,"use_config_manage_stock":False}},
                  "custom_attributes":[{"attribute_code":"color","value":str(COL[c])},
                                       {"attribute_code":"size","value":str(SIZ[s])},
                                       {"attribute_code":"url_key","value":f"{p['url_key']}-{c.lower()}-{s}"}]}}
                cst,_=call('POST','V1/products',body)
                if cst==200: child_skus.append(csku)
                else: print(f"     child FAIL {csku} {cst}")
        parent={"product":{"sku":p['sku'],"name":p['name'],"attribute_set_id":4,"price":p['price'],
          "status":1,"visibility":4,"type_id":"configurable","weight":1.0,
          "extension_attributes":{"website_ids":[1],
            "stock_item":{"is_in_stock":True,"manage_stock":False,"use_config_manage_stock":False},
            "category_links":[{"position":0,"category_id":str(c)} for c in p['cats']],
            "configurable_product_options":[
              {"attribute_id":"93","label":"Color","values":[{"value_index":int(COL[c])} for c in p['colors']]},
              {"attribute_id":"203","label":"Size","values":[{"value_index":int(SIZ[s])} for s in p['sizes']]}],
            "configurable_product_links":[]},
          "media_gallery_entries":media(p['name'],RGB[p['colors'][0]],p['sku']),
          "custom_attributes":[
            {"attribute_code":"description","value":f"<p>The <strong>{p['name']}</strong> from {p['brand']} — available in {len(p['colors'])} colours and {len(p['sizes'])} sizes.</p><ul><li>Colours: {', '.join(p['colors'])}</li><li>Sizes: EU {p['sizes'][0]}–{p['sizes'][-1]}</li></ul>"},
            {"attribute_code":"short_description","value":f"{p['brand']} {p['typ'][:-1] if p['typ'].endswith('s') else p['typ']} — pick your size and colour."},
            {"attribute_code":"url_key","value":p['url_key']},
            {"attribute_code":"meta_title","value":f"{p['name']} | Weekend"}]}}
        pst,pr=call('POST','V1/products',parent)
        if pst!=200:
            failed+=1; print(f"[{idx}/{len(items)}] PARENT FAIL {p['sku']} {pst} {str(pr)[:150]}"); continue
        linked=0
        for cs in child_skus:
            lst,_=call('POST',f"V1/configurable-products/{p['sku']}/child",{"childSku":cs},timeout=60)
            linked+= (lst==200)
        made+=1
        print(f"[{idx}/{len(items)}] {p['sku']} {p['name'][:24]:24s} {linked}/{len(child_skus)} variants linked")
    print(f"\nconfigurables created {made} | skipped {skipped} | failed {failed}")

main()
