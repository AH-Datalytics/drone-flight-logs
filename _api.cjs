const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  for (const [label, url] of [
    ['brinc', 'https://dashboard.liveops.brincdrones.com/clovisca'],
    ['dronesense', 'https://dashboard.dronesense.com/arpdtx'],
  ]) {
    const p = await b.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36' }).then(c => c.newPage());
    const calls = [];
    p.on('response', async r => {
      const u = r.url(), ct = r.headers()['content-type'] || '';
      if (!/\.(js|css|woff2?|png|svg|ico)(\?|$)/.test(u) && (ct.includes('json') || /api|graphql|flight|query/i.test(u))) {
        let body = ''; try { body = await r.text(); } catch {}
        calls.push({ s: r.status(), m: r.request().method(), u: u.slice(0, 150), b: body.length, head: body.slice(0, 200).replace(/\s+/g, ' ') });
      }
    });
    await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await p.waitForTimeout(5000);
    console.log(`\n===== ${label} — ${calls.length} data calls`);
    calls.slice(0, 8).forEach(c => console.log(`  ${c.s} ${c.m} ${c.u}\n      ${c.b}b  ${c.head}`));
    await p.close();
  }
  await b.close();
})();
