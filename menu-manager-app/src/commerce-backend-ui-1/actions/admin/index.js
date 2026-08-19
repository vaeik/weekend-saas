/**
 * Web-hosted Menu Manager admin — a secret-gated App Builder web action that
 * serves a clickable UI AND its JSON API from one endpoint:
 *
 *   .../web/menu-manager/admin              -> HTML UI
 *   .../web/menu-manager/admin/api/tree     -> GET   (secret required)
 *   .../web/menu-manager/admin/api/item     -> POST  create/update
 *   .../web/menu-manager/admin/api/move     -> POST  reorder/reparent
 *   .../web/menu-manager/admin/api/delete   -> POST  delete + subtree
 *
 * NOT require-adobe-auth (a browser must reach it), so it is protected by a
 * shared ADMIN_SECRET compared in constant time — the same demo-grade gate as
 * the storefront action. This is NOT per-user auth; the production admin is the
 * Admin UI SDK SPA (IMS), which is Phase 3 and org-gated. Reuses the same
 * repository, reorder() guards and validateItem() as every other action, and
 * busts the storefront cache on every write.
 */
const crypto = require('crypto');
const { getRepository } = require('../../repository');
const { build } = require('../../lib/logger');
const { assembleTree, reorder, descendantIds } = require('../../domain/tree');
const { validateItem } = require('../../domain/schema');

const IDENTIFIER = 'main';
const MAX_LEVEL = 4;

const json = (body, statusCode = 200) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body });
const htmlResp = (body) => ({ statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body });

function checkSecret(params) {
  const expected = params.ADMIN_SECRET;
  if (!expected) { const e = new Error('ADMIN_SECRET not configured'); e.code = 'FORBIDDEN'; throw e; }
  const got = (params.__ow_headers || {})['x-admin-secret'] || params.secret || '';
  const a = Buffer.from(String(got));
  const b = Buffer.from(String(expected));
  if (!(a.length === b.length && crypto.timingSafeEqual(a, b))) {
    const e = new Error('Bad admin secret'); e.code = 'FORBIDDEN'; throw e;
  }
}

let categoriesCache = null;
async function demoCategories(params) {
  if (categoriesCache) return categoriesCache;
  const endpoint = params.COMMERCE_ENDPOINT;
  const headers = { ...JSON.parse(params.COMMERCE_HEADERS || '{}'), 'content-type': 'application/json' };
  const q = (ids) => fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: `{categories(ids:[${ids.map((i) => `"${i}"`).join(',')}]){id name urlPath children}}` }),
  }).then((r) => r.json()).then((j) => j.data?.categories || []);
  const [root] = await q(['2']);
  const out = [];
  const kids = await q((root.children || []).map(String));
  for (const c of kids) {
    out.push({ id: Number(c.id), urlPath: c.urlPath, label: c.name.trim() });
    const subs = c.children?.length ? await q(c.children.map(String)) : [];
    subs.forEach((s) => out.push({ id: Number(s.id), urlPath: s.urlPath, label: `  ${c.name.trim()} › ${s.name.trim()}` }));
  }
  categoriesCache = out;
  return out;
}

