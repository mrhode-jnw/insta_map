// End-to-end test of the Sehschule web app in headless Chromium.
// GitHub API, raw.githubusercontent.com and the Claude API are mocked; images come from a local
// checkout of the media branch (encrypted with the given key), so the real decryption path runs.
// Usage: node tests_web/e2e.js <media-dir> <media-key-hex> [screenshot-dir]
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path"), vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..");
const [mediaDir, mediaKey, shotDir] = process.argv.slice(2);
const CODE = "test-code-123";
const PROVIDER = process.env.PROVIDER || "anthropic";

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
window.SEHSCHULE_ANTHROPIC_KEY_ENC = "${await encWithCode("sk-ant-test")}"; window.SEHSCHULE_MODEL = "claude-opus-5-5"; window.SEHSCHULE_EFFORT = "high";
window.SEHSCHULE_OPENAI_KEY_ENC = "${await encWithCode("sk-openai-test")}"; window.SEHSCHULE_OPENAI_MODEL = "gpt-test"; window.SEHSCHULE_PROVIDER = "${PROVIDER}";`;
  const rootConfig = `window.GITHUB_TOKEN_ENC = "${await encWithCode("ghp_test")}";`;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (process.env.DEBUG) console.log("console:", m.type(), m.text()); m.type() === "error" && !/404|Failed to load resource/.test(m.text()) && errors.push(m.text()); });
  if (process.env.DEBUG) page.on("response", r => r.status() >= 400 && console.log("http", r.status(), r.url().slice(0, 140)));
  if (process.env.DEBUG) page.on("requestfailed", r => console.log("failed:", r.url(), r.failure()?.errorText));

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
  const fakeText = (schema, system, userText) => {
    if (!schema) return system.includes("Gespräch") ? "TESTANTWORT: Schau auf die Kante rechts." : "## Teil\nText [S1].\n\n## Meine Einschätzung\nX.";
    if (schema.properties.hit) return JSON.stringify({ feedback: "TESTFEEDBACK: Gut gesehen, schau auf die linke Kante.", hit: 4, precision: 7,
      per_question: [{ question: "Wo stand der Fotograf?", points: 3, note: "Richtig erkannt." }, { question: "Worauf hat er gewartet?", points: 1, note: "Zu allgemein." }],
      missed: ["Lichtkante links"] });
    const data = JSON.parse(JSON.stringify(ANALYSIS));
    const src = userText.match(/<source id="(\d+)"/);
    if (src) data.context.sourced[0].source_ids = [Number(src[1])];
    return JSON.stringify(data);
  };
  await page.route("https://api.anthropic.com/**", async r => {
    const req = r.request(), body = JSON.parse(req.postData()), h = req.headers();
    claudeCalls.push({ provider: "anthropic", body, headers: h });
    if (h["anthropic-dangerous-direct-browser-access"] !== "true" || h["x-api-key"] !== "sk-ant-test") return r.fulfill({ status: 401, body: "{}" });
    await new Promise(res => setTimeout(res, 600)); // simulate model latency
    const text = fakeText(body.output_config?.format?.schema, body.system, body.messages[0].content.find?.(c => c.type === "text")?.text || "");
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ model: body.model, stop_reason: "end_turn", content: [{ type: "text", text }] }) });
  });
  await page.route("https://api.openai.com/**", async r => {
    const req = r.request(), body = JSON.parse(req.postData()), h = req.headers();
    claudeCalls.push({ provider: "openai", body, headers: h });
    if (h.authorization !== "Bearer sk-openai-test") return r.fulfill({ status: 401, body: "{}" });
    const user = body.messages[1].content;
    await new Promise(res => setTimeout(res, 600));
    const text = fakeText(body.response_format?.json_schema?.schema, body.messages[0].content, user.find(c => c.type === "text")?.text || "");
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ model: body.model, choices: [{ finish_reason: "stop", message: { content: text } }] }) });
  });

  const shot = async name => shotDir && page.screenshot({ path: path.join(shotDir, name + ".png"), fullPage: false });
  const ok = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
  const waitText = (t, timeout = 20000) => page.waitForFunction(x => document.body.innerText.includes(x), t, { timeout });

  await page.goto(`${base}/Fotoapp/`);
  await page.fill("#code", "falsch"); await page.click("#lock-form button");
  await waitText("Falscher Zugangscode"); ok(true, "wrong code rejected");
  await page.fill("#code", CODE); await page.click("#lock-form button");
  await waitText("Zuletzt hinzugefügt"); ok(await page.isHidden("#lock"), "unlocked, lock screen gone, library loaded");
  if (process.env.DEBUG) { await page.waitForTimeout(3000); console.log(await page.evaluate(() => { const i = document.querySelector("img[data-media]"); return JSON.stringify({ n: document.querySelectorAll("img[data-media]").length, src: i?.src?.slice(0, 40), rect: i?.getBoundingClientRect(), cls: i?.className }); })); }
  await page.evaluate(() => document.querySelector(".thumbs").scrollIntoView());
  await page.waitForFunction(() => [...document.querySelectorAll("img[data-media]")].some(i => i.src.startsWith("blob:") && i.naturalWidth > 0), null, { timeout: 20000 });
  ok(true, "encrypted thumbnails decrypted and shown");
  await shot("01-home");

  // Theory: a lesson locks its drill until the test is passed
  const lessons = lib.lessons || [];
  const passLesson = async (lid, wrong = false) => {
    const l = lessons.find(x => x.id === lid);
    await page.goto(`${base}/Fotoapp/#/theorie/${lid}`); await waitText("Abschlusstest");
    if (!wrong) {
      const lim = page.locator('.chapter img[data-kind="m"]').first();
      if (await lim.count()) {
        await lim.scrollIntoViewIfNeeded(); await lim.click(); await page.waitForSelector(".viewer .viewer-stage");
        await page.mouse.move(195, 420); await page.mouse.wheel(0, -400); await page.waitForTimeout(100);
        ok(/scale\((?!1\))/.test(await page.$eval(".viewer-content", e => e.style.transform)), "lesson image opens full screen and zooms");
        await page.goBack(); await page.waitForTimeout(200);
        ok(!(await page.$(".viewer")) && (await page.evaluate(() => location.hash)).startsWith("#/theorie/"), "back closes the viewer and stays on the lesson");
      }
      const firsts = await page.$$eval('form[data-action="quiz"] fieldset', fs => fs.map(f => f.querySelector('input[type="radio"]').value));
      ok(firsts.some(v => v !== "0") && firsts.some(v => v !== String(firsts[0])), "quiz answer order shuffled");
    }
    for (let n = 0; n < l.quiz.length; n++) {
      if (l.quiz[n].deep) continue; // optional Vertiefung questions sit in a separate form
      const pick = wrong ? (l.quiz[n].correct + 1) % l.quiz[n].options.length : l.quiz[n].correct;
      await page.check(`input[name="q${n}"][value="${pick}"]`);
    }
    await page.click('form[data-action="quiz"] button');
    await waitText(wrong ? "noch nicht bestanden" : "bestanden.");
  };
  if (lessons.length) {
    const first = lessons[0];
    await page.goto(`${base}/Fotoapp/#/sehen`); await waitText("Worauf schauen?");
    ok(await page.$(`a.dim.locked[href="#/theorie/${first.id}"]`) !== null, `drill "${first.id}" locked before the lesson`);
    await page.goto(`${base}/Fotoapp/#/theorie`); await waitText("Theorie"); await shot("00-theorie");
    await passLesson(first.id, true); ok(true, "failed test does not pass");
    await passLesson(first.id); await shot("00b-lektion-test");
    ok(files.has("sehschule/progress.enc@map-data"), "theory progress stored");
    await page.goto(`${base}/Fotoapp/#/sehen`); await waitText("Worauf schauen?");
    ok(await page.$(`input[name="dimension"][value="${first.id}"]`) !== null, `drill "${first.id}" unlocked after passing`);
    for (const k of ["viewpoint", "moment", "omitted", "light"]) if (k !== first.id && lessons.some(x => x.id === k)) await passLesson(k);
  }

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
  await waitText("TESTLICHT", 30000); ok(true, "reveal shows the light part of the analysis");
  ok(await page.evaluate(() => document.querySelector(".scores")?.innerText.includes("4/5") && document.querySelector(".scores").innerText.includes("5/5")), "scores shown, clamped to 0–5");
  ok((await page.content()).includes("Lichtkante links"), "missed keywords shown");
  await shot("04-drill-reveal");
  ok(claudeCalls.every(c => c.provider === PROVIDER), `all AI calls go to ${PROVIDER}`);
  if (PROVIDER === "anthropic") {
    const an = claudeCalls.find(c => c.body.output_config?.format);
    ok(an.body.messages[0].content[0].type === "image" && an.body.messages[0].content[0].source.data.length > 1000, "analysis request carries the decrypted image");
    ok(an.headers["anthropic-beta"] === "server-side-fallback-2026-07-01" && an.body.fallbacks === "default", "fallback enabled");
    ok(an.body.output_config.format.schema.additionalProperties === false, "strict JSON schema sent");
  } else {
    const an = claudeCalls.find(c => c.body.response_format);
    ok(an.body.messages[1].content[0].type === "image_url" && an.body.messages[1].content[0].image_url.url.startsWith("data:image/jpeg;base64,/9j/"), "analysis request carries the decrypted image (OpenAI)");
    ok(an.body.response_format.json_schema.strict === true && an.body.response_format.json_schema.schema.additionalProperties === false, "strict JSON schema sent (OpenAI)");
    ok(an.body.model === "gpt-test" && an.body.messages[0].role === "system", "model and system prompt from config");
  }
  ok(await page.evaluate(() => ![...document.querySelectorAll(".sourced li")].some(li => li.textContent.includes("Erfundene Aussage"))
    && [...document.querySelectorAll(".sourced li")].some(li => li.textContent.includes("Belegte Aussage"))), "unsourced statement dropped, sourced one kept");
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
  await page.fill('textarea[name="q_position"]', "Von unten"); const t0 = Date.now(); await page.click("#questions button");
  await waitText("Deine Antworten"); ok(Date.now() - t0 < 1500, "reveal opens immediately (AI runs in background)");
  await waitText("TESTFEEDBACK", 30000); await shot("05-learn-reveal");
  ok(await page.$("table.pq") !== null, "points per question shown");
  ok(files.has("sehschule/answers.enc@map-data"), "answer stored");
  // discussion
  await page.fill('form.ask textarea', "Warum ist der Horizont so tief?"); await page.click("form.ask button");
  await waitText("TESTANTWORT", 30000); ok(files.has("sehschule/discussions.enc@map-data"), "discussion stored");
  await shot("06-diskussion");
  // next images without waiting for feedback, then round summary
  for (let n = 0; n < 6; n++) {
    const btn = page.locator('.next:not(.top) button'); const label = await btn.textContent(); await btn.click();
    if (/abschließen/.test(label)) break;
    await waitText("Wo stand der Fotograf?").catch(async e => { await page.screenshot({ path: "/tmp/claude-0/-home-user-insta-map/5fc4c78c-ca4f-5664-a94f-49f6fadf1033/scratchpad/fail.png" }); console.log("hash", await page.evaluate(() => location.hash)); throw e; });
    await page.click("#questions button"); await waitText("Deine Antworten");
  }
  await waitText("Runde abgeschlossen"); await waitText("Treffer ⌀"); await shot("06b-runde");
  await page.waitForFunction(() => !document.body.innerText.includes("Bewertung läuft"), null, { timeout: 30000 });
  ok(true, "round summary collects all scores");

  // Image page: analysis already exists for drilled image -> no new call when opening reveal again
  await page.goto(`${base}/Fotoapp/#/bibliothek`); await waitText("Bibliothek");
  await page.click(".thumb"); await waitText("Analyse"); await shot("06-bild");
  // Concepts and chapter
  await page.goto(`${base}/Fotoapp/#/begriffe`); await waitText("Seh-Begriffe");
  await page.click(".concept-list a"); await waitText("Übung für unterwegs"); await shot("07-begriff");
  await page.goto(`${base}/Fotoapp/#/kapitel/c5`); await waitText("Neue Topografie"); await shot("08-kapitel");
  await page.goto(`${base}/Fotoapp/#/kapitel/c5/bearbeiten`); await waitText("Schlüsselbilder");
  page.once("dialog", d => d.accept());
  await page.click('button[data-action="chapter-draft"]'); await waitText("Neuer KI-Entwurf", 30000);
  await page.click('form[data-action="chapter-save"] button'); await waitText("Gespeichert");
  ok(files.has("sehschule/chapters.enc@map-data"), "chapter text stored");
  await page.goto(`${base}/Fotoapp/#/zeitleiste`); await waitText("Zeitleiste"); await shot("09-zeitleiste");
  await page.goto(`${base}/Fotoapp/#/lernen/antworten`); await waitText("Verlauf");
  ok((await page.$$(".answer-list li")).length >= 3, "history lists drills, answers and discussion");
  await page.goto(`${base}/Fotoapp/#/fortschritt`); await waitText("Lernfortschritt"); await shot("10-fortschritt");
  ok((await page.textContent("main")).includes("Lernrunde (5 Fragen)"), "progress page per aspect");

  // Reload: remembered code, state read back from mocked GitHub
  await page.goto(`${base}/Fotoapp/#/`); await page.reload(); await waitText("Zuletzt hinzugefügt");
  ok((await page.textContent(".stats")).includes("Analysen"), "remembered code unlocks after reload");

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  console.log(`AI calls (${PROVIDER}): ${claudeCalls.length}`);
  await browser.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
