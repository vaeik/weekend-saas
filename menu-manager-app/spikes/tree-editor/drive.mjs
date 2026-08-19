import { chromium } from 'playwright';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 900, height: 900 } })).newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

await p.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await p.waitForSelector('[data-testid="tree"] [role="row"]');

const rows = async () => p.$$eval('[data-testid="tree"] [role="row"]',
  (rs) => rs.map((r) => r.innerText.replace(/\n+/g, ' | ').trim()));

console.log('--- initial tree ---');
(await rows()).forEach((r) => console.log('  ' + r));

await p.screenshot({ path: 'shot-1-initial.png' });

// 1. Guard: cycle
await p.click('[data-testid="try-cycle"]');
await p.waitForSelector('[data-testid="error"]');
console.log('\ncycle guard  ->', (await p.textContent('[data-testid="error"]')).replace(/\s+/g, ' ').trim());
await p.screenshot({ path: 'shot-2-cycle-rejected.png' });

// 2. Guard: max level
await p.click('[data-testid="try-depth"]');
await p.waitForTimeout(300);
console.log('depth guard  ->', (await p.textContent('[data-testid="error"]')).replace(/\s+/g, ' ').trim());

// 3. Legal move still works after two rejections (tree not corrupted)
await p.click('[data-testid="legal-move"]');
await p.waitForTimeout(400);
console.log('\n--- after legal move (Outlet -> position 0) ---');
(await rows()).forEach((r) => console.log('  ' + r));
await p.screenshot({ path: 'shot-3-after-legal-move.png' });

// 4. Keyboard drag and drop — the accessible path React Aria provides for free.
const first = await p.$('[data-testid="tree"] [role="row"]');
await first.focus();
await p.keyboard.press('Enter');           // pick up
await p.waitForTimeout(250);
const dragging = await p.evaluate(() => document.body.innerText.includes('Drop') || !!document.querySelector('[data-dragging="true"], [class*="drop-indicator"]'));
console.log('\nkeyboard pickup engaged drop targets:', dragging);
await p.keyboard.press('Escape');

console.log('\nlog:', (await p.textContent('[data-testid="log"]')).replace(/\n/g, ' ; '));
console.log('page errors:', errs.length ? errs : 'none');
await b.close();
