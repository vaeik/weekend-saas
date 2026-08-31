#!/usr/bin/env python3
"""
Seeds ~100 realistic products into the ACCS sandbox via the Commerce REST API.

Auth: IMS S2S token (same credential the App Builder app uses) + x-gw-ims-org-id.
NOTE: the ACCS API sits behind Cloudflare and rejects requests without a normal
User-Agent, and the REST base has NO `rest/` prefix -> {EP}/V1/...

Idempotent: existing SKUs are skipped, so it can be re-run safely.
  python3 scripts/seed-accs-products.py [--limit N] [--dry-run]
"""
import urllib.request, urllib.error, json, re, sys, random, io, base64, os
from PIL import Image, ImageDraw

EP = "https://na1-sandbox.api.commerce.adobe.com/EGD3J2kAQ3pgLrtoWaoCJR"
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/140.0 Safari/537.36')
CAT = dict(women=3, men=4, kids=5, sneakers=6, boots=7, sandals=8, sport=9,
           accessories=10, bags=11, socks=12, brands=13, sale=14, new=15)

BRANDS = ["Nike","Adidas","Puma","New Balance","Reebok","Converse","Vans",
          "Timberland","Ecco","Geox","Skechers","Clarks","Salomon","Columbia"]
COLORS = [("Black",(28,28,30)),("White",(238,238,238)),("Navy",(28,45,84)),
          ("Grey",(120,124,130)),("Beige",(214,196,168)),("Olive",(96,104,72)),
          ("Burgundy",(102,36,52)),("Tan",(176,132,92))]
MATERIALS = ["full-grain leather","suede","recycled mesh","canvas","nubuck","knit textile"]

# (type key, gender, model words, price range, weight)
LINES = [
    ("sneakers","women",["Air Flow","Court Classic","Runner Lite","Street Ease","Cloud Step"],(49,139),0.8),
    ("sneakers","men",["Trail Runner","Court Pro","Urban Flex","Speed Lite","Daily Trainer"],(59,159),0.9),
    ("sneakers","kids",["Mini Runner","Playground","First Step","School Sport"],(29,69),0.5),
    ("boots","women",["Chelsea","Ankle Warm","Winter Guard","Riding"],(79,229),1.3),
    ("boots","men",["Hiker Pro","Work Guard","Chelsea Classic","Snow Trek"],(89,259),1.5),
    ("boots","kids",["Snow Play","Rain Boot"],(39,89),0.8),
    ("sandals","women",["Summer Slide","Beach Walk","Comfort Sandal"],(25,89),0.4),
    ("sandals","men",["Trek Sandal","Pool Slide"],(29,79),0.5),
    ("sandals","kids",["Aqua Play"],(19,45),0.3),
    ("sport","men",["Football Boot","Training Shoe","Basketball High"],(69,189),0.9),
    ("sport","women",["Studio Trainer","Yoga Flex","Running Elite"],(59,169),0.7),
    ("bags","women",["Tote Bag","Shoulder Bag","Backpack Mini"],(35,129),0.6),
    ("bags","men",["Backpack Pro","Duffel Bag","Sport Holdall"],(39,149),0.8),
    ("accessories","men",["Shoe Care Kit","Insole Comfort","Laces Set","Waterproof Spray"],(6,29),0.2),
    ("socks","women",["Ankle Socks 3-pack","Wool Socks"],(8,25),0.15),
    ("socks","men",["Sport Socks 5-pack","Hiking Socks"],(9,29),0.15),
    ("socks","kids",["Kids Socks 5-pack"],(7,18),0.1),
]

def token():
    import subprocess
    d=os.path.join(os.path.dirname(__file__),'..')
    out=subprocess.run(['node','-e',
        "require('dotenv').config();require('./src/commerce-backend-ui-1/lib/ims-token')"
        ".getServiceToken({}).then(t=>console.log(t))"],cwd=d,capture_output=True,text=True,timeout=120)
    t=out.stdout.strip()
    if not t: raise SystemExit("could not mint IMS token: "+out.stderr[:300])
    return t

def org():
    envp=os.path.join(os.path.dirname(__file__),'..','.env')
    return dict(re.findall(r'^([A-Z0-9_]+)=(.*)$',open(envp).read(),re.M)).get('IMS_OAUTH_S2S_ORG_ID','')

def make_image(name, rgb):
    im=Image.new("RGB",(700,700),(247,247,248)); d=ImageDraw.Draw(im)
    d.rounded_rectangle([70,70,630,630],radius=36,fill=rgb)
    d.ellipse([180,300,520,470],fill=tuple(min(255,c+38) for c in rgb))
    d.rectangle([180,430,520,470],fill=tuple(max(0,c-28) for c in rgb))
    for i,line in enumerate([name[:22], name[22:44]]):
        if line: d.text((80,650+i*18), line, fill=(60,60,64))
    b=io.BytesIO(); im.save(b,format="JPEG",quality=82)
    return base64.b64encode(b.getvalue()).decode()

