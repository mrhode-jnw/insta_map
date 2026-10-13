// Locationscout-Seite mit echtem Browser laden (Cloudflare) und Spot-Daten als JSON ausgeben.
//   node tools/ls_fetch.js <locationscout-url>
// Chromium: PLAYWRIGHT_BROWSERS_PATH bzw. /opt/pw-browsers/chromium (Cloud-Umgebung).
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2];
  const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
  const b = await chromium.launch(require('fs').existsSync(exe) ? { executablePath: exe } : {});
  const p = await b.newPage({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' });
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(6000);
  const d = await p.evaluate(() => {
    const txt = document.body.innerText;
    const sec = (a, stops) => { const i = txt.indexOf(a); if (i < 0) return ''; let s = txt.slice(i + a.length);
      for (const st of stops) { const j = s.indexOf(st); if (j > 0) s = s.slice(0, j); } return s.trim(); };
    const meta = n => (document.querySelector(`meta[property="${n}"],meta[name="${n}"]`) || {}).content || '';
    return {
      final_url: location.href, title: document.title.replace(/\s*-\s*Locationscout.*$/i, ''),
      image: meta('og:image'),
      description: sec('Add photo', ['Photography Tips', 'Travel Information', 'Spot Type']),
      tips: sec('Photography Tips', ['Travel Information', 'Spot Type']),
      travel: sec('Travel Information', ['Spot Type', 'Crowd Factor']),
      best_timing: sec('Best Timing', ['Sunrise & Sunset', '\n\n']).split('\n')[0],
      coords_hidden: /log in or sign up[^]*GPS coordinates/i.test(txt),
    };
  });
  console.log(JSON.stringify(d, null, 1));
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
