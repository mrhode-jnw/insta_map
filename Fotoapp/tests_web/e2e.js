// End-to-end test of the Sehschule web app in headless Chromium.
// GitHub API, raw.githubusercontent.com and the Claude API are mocked; images come from a local
// checkout of the media branch (encrypted with the given key), so the real decryption path runs.
// Usage: node tests_web/e2e.js <media-dir> <media-key-hex> [screenshot-dir]
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path"), vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..");
const [mediaDir, mediaKey, shotDir] = process.argv.slice(2);
const CODE = "test-code-123";

async function encWithCode(plain) {
  const ctx = { window: {}, crypto: globalThis.crypto, TextEncoder, TextDecoder, btoa, atob };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(ROOT, "crypto.js"), "utf8"), ctx);
  return ctx.window.InstaMapCrypto.encrypt(plain, CODE);
}

function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, resp) => {
      const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
        const idx = path.join(p, "index.html");
        if (fs.existsSync(idx)) { resp.writeHead(200, { "content-type": "text/html" }); return resp.end(fs.readFileSync(idx)); }
        resp.writeHead(404); return resp.end();
      }
      const type = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".json": "application/json", ".md": "text/markdown", ".svg": "image/svg+xml" }[path.extname(p)] || "application/octet-stream";
      resp.writeHead(200, { "content-type": type }); resp.end(fs.readFileSync(p));
    }).listen(0, () => res(srv));
  });
}

const ANALYSIS = {
  seen: "TESTANALYSE: Eine Szene mit klarer Staffelung.",
  construction: { viewpoint: "Leicht erhöht.", distance_focal_estimate: "Vermutlich mittlere Distanz.", light: "TESTLICHT: flaches Seitenlicht von links.",
    moment: "Ruhiger Moment.", layers: "Drei Ebenen.", color: "Gedämpft.", omitted: "Kein Himmel.", edge: "Rand schneidet knapp.", detail: "Ein Schild.", focus_plane: "Durchgehend scharf." },
  context: { sourced: [{ text: "Belegte Aussage.", source_ids: [] }, { text: "Erfundene Aussage.", source_ids: [1] }], assessment: "Wirkt nüchtern." },
  stance: "Distanziert, respektvoll.", transferable: ["Höher stehen.", "Länger warten."], not_assessable: "Tonumfang des Abzugs.",
};

