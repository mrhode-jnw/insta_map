// Instagram-Post über einen echten Browser laden, wenn die einfache Abfrage gesperrt ist (Rate-Limit).
//   node tools/ig_fetch.js <code>   →  {"caption": "...", "slides": ["https://…jpg", …]}
const { chromium } = require('playwright');
(async () => {
  const code = process.argv[2];
  const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
  const b = await chromium.launch(require('fs').existsSync(exe) ? { executablePath: exe } : {});
  const p = await b.newPage({ viewport: { width: 540, height: 900 } });
  await p.goto(`https://www.instagram.com/p/${code}/embed/captioned/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(5000);
  const html = await p.content();
  let out = null;
  const m = html.match(/"contextJSON":("(?:[^"\\]|\\.)*")/);
  if (m) {
    try {
      const sm = JSON.parse(JSON.parse(m[1])).gql_data.shortcode_media;
      const pick = n => { const r = n.display_resources || []; return r.length ? r.reduce((a, c) => Math.abs(c.config_width - 640) < Math.abs(a.config_width - 640) ? c : a).src : n.display_url; };
      const kids = ((sm.edge_sidecar_to_children || {}).edges || []).map(e => e.node);
      const caps = (sm.edge_media_to_caption || {}).edges || [];
      out = { caption: caps.length ? caps[0].node.text : '', slides: (kids.length ? kids : [sm]).map(pick), username: (sm.owner || {}).username || '' };
    } catch (e) {}
  }
  if (!out) {  // kein contextJSON: Caption aus dem Text, Bilder durch Weiterklicken im Karussell
    const caption = await p.evaluate(() => { const c = document.querySelector('.Caption'); return c ? c.innerText.replace(/^\S+\s*/, '').replace(/\n?View all [\d,.]+ comments[\s\S]*$/, '') : ''; });
    const username = await p.evaluate(() => (document.querySelector('.UsernameText, .CaptionUsername') || {}).innerText || '');
    const seen = [];
    for (let i = 0; i < 25; i++) {
      const srcs = await p.evaluate(() => [...document.querySelectorAll('img')].filter(x => x.naturalWidth >= 300).map(x => x.currentSrc || x.src).filter(s => /cdninstagram|fbcdn/.test(s)));
      srcs.forEach(s => { if (!seen.includes(s)) seen.push(s); });
      const nx = await p.$('button[aria-label="Next"], .coreSpriteRightChevron');
      if (!nx) break; await nx.click(); await p.waitForTimeout(900);
    }
    out = { caption, slides: seen, username };
  }
  console.log(JSON.stringify(out));
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