def build(limit=100):
    rnd=random.Random(20260828); items=[]; n=0
    while len(items)<limit:
        for (typ,gender,models,(lo,hi),wt) in LINES:
            if len(items)>=limit: break
            brand=rnd.choice(BRANDS); model=rnd.choice(models)
            cname,rgb=rnd.choice(COLORS); mat=rnd.choice(MATERIALS)
            n+=1
            name=f"{brand} {model} {cname}"
            sku=f"WK-{typ[:3].upper()}-{n:04d}"
            price=round(rnd.uniform(lo,hi),2)
            cats=[CAT[typ],CAT[gender]]
            special=None
            if rnd.random()<0.22: cats.append(CAT['sale']); special=round(price*rnd.uniform(0.6,0.85),2)
            if rnd.random()<0.18: cats.append(CAT['new'])
            items.append(dict(sku=sku,name=name,price=price,special=special,weight=wt,cats=cats,
                brand=brand,color=cname,rgb=rgb,material=mat,typ=typ,gender=gender,
                qty=rnd.randint(5,120),
                url_key=re.sub(r'[^a-z0-9]+','-',name.lower()).strip('-')+f"-{n}"))
    return items

def payload(p):
    desc=(f"<p>The <strong>{p['name']}</strong> from {p['brand']} is built for everyday wear. "
          f"Crafted in {p['material']} with a cushioned footbed and a durable outsole for reliable grip.</p>"
          f"<ul><li>Colour: {p['color']}</li><li>Upper: {p['material']}</li>"
          f"<li>Category: {p['typ'].title()} · {p['gender'].title()}</li></ul>")
    ca=[{"attribute_code":"description","value":desc},
        {"attribute_code":"short_description","value":f"{p['brand']} {p['typ'][:-1] if p['typ'].endswith('s') else p['typ']} in {p['material']}."},
        {"attribute_code":"url_key","value":p['url_key']},
        {"attribute_code":"meta_title","value":f"{p['name']} | Weekend"},
        {"attribute_code":"meta_description","value":f"Buy {p['name']} online. {p['material'].title()}, {p['color'].lower()}."}]
    if p['special']: ca.append({"attribute_code":"special_price","value":str(p['special'])})
    return {"product":{"sku":p['sku'],"name":p['name'],"attribute_set_id":4,"price":p['price'],
      "status":1,"visibility":4,"type_id":"simple","weight":p['weight'],
      "extension_attributes":{"website_ids":[1],
        "stock_item":{"qty":p['qty'],"is_in_stock":True,"manage_stock":True,"use_config_manage_stock":False},
        "category_links":[{"position":0,"category_id":str(c)} for c in p['cats']]},
      "media_gallery_entries":[{"media_type":"image","label":p['name'],"position":1,"disabled":False,
        "types":["image","small_image","thumbnail"],
        "content":{"base64_encoded_data":make_image(p['name'],p['rgb']),
                   "type":"image/jpeg","name":f"{p['sku'].lower()}.jpg"}}],
      "custom_attributes":ca}}

def main():
    limit=100; dry='--dry-run' in sys.argv
    if '--limit' in sys.argv: limit=int(sys.argv[sys.argv.index('--limit')+1])
    items=build(limit)
    print(f"{len(items)} products prepared")
    if dry:
        for p in items[:8]: print(f"  {p['sku']:16s} {p['name']:38s} EUR{p['price']:7.2f} cats={p['cats']} qty={p['qty']}")
        return
    H={'Authorization':f'Bearer {token()}','x-gw-ims-org-id':org(),
       'content-type':'application/json','User-Agent':UA,'Accept':'application/json'}
    ok=skip=fail=0
    for i,p in enumerate(items,1):
        try:
            urllib.request.urlopen(urllib.request.Request(f"{EP}/V1/products/{p['sku']}",headers=H),timeout=40)
            skip+=1; print(f"  [{i:3d}/{len(items)}] skip (exists) {p['sku']}"); continue
        except urllib.error.HTTPError as e:
            if e.code!=404: pass
        try:
            req=urllib.request.Request(f"{EP}/V1/products",data=json.dumps(payload(p)).encode(),headers=H,method='POST')
            r=urllib.request.urlopen(req,timeout=120); json.loads(r.read()); ok+=1
            print(f"  [{i:3d}/{len(items)}] created {p['sku']:16s} {p['name'][:34]:34s} EUR{p['price']:7.2f}")
        except urllib.error.HTTPError as e:
            fail+=1; print(f"  [{i:3d}/{len(items)}] FAIL {p['sku']} HTTP{e.code} {e.read()[:180].decode('utf8','ignore')}")
        except Exception as e:
            fail+=1; print(f"  [{i:3d}/{len(items)}] ERR {p['sku']} {str(e)[:120]}")
    print(f"\ncreated {ok} | skipped {skip} | failed {fail}")

main()
