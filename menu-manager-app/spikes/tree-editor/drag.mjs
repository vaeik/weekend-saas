import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 900, height: 900 } })).newPage();
await p.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('[data-testid="tree"] [role="row"]');

const rows = () => p.$$eval('[data-testid="tree"] [role="row"]', rs => rs.map(r => r.innerText.replace(/\n+/g,' | ').trim()));
const box = async (label) => {
  const el = await p.locator('[data-testid="tree"] [role="row"]', { hasText: label }).first();
  return { el, b: await el.boundingBox() };
};

// Pointer drag: "Jakas" (child of Vīriešiem, L2) onto "Bērniem" (root, L1)
const src = await box('Jakas');
const dst = await box('Bērniem');
console.log('dragging Jakas -> Bērniem');

await p.mouse.move(src.b.x + 40, src.b.y + src.b.height / 2);
await p.mouse.down();
for (let i = 1; i <= 12; i++) {
  await p.mouse.move(
    src.b.x + 40 + (dst.b.x - src.b.x) * i / 12,
    src.b.y + src.b.height / 2 + (dst.b.y - src.b.y) * i / 12
  );
  await p.waitForTimeout(25);
}
await p.mouse.move(dst.b.x + 60, dst.b.y + dst.b.height / 2);
await p.waitForTimeout(200);
await p.screenshot({ path: 'shot-4-mid-drag.png' });
await p.mouse.up();
await p.waitForTimeout(500);

console.log('\n--- after pointer drag ---');
(await rows()).forEach(r => console.log('  ' + r));
console.log('\nlog:', (await p.textContent('[data-testid="log"]')).replace(/\n/g,' ; '));
await p.screenshot({ path: 'shot-5-after-drag.png' });
await b.close();