async function main(params) {
  const logger = build('admin', params);
  const method = (params.__ow_method || 'get').toLowerCase();
  const p = params.__ow_path || '';
  try {
    if (method === 'get' && (p === '' || p === '/')) return htmlResp(PAGE);

    checkSecret(params);
    const { repo, cache } = await getRepository({ params, logger });
    const menu = await repo.getMenuByIdentifier(IDENTIFIER);
    if (!menu) return json({ error: `Menu '${IDENTIFIER}' not found. Seed it first.` }, 404);
    const bust = () => cache.invalidate(IDENTIFIER, menu.storeCodes || []).catch(() => {});

    if (method === 'get' && p === '/api/tree') {
      const items = await repo.listItems(menu.id);
      return json({ menu: { title: menu.title, identifier: IDENTIFIER }, tree: assembleTree(items).tree, flat: items });
    }
    if (method === 'get' && p === '/api/categories') return json(await demoCategories(params));

    if (method === 'post' && p === '/api/item') {
      const cats = await demoCategories(params);
      const cat = params.categoryId ? cats.find((c) => c.id === Number(params.categoryId)) : null;
      const existing = params.id ? await repo.getItem(params.id) : null;
      if (params.id && !existing) return json({ error: `Item ${params.id} not found` }, 400);
      const newParent = params.parentId || null;
      if (newParent && existing) {
        if (newParent === params.id || descendantIds(await repo.listItems(menu.id), params.id).includes(String(newParent))) {
          return json({ error: 'Cannot move an item beneath itself or its own descendant' }, 400);
        }
      }
      const input = validateItem({
        ...(existing || {}),
        menuId: menu.id,
        parentId: newParent,
        position: existing ? existing.position : Number(params.position ?? 0),
        title: params.title,
        urlType: cat ? 2 : 0,
        categoryId: cat ? cat.id : null,
        url: cat ? null : (params.url || null),
        isActive: params.isActive !== false && params.isActive !== 'false',
      });
      const saved = await repo.saveItem({
        ...input,
        id: params.id || undefined,
        categorySnapshot: cat ? { urlKey: cat.urlPath, name: params.title, isActive: true, includeInMenu: true } : null,
      }, { actor: 'web-admin' });
      await bust();
      return json(saved);
    }

    if (method === 'post' && p === '/api/move') {
      const items = await repo.listItems(menu.id);
      const { updates } = reorder(items, {
        itemId: params.id, newParentId: params.parentId ?? null, newPosition: Number(params.position ?? 0), maxLevel: MAX_LEVEL,
      });
      await repo.applyReorder(updates);
      await bust();
      return json({ updated: updates.length });
    }

    if (method === 'post' && p === '/api/delete') {
      const r = await repo.deleteItem(params.id);
      await bust();
      return json(r);
    }
    return json({ error: 'not found' }, 404);
  } catch (e) {
    logger.error(`${e.code || 'ERROR'}: ${e.message}`);
    return json({ error: e.message }, e.code === 'FORBIDDEN' ? 403 : 400);
  }
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Menu Manager</title>
<style>
  :root{--o:#ff6200;--ink:#262626;--mut:#999;--line:#e6e6e6;--bg:#f7f7f7}
  *{box-sizing:border-box} body{margin:0;font:15px/1.5 Inter,system-ui,sans-serif;color:var(--ink);background:var(--bg)}
  header{background:#fff;border-bottom:3px solid var(--o);padding:14px 24px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:5}
  header h1{font-size:18px;margin:0} header .sub{color:var(--mut);font-size:13px} header .out{margin-left:auto}
  main{max-width:900px;margin:24px auto;padding:0 16px;display:grid;gap:20px}
  .card{background:#fff;border:1px solid var(--line);border-radius:8px;padding:18px}
  .card h2{font-size:14px;text-transform:uppercase;letter-spacing:.04em;margin:0 0 12px;color:var(--mut)}
  .row{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:6px}
  .row:hover{background:var(--bg)} .row .t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .row .tgt{color:var(--mut);font-size:12px;flex-shrink:0}
  .row.inactive .t{color:var(--mut);text-decoration:line-through}
  .lvl2{margin-left:26px} .lvl3{margin-left:52px}
  button{font:inherit;border:1px solid var(--line);background:#fff;border-radius:6px;padding:5px 10px;cursor:pointer;color:var(--ink)}
  button:hover{border-color:var(--o);color:var(--o)} button.icon{padding:4px 8px;line-height:1}
  button.primary{background:var(--o);color:#fff;border-color:var(--o)} button.primary:hover{background:#e05600;color:#fff}
  button.danger:hover{border-color:#c00;color:#c00}
  label{display:block;font-size:12px;color:var(--mut);margin:10px 0 4px}
  input,select{font:inherit;width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:6px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px} .actions{display:flex;gap:8px;margin-top:16px}
  .hint{color:var(--mut);font-size:12px;margin-top:8px}
</style></head><body>
<header><h1>Menu Manager</h1><span class="sub" id="sub"></span><button class="out" id="logout">Change secret</button></header>
<main>
  <div class="card"><h2>Menu tree</h2><div id="tree">Loading…</div></div>
  <div class="card"><h2 id="formTitle">Add item</h2>
    <input type="hidden" id="fId">
    <label>Title</label><input id="fTitle" placeholder="e.g. Sieviešu">
    <div class="grid">
      <div><label>Type</label><select id="fType"><option value="category">Category (has products)</option><option value="link">Custom link</option></select></div>
      <div><label>Parent</label><select id="fParent"></select></div>
    </div>
    <div id="catWrap"><label>Category</label><select id="fCat"></select></div>
    <div id="urlWrap" style="display:none"><label>URL</label><input id="fUrl" placeholder="/outlet"></div>
    <label><input type="checkbox" id="fActive" checked style="width:auto;margin-right:6px">Active</label>
    <div class="actions"><button class="primary" id="save">Save item</button><button id="reset">Clear</button></div>
    <p class="hint">Edits write to the real database and refresh the storefront (CDN caches ~10&nbsp;min).</p>
  </div>
</main>
<script>
const $=s=>document.querySelector(s); let cats=[], flat=[];
const BASE=location.pathname.replace(/\\/+$/,'');
function secret(){let s=sessionStorage.getItem('mm_admin_secret');if(!s){s=prompt('Admin secret:')||'';sessionStorage.setItem('mm_admin_secret',s);}return s;}
async function api(p,m,b){const r=await fetch(BASE+p,{method:m||'GET',headers:{'content-type':'application/json','x-admin-secret':secret()},body:b?JSON.stringify(b):undefined});
  if(r.status===403){sessionStorage.removeItem('mm_admin_secret');alert('Wrong secret — try again');location.reload();return {};}return r.json();}
function tgt(n){return n.urlType===2?('/'+(n.categorySnapshot?.urlKey||'?')):(n.url||'—');}
function rowHtml(n){return '<div class="row lvl'+n.level+(n.isActive===false?' inactive':'')+'" data-id="'+n.id+'">'
  +'<button class="icon" data-act="up" title="Move up">↑</button><button class="icon" data-act="down" title="Move down">↓</button>'
  +'<span class="t">'+n.title+'</span><span class="tgt">'+tgt(n)+'</span>'
  +'<button class="icon" data-act="edit">Edit</button><button class="icon danger" data-act="del" title="Delete item + subtree">✕</button></div>';}
function walk(nodes,acc){nodes.forEach(n=>{acc.push(rowHtml(n));walk(n.children||[],acc);});return acc;}
async function load(){const d=await api('/api/tree');if(!d.flat)return;flat=d.flat;
  $('#sub').textContent=d.menu.title+' · '+flat.length+' items';
  $('#tree').innerHTML=walk(d.tree,[]).join('')||'<p class="hint">Empty menu.</p>';
  $('#fParent').innerHTML='<option value="">— top level —</option>'
    +flat.filter(i=>i.level<3).sort((a,b)=>a.level-b.level).map(i=>'<option value="'+i.id+'">'+'— '.repeat(i.level-1)+i.title+'</option>').join('');}
async function loadCats(){cats=await api('/api/categories');if(cats.length)$('#fCat').innerHTML=cats.map(c=>'<option value="'+c.id+'">'+c.label+'</option>').join('');}
function siblings(id){const me=flat.find(i=>i.id===id);return flat.filter(i=>(i.parentId||null)===(me.parentId||null)).sort((a,b)=>a.position-b.position);}
async function move(id,dir){const sib=siblings(id);const idx=sib.findIndex(i=>i.id===id);const j=idx+dir;if(j<0||j>=sib.length)return;
  const me=flat.find(i=>i.id===id);await api('/api/move','POST',{id,parentId:me.parentId||null,position:j});load();}
$('#logout').onclick=()=>{sessionStorage.removeItem('mm_admin_secret');location.reload();};
$('#fType').onchange=()=>{const c=$('#fType').value==='category';$('#catWrap').style.display=c?'':'none';$('#urlWrap').style.display=c?'none':'';};
$('#reset').onclick=()=>{$('#fId').value='';$('#fTitle').value='';$('#fUrl').value='';$('#fActive').checked=true;$('#formTitle').textContent='Add item';};
$('#save').onclick=async()=>{const type=$('#fType').value;
  const body={id:$('#fId').value||undefined,title:$('#fTitle').value.trim(),parentId:$('#fParent').value||null,isActive:$('#fActive').checked};
  if(!body.title){alert('Title required');return;}
  if(type==='category')body.categoryId=$('#fCat').value;else body.url=$('#fUrl').value.trim();
  const r=await api('/api/item','POST',body);if(r&&r.error){alert(r.error);return;}$('#reset').click();load();};
$('#tree').onclick=async e=>{const btn=e.target.closest('button');if(!btn)return;const id=btn.closest('.row').dataset.id;const act=btn.dataset.act;
  if(act==='up')return move(id,-1);if(act==='down')return move(id,1);
  if(act==='del'){if(confirm('Delete this item and everything under it?')){await api('/api/delete','POST',{id});load();}return;}
  if(act==='edit'){const n=flat.find(i=>i.id===id);$('#fId').value=n.id;$('#fTitle').value=n.title;$('#fParent').value=n.parentId||'';
    $('#fActive').checked=n.isActive!==false;$('#fType').value=n.urlType===2?'category':'link';$('#fType').onchange();
    if(n.urlType===2&&n.categoryId)$('#fCat').value=n.categoryId;else $('#fUrl').value=n.url||'';
    $('#formTitle').textContent='Edit item';window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'});}};
loadCats().then(load);
</script></body></html>`;

exports.main = main;
