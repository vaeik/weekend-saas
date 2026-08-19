import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 880, height: 820 }, deviceScaleFactor: 2 })).newPage();
await p.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('[data-testid="tree"] [role="row"]');

const src = await p.locator('[data-testid="tree"] [role="row"]', { hasText: 'Jakas' }).first().boundingBox();
const dst = await p.locator('[data-testid="tree"] [role="row"]', { hasText: 'Bērniem' }).first().boundingBox();
await p.mouse.move(src.x + 40, src.y + src.height/2); await p.mouse.down();
for (let i=1;i<=12;i++){ await p.mouse.move(src.x+40+(dst.x-src.x)*i/12, src.y+src.height/2+(dst.y-src.y)*i/12); await p.waitForTimeout(20); }
await p.mouse.move(dst.x + 60, dst.y + dst.height/2); await p.waitForTimeout(150);
await p.mouse.up(); await p.waitForTimeout(400);

// Expand Bērniem to confirm the item really landed there as a child at level 2
const bern = p.locator('[data-testid="tree"] [role="row"]', { hasText: 'Bērniem' }).first();
await bern.click();
await p.keyboard.press('ArrowRight');
await p.waitForTimeout(400);

const rows = await p.$$eval('[data-testid="tree"] [role="row"]', rs => rs.map(r => r.innerText.replace(/\n+/g,' | ').trim()));
console.log('--- final tree (Bērniem expanded) ---');
rows.forEach(r => console.log('  ' + r));
const jakas = rows.find(r => r.startsWith('Jakas'));
console.log('\nASSERT Jakas reparented to level 2 under Bērniem:', /L2/.test(jakas || ''), '->', jakas);
await p.screenshot({ path: 'shot-final.png' });
await b.close();