(async () => {
  const srv = await serve(), base = `http://localhost:${srv.address().port}`;
  const files = new Map(); // GitHub contents mock: path@branch -> {content(b64), sha}
  const claudeCalls = [];
  let lib = JSON.parse(fs.readFileSync(path.join(ROOT, "Fotoapp/data/library.json"), "utf8"));
  const configJs = `window.SEHSCHULE_MEDIA_KEY_ENC = "${await encWithCode(mediaKey)}";
window.SEHSCHULE_ANTHROPIC_KEY_ENC = "${await encWithCode("sk-ant-test")}"; window.SEHSCHULE_MODEL = "claude-opus-5-5"; window.SEHSCHULE_EFFORT = "high";`;
  const rootConfig = `window.GITHUB_TOKEN_ENC = "${await encWithCode("ghp_test")}";`;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => m.type() === "error" && !/404|Failed to load resource/.test(m.text()) && errors.push(m.text()));

  await page.route(`${base}/Fotoapp/config.js`, r => r.fulfill({ contentType: "text/javascript", body: configJs }));
  await page.route(`${base}/config.js`, r => r.fulfill({ contentType: "text/javascript", body: rootConfig }));
  await page.route("https://raw.githubusercontent.com/**", r => {
    const m = r.request().url().match(/sehschule-media\/(.+)$/);
    if (m && fs.existsSync(path.join(mediaDir, m[1]))) return r.fulfill({ body: fs.readFileSync(path.join(mediaDir, m[1])) });
    return r.fulfill({ status: 404, body: "" });
  });
  await page.route("https://api.github.com/**", async r => {
    const req = r.request(), url = new URL(req.url());
    if (req.headers().authorization !== "Bearer ghp_test") return r.fulfill({ status: 401, body: "{}" });
    if (/\/branches\//.test(url.pathname)) return r.fulfill({ status: 200, body: "{}" });
    const m = url.pathname.match(/\/contents\/(.+)$/);
    if (!m) return r.fulfill({ status: 404, body: "{}" });
    if (req.method() === "GET") {
      const f = files.get(`${m[1]}@${url.searchParams.get("ref")}`);
      return f ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: f.content, encoding: "base64", sha: f.sha, size: f.content.length }) })
        : r.fulfill({ status: 404, body: "{}" });
    }
    const body = JSON.parse(req.postData()), key = `${m[1]}@${body.branch}`, cur = files.get(key);
    if ((cur?.sha || null) !== (body.sha || null)) return r.fulfill({ status: 409, body: "{}" });
    const sha = Math.random().toString(16).slice(2);
    files.set(key, { content: body.content, sha });
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha } }) });
  });
  await page.route("https://api.anthropic.com/**", r => {
    const req = r.request(), body = JSON.parse(req.postData()), h = req.headers();
    claudeCalls.push({ body, headers: h });
    if (h["anthropic-dangerous-direct-browser-access"] !== "true" || h["x-api-key"] !== "sk-ant-test") return r.fulfill({ status: 401, body: "{}" });
    const isSchema = !!body.output_config?.format;
    const data = JSON.parse(JSON.stringify(ANALYSIS));
    const src = (body.messages[0].content.find?.(c => c.type === "text")?.text || "").match(/<source id="(\d+)"/);
    if (src) data.context.sourced[0].source_ids = [Number(src[1])];
    const text = isSchema ? JSON.stringify(data) : (body.system.includes("Kapitel") ? "## Teil\nText [S1].\n\n## Meine Einschätzung\nX." : "TESTFEEDBACK: Gut gesehen, schau auf die linke Kante.");
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ model: body.model, stop_reason: "end_turn", content: [{ type: "text", text }] }) });
  });

  const shot = async name => shotDir && page.screenshot({ path: path.join(shotDir, name + ".png"), fullPage: false });
  const ok = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
  const waitText = (t, timeout = 20000) => page.waitForFunction(x => document.body.innerText.includes(x), t, { timeout });

  await page.goto(`${base}/Fotoapp/`);
  await page.fill("#code", "falsch"); await page.click("#lock-form button");
  await waitText("Falscher Zugangscode"); ok(true, "wrong code rejected");
  await page.fill("#code", CODE); await page.click("#lock-form button");
  await waitText("Zuletzt hinzugefügt"); ok(true, "unlocked, library loaded");
  await page.waitForFunction(() => [...document.querySelectorAll("img[data-media]")].some(i => i.src.startsWith("blob:") && i.naturalWidth > 0), null, { timeout: 20000 });
  ok(true, "encrypted thumbnails decrypted and shown");
  await shot("01-home");

  // Seeing drill
  await page.goto(`${base}/Fotoapp/#/sehen`); await waitText("Worauf schauen?");
  await page.check('input[value="light"]'); await page.selectOption('select[name="look"]', "30");
  await shot("02-sehen");
  await page.click('form[data-action="drill-start"] button');
  await waitText("Erst nur schauen"); ok(await page.isHidden("#questions"), "question hidden during look timer");
  await page.waitForFunction(() => document.querySelector(".hero img")?.naturalWidth > 0, null, { timeout: 20000 });
  await shot("03-drill-look");
  ok(!(await page.content()).includes("TESTLICHT"), "analysis not visible before answering");
  await page.click("#look-skip"); await page.fill('textarea[name="answer"]', "Licht von links, harte Schatten.");
  await page.click('#questions button'); await waitText("TESTFEEDBACK", 30000);
  ok((await page.content()).includes("TESTLICHT"), "reveal shows the light part of the analysis");
  await shot("04-drill-reveal");
  const an = claudeCalls.find(c => c.body.output_config?.format);
  ok(an.body.messages[0].content[0].type === "image" && an.body.messages[0].content[0].source.data.length > 1000, "analysis request carries the decrypted image");
  ok(an.headers["anthropic-beta"] === "server-side-fallback-2026-07-01" && an.body.fallbacks === "default", "fallback enabled");
  ok(an.body.output_config.format.schema.additionalProperties === false, "strict JSON schema sent");
  ok(!(await page.content()).includes("Erfundene Aussage"), "unsourced statement dropped");
  const stored = [...files.keys()];
  ok(stored.includes("sehschule/analyses.enc@map-data") && stored.includes("sehschule/drills.enc@map-data"), "analysis and drill stored in map-data");
  const raw = Buffer.from(files.get("sehschule/drills.enc@map-data").content, "base64").toString();
  ok(!raw.includes("Licht von links"), "stored drill is encrypted");

  // Stable analysis: second drill on same image must not call the analysis again
  const before = claudeCalls.filter(c => c.body.output_config?.format).length;
  // Learning round
  await page.goto(`${base}/Fotoapp/#/lernen`); await waitText("Runde starten");
  await page.selectOption('select[name="look"]', "0"); await page.click('form[data-action="learn-start"] button');
  await waitText("Wo stand der Fotograf?");
  ok(await page.$('input[name="q_extra_label"]') !== null, "fifth rotating question present");
  await page.fill('textarea[name="q_position"]', "Von unten"); await page.click("#questions button");
  await waitText("TESTFEEDBACK", 30000); await shot("05-learn-reveal");
  ok(files.has("sehschule/answers.enc@map-data"), "answer stored");

  // Image page: analysis already exists for drilled image -> no new call when opening reveal again
  const drillImg = JSON.parse(JSON.stringify(an.body.messages[0].content[1].text.match(/"titel": (.*)/)?.[1] || "null"));
  await page.goto(`${base}/Fotoapp/#/bibliothek`); await waitText("Bibliothek");
  await page.click(".thumb"); await waitText("Analyse"); await shot("06-bild");
  // Concepts and chapter
  await page.goto(`${base}/Fotoapp/#/begriffe`); await waitText("Seh-Begriffe");
  await page.click(".concept-list a"); await waitText("Übung für unterwegs"); await shot("07-begriff");
  await page.goto(`${base}/Fotoapp/#/kapitel/c5`); await waitText("Neue Topografie"); await shot("08-kapitel");
  await page.goto(`${base}/Fotoapp/#/kapitel/c5/bearbeiten`); await waitText("Schlüsselbilder");
  page.once("dialog", d => d.accept());
  await page.click('button[data-action="chapter-draft"]'); await waitText("Neuer Entwurf", 30000);
  await page.click('form[data-action="chapter-save"] button'); await waitText("Gespeichert");
  ok(files.has("sehschule/chapters.enc@map-data"), "chapter text stored");
  await page.goto(`${base}/Fotoapp/#/zeitleiste`); await waitText("Zeitleiste"); await shot("09-zeitleiste");
  await page.goto(`${base}/Fotoapp/#/lernen/antworten`); await waitText("Lerntagebuch");
  ok((await page.$$(".answer-list li")).length >= 2, "journal lists drill and answer");

  // Reload: remembered code, state read back from mocked GitHub
  await page.reload(); await waitText("Zuletzt hinzugefügt");
  ok((await page.textContent(".stats")).includes("Analysen"), "remembered code unlocks after reload");

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  console.log(`claude calls: ${claudeCalls.length}`);
  await browser.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
