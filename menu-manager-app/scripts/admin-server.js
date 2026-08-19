#!/usr/bin/env node
/**
 * Local Menu Manager admin — a clickable stand-in for the Phase 3 Admin UI SDK
 * SPA (which can only live in Commerce Admin, and only from the org owning the
 * ACCS tenant). This runs on your machine and talks to the SAME repository the
 * deployed actions use, so every edit behaves exactly as production will:
 * cycle/level guards, cascade deletes, and storefront-cache invalidation.
 *
 *   npm run admin            # http://localhost:4711
 *   PORT=5000 npm run admin
 *
 * Auth/DB come from .env (the workspace S2S credential), same as the seeds.
 */
require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const dbLib = require('@adobe/aio-lib-db');
const stateLib = require('@adobe/aio-lib-state');
const { getRepository } = require('../src/commerce-backend-ui-1/repository');
const { getServiceToken, resolveNamespace } = require('../src/commerce-backend-ui-1/lib/ims-token');
const { assembleTree, reorder } = require('../src/commerce-backend-ui-1/domain/tree');
const { validateItem } = require('../src/commerce-backend-ui-1/domain/schema');

/**
 * Init DB + State with the local .env credentials and hand them to
 * getRepository. getRepository()'s own path calls stateLib.init() with no args,
 * which only works inside a deployed action (it reads __OW_* env); locally we
 * must pass the OpenWhisk namespace/auth explicitly.
 */
async function localClients() {
  const namespace = resolveNamespace();
  if (!namespace) throw new Error('No runtime namespace — run `aio app use -g` (needs AIO_runtime_namespace in .env).');
  const region = process.env.AIO_DB_REGION || 'emea';
  const token = await getServiceToken({});
  const db = await (await dbLib.init({ ow: { namespace }, region, token })).connect();
  const state = await stateLib.init({ ow: { namespace, auth: process.env.AIO_runtime_auth }, region });
  return { db, state };
}

const PORT = Number(process.env.PORT || 4711);
const IDENTIFIER = process.env.MENU_IDENTIFIER || 'main';
const MAX_LEVEL = 4;

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};
const readBody = (req) => new Promise((resolve) => {
  let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
});

