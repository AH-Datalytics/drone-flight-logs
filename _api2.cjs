const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36' }).then(c => c.newPage());
  const calls = [];
  p.on('response', async r => {
    const u = r.url();
    if (/brincdrones\.com\/(api|dfr)/.test(u)) {
      let body = ''; try { body = await r.text(); } catch {}
      calls.push(`${r.status()} ${r.request().method()} ${u.slice(0, 160)}\n      ${body.length}b  ${body.slice(0, 260).replace(/\s+/g, ' ')}`);
    }
  });
  await p.goto('https://dashboard.liveops.brincdrones.com/clovisca', { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(3000);
  const tab = await p.$('text=/^Flights$/i');
  if (tab) { await tab.click(); await p.waitForTimeout(5000); console.log('clicked the Flights tab'); }
  else console.log('no Flights tab found');
  calls.forEach(c => console.log('  ' + c));
  await b.close();
})();
