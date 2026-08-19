import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext()).newPage();
await p.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('[role="row"]');
const d = await p.evaluate(() => {
  const row = document.querySelector('[role="row"]');
  const gc = row.querySelector('[role="gridcell"]') || row;
  const cs = getComputedStyle(gc);
  const texts = [...gc.querySelectorAll('span,div')].slice(0,6).map(e => ({
    t: (e.innerText||'').slice(0,18), area: getComputedStyle(e).gridArea, disp: getComputedStyle(e).display
  }));
  return {
    scale: getComputedStyle(document.documentElement).getPropertyValue('--s2-scale') || '(unset)',
    lightVar: getComputedStyle(document.documentElement).getPropertyValue('--lightningcss-light') || '(unset)',
    cellDisplay: cs.display,
    cellAreas: cs.gridTemplateAreas.slice(0, 100),
    texts
  };
});
console.log(JSON.stringify(d, null, 1));
await b.close();