/** Demo categories for the picker, so a new item lands on a page with products. */
let categoriesCache = null;
async function demoCategories() {
  if (categoriesCache) return categoriesCache;
  const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../config.json'), 'utf8')).public.default;
  const endpoint = cfg['commerce-endpoint'];
  const headers = { ...(cfg.headers?.all || {}), ...(cfg.headers?.cs || {}), 'content-type': 'application/json' };
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

async function main() {
  const { repo, cache } = await getRepository({ clients: await localClients() });
  const menu = await repo.getMenuByIdentifier(IDENTIFIER);
  if (!menu) throw new Error(`Menu '${IDENTIFIER}' not found. Run \`npm run seed:weekend-demo\` first.`);
  const menuId = menu.id;
  const bust = () => cache.invalidate(IDENTIFIER, menu.storeCodes || []).catch(() => {});

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      if (req.method === 'GET' && url.pathname === '/') return send(res, 200, PAGE, 'text/html');
      if (req.method === 'GET' && url.pathname === '/api/tree') {
        const items = await repo.listItems(menuId);
        return send(res, 200, { menu: { title: menu.title, identifier: IDENTIFIER }, tree: assembleTree(items).tree, flat: items });
      }
      if (req.method === 'GET' && url.pathname === '/api/categories') return send(res, 200, await demoCategories());

      if (req.method === 'POST' && url.pathname === '/api/item') {
        const b = await readBody(req);
        const cats = await demoCategories();
        const cat = b.categoryId ? cats.find((c) => c.id === Number(b.categoryId)) : null;
        const base = b.id ? { ...(await repo.getItem(b.id)) } : { menuId, parentId: b.parentId || null, position: b.position ?? 0 };
        const input = validateItem({
          ...base,
          menuId,
          title: b.title,
          urlType: cat ? 2 : 0,
          categoryId: cat ? cat.id : null,
          url: cat ? null : (b.url || null),
          isActive: b.isActive !== false,
        });
        const saved = await repo.saveItem({
          ...input,
          categorySnapshot: cat ? { urlKey: cat.urlPath, name: b.title, isActive: true, includeInMenu: true } : null,
        }, { actor: 'admin' });
        await bust();
        return send(res, 200, saved);
      }

      if (req.method === 'POST' && url.pathname === '/api/move') {
        const b = await readBody(req);
        const items = await repo.listItems(menuId);
        const { updates } = reorder(items, {
          itemId: b.id, newParentId: b.parentId ?? null, newPosition: Number(b.position ?? 0), maxLevel: MAX_LEVEL,
        });
        await repo.applyReorder(updates);
        await bust();
        return send(res, 200, { updated: updates.length });
      }

      if (req.method === 'POST' && url.pathname === '/api/delete') {
        const b = await readBody(req);
        const r = await repo.deleteItem(b.id);
        await bust();
        return send(res, 200, r);
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  });

  server.listen(PORT, () => {
    console.log(`\n  Menu Manager admin → http://localhost:${PORT}`);
    console.log(`  Editing menu '${IDENTIFIER}' in namespace ${process.env.AIO_runtime_namespace || '(from .env)'}`);
    console.log('  Writes hit the real DB and bust the storefront cache; the storefront');
    console.log('  CDN still caches ~10 min, so branch-preview changes show within that.\n');
  });
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Menu Manager</title>
<style>
  :root{--o:#ff6200;--ink:#262626;--mut:#999;--line:#e6e6e6;--bg:#f7f7f7}
  *{box-sizing:border-box} body{margin:0;font:15px/1.5 Inter,system-ui,sans-serif;color:var(--ink);background:var(--bg)}
  header{background:#fff;border-bottom:3px solid var(--o);padding:14px 24px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:5}
  header h1{font-size:18px;margin:0} header .sub{color:var(--mut);font-size:13px}
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
  .hint{color:var(--mut);font-size:12px;margin-top:8px} .badge{font-size:11px;background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:1px 6px;color:var(--mut)}
</style></head><body>
<header><h1>Menu Manager</h1><span class="sub" id="sub"></span></header>
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
const api=(p,m,b)=>fetch(p,{method:m||'GET',headers:{'content-type':'application/json'},body:b?JSON.stringify(b):undefined}).then(r=>r.json());
function tgt(n){return n.urlType===2?('/'+(n.categorySnapshot?.urlKey||'?')):(n.url||'—');}
function rowHtml(n){return '<div class="row lvl'+n.level+(n.isActive===false?' inactive':'')+'" data-id="'+n.id+'">'
  +'<button class="icon" data-act="up" title="Move up">↑</button>'
  +'<button class="icon" data-act="down" title="Move down">↓</button>'
  +'<span class="t">'+n.title+'</span><span class="tgt">'+tgt(n)+'</span>'
  +'<button class="icon" data-act="edit">Edit</button>'
  +'<button class="icon danger" data-act="del" title="Delete item + subtree">✕</button></div>';}
function walk(nodes,acc){nodes.forEach(n=>{acc.push(rowHtml(n));walk(n.children||[],acc);});return acc;}
async function load(){
  const d=await api('/api/tree'); flat=d.flat;
  $('#sub').textContent=d.menu.title+' · '+flat.length+' items';
  $('#tree').innerHTML=walk(d.tree,[]).join('')||'<p class="hint">Empty menu.</p>';
  const parent=$('#fParent'); parent.innerHTML='<option value="">— top level —</option>'
    +flat.filter(i=>i.level<3).sort((a,b)=>a.level-b.level).map(i=>'<option value="'+i.id+'">'+'— '.repeat(i.level-1)+i.title+'</option>').join('');
}
async function loadCats(){cats=await api('/api/categories');$('#fCat').innerHTML=cats.map(c=>'<option value="'+c.id+'">'+c.label+'</option>').join('');}
function siblings(id){const me=flat.find(i=>i.id===id);return flat.filter(i=>(i.parentId||null)===(me.parentId||null)).sort((a,b)=>a.position-b.position);}
async function move(id,dir){const sib=siblings(id);const idx=sib.findIndex(i=>i.id===id);const j=idx+dir;if(j<0||j>=sib.length)return;
  const me=flat.find(i=>i.id===id);await api('/api/move','POST',{id,parentId:me.parentId||null,position:j});load();}
$('#fType').onchange=()=>{const c=$('#fType').value==='category';$('#catWrap').style.display=c?'':'none';$('#urlWrap').style.display=c?'none':'';};
$('#reset').onclick=()=>{$('#fId').value='';$('#fTitle').value='';$('#fUrl').value='';$('#fActive').checked=true;$('#formTitle').textContent='Add item';};
$('#save').onclick=async()=>{const type=$('#fType').value;
  const body={id:$('#fId').value||undefined,title:$('#fTitle').value.trim(),parentId:$('#fParent').value||null,isActive:$('#fActive').checked};
  if(!body.title){alert('Title required');return;}
  if(type==='category')body.categoryId=$('#fCat').value;else body.url=$('#fUrl').value.trim();
  const r=await api('/api/item','POST',body); if(r.error){alert(r.error);return;} $('#reset').click(); load();};
$('#tree').onclick=async e=>{const btn=e.target.closest('button');if(!btn)return;const id=btn.closest('.row').dataset.id;const act=btn.dataset.act;
  if(act==='up')return move(id,-1); if(act==='down')return move(id,1);
  if(act==='del'){if(confirm('Delete this item and everything under it?')){await api('/api/delete','POST',{id});load();}return;}
  if(act==='edit'){const n=flat.find(i=>i.id===id);$('#fId').value=n.id;$('#fTitle').value=n.title;$('#fParent').value=n.parentId||'';
    $('#fActive').checked=n.isActive!==false;$('#fType').value=n.urlType===2?'category':'link';$('#fType').onchange();
    if(n.urlType===2&&n.categoryId)$('#fCat').value=n.categoryId; else $('#fUrl').value=n.url||'';
    $('#formTitle').textContent='Edit item';window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'});}};
loadCats().then(load);
</script></body></html>`;

main().catch((e) => { console.error(`ADMIN FAILED: ${e.message}`); process.exit(1); });
