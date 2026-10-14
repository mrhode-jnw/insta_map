// Beliebige Seite (Blog, TikTok, Xiaohongshu, YouTube, Pinterest, Reiseportal …) mit echtem Browser laden und
// alles ausgeben, was für Ort + Fotos nützlich ist.   node tools/web_fetch.js <url>
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2];
  const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
  const b = await chromium.launch(require('fs').existsSync(exe) ? { executablePath: exe } : {});
  // Desktop-Browser: Kurzlinks mancher Portale (z.B. trip.com/w/…) leiten Handys auf die Startseite statt zum Beitrag
  const p = await b.newPage({ viewport: { width: 1280, height: 1000 }, locale: 'en-US',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' });
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(6000);
  await p.evaluate(() => window.scrollBy(0, 2500)); await p.waitForTimeout(1500);
  const d = await p.evaluate(() => {
    const meta = n => [...document.querySelectorAll(`meta[property="${n}"],meta[name="${n}"]`)].map(m => m.content).filter(Boolean);
    const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => s.textContent).join('\n').slice(0, 6000);
    const txt = document.body ? document.body.innerText : '';
    const coords = [...new Set((txt + ' ' + ld + ' ' + document.documentElement.innerHTML.slice(0, 400000))
      .match(/-?\d{1,3}\.\d{4,}\s*[,/ ]\s*-?\d{1,3}\.\d{4,}/g) || [])].slice(0, 10);
    const imgs = [...document.querySelectorAll('img')].filter(i => i.naturalWidth >= 500 || i.width >= 300)
      .map(i => i.currentSrc || i.src).filter(s => /^https?:/.test(s));
    return {
      final_url: location.href, title: document.title,
      og_title: meta('og:title')[0] || '', description: (meta('og:description')[0] || meta('description')[0] || ''),
      images: [...new Set([...meta('og:image'), ...meta('twitter:image'), ...imgs])].slice(0, 20),
      geo: { position: meta('geo.position')[0] || meta('ICBM')[0] || '', place_lat: meta('place:location:latitude')[0] || '',
             place_lng: meta('place:location:longitude')[0] || '', region: meta('geo.placename')[0] || '' },
      coords_in_page: coords, json_ld: ld, text: txt.replace(/\n{3,}/g, '\n\n').slice(0, 6000),
    };
  });
  console.log(JSON.stringify(d, null, 1));
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
