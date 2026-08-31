#!/usr/bin/env python3
"""
Gives the sandbox a REAL category tree so every menu item can lead to its own
category instead of several items sharing one.

Before: 13 flat categories under Default Category.
After:
    Women · Men · Kids
    Shoes        > Sneakers · Boots · Sandals      (Shoes is created)
    Accessories  > Bags · Socks                    (moved under Accessories)
    Sport · Brands · Sale · New Arrivals

Only moves categories (ids are preserved, so product links stay valid).
    python3 scripts/restructure-categories.py [--dry-run]
"""
import urllib.request, urllib.error, json, re, os, sys, subprocess

EP = "https://na1-sandbox.api.commerce.adobe.com/EGD3J2kAQ3pgLrtoWaoCJR"
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/140.0 Safari/537.36')

def hdrs():
    d=os.path.join(os.path.dirname(__file__),'..')
    t=subprocess.run(['node','-e',"require('dotenv').config();require('./src/commerce-backend-ui-1/lib/ims-token')"
        ".getServiceToken({}).then(t=>console.log(t))"],cwd=d,capture_output=True,text=True,timeout=120).stdout.strip()
    org=dict(re.findall(r'^([A-Z0-9_]+)=(.*)$',open(os.path.join(d,'.env')).read(),re.M))['IMS_OAUTH_S2S_ORG_ID']
    return {'Authorization':f'Bearer {t}','x-gw-ims-org-id':org,'content-type':'application/json',
            'User-Agent':UA,'Accept':'application/json'}
H=None
def call(m,p,b=None):
    d=json.dumps(b).encode() if b is not None else None
    try:
        r=urllib.request.urlopen(urllib.request.Request(f"{EP}/{p}",data=d,headers=H,method=m),timeout=90)
        return r.status,json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code,e.read()[:250].decode('utf8','ignore')

def tree():
    _,c=call('GET','V1/categories'); return c
def show(n,d=0):
    print("   "+"  "*d+f"[{n['id']}] {n['name']}")
    for ch in n.get('children_data',[]): show(ch,d+1)

def main():
    global H
    dry='--dry-run' in sys.argv
    H=hdrs()
    print("=== BEFORE ==="); show(tree())
    if dry: return
    # 1. Shoes parent
    _,cats=call('GET','V1/categories/list?searchCriteria[filterGroups][0][filters][0][field]=name'
                      '&searchCriteria[filterGroups][0][filters][0][value]=Shoes')
    shoes=None
    for it in (cats.get('items') or []):
        if it['name']=='Shoes': shoes=it['id']
    if not shoes:
        st,r=call('POST','V1/categories',{"category":{"parent_id":2,"name":"Shoes","is_active":True,
            "include_in_menu":True,"custom_attributes":[{"attribute_code":"url_key","value":"shoes"}]}})
        shoes=r['id'] if st==200 else None
        print(f"created Shoes -> id {shoes}")
    else: print(f"Shoes already exists -> id {shoes}")
    # 2. moves: child_id -> new parent
    moves={6:shoes,7:shoes,8:shoes,   # Sneakers, Boots, Sandals -> Shoes
           11:10,12:10}               # Bags, Socks -> Accessories
    for cid,pid in moves.items():
        st,_=call('PUT',f'V1/categories/{cid}/move',{"parentId":int(pid),"afterId":None})
        print(f"  move {cid} -> parent {pid}: HTTP {st}")
    print("\n=== AFTER ==="); show(tree())

main()
