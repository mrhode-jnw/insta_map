// Core services of the Sehschule web app: encryption, GitHub-backed state, encrypted media, Claude API.
// Everything private (images, user data, API keys) is AES-GCM encrypted; the media key itself is
// stored in config.js encrypted with the access code (same scheme as the Insta Map, see ../crypto.js).

export const REPO = "mrhode-jnw/insta_map";
export const PAGE_BRANCH = "claude/sweet-mayer-wqdght";
export const DATA_BRANCH = "map-data";
export const MEDIA_BRANCH = "sehschule-media";
const STATE_DIR = "sehschule";
const te = new TextEncoder(), td = new TextDecoder();

// ---------- small helpers
export const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const b64FromBytes = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const bytesFromB64 = b64 => Uint8Array.from(atob(b64.replace(/\s/g, "")), c => c.charCodeAt(0));
const hexToBytes = hex => Uint8Array.from(hex.match(/../g).map(h => parseInt(h, 16)));

// ---------- session: keys unlocked with the access code
export const session = { mediaKey: null, provider: "anthropic", anthropicKey: "", openaiKey: "", ghToken: "",
  model: "claude-opus-5-5", effort: "high", openaiModel: "gpt-5" };

export async function unlock(code) {
  const C = window.InstaMapCrypto;
  if (!window.SEHSCHULE_MEDIA_KEY_ENC) throw new Error("Noch nicht eingerichtet – bitte setup.html öffnen.");
  let mediaHex;
  try { mediaHex = await C.decrypt(window.SEHSCHULE_MEDIA_KEY_ENC, code); }
  catch { throw new Error("Falscher Zugangscode."); }
  session.mediaKey = await crypto.subtle.importKey("raw", hexToBytes(mediaHex.trim()), "AES-GCM", false, ["encrypt", "decrypt"]);
  if (window.SEHSCHULE_ANTHROPIC_KEY_ENC) {
    try { session.anthropicKey = (await C.decrypt(window.SEHSCHULE_ANTHROPIC_KEY_ENC, code)).trim(); } catch {}
  }
  if (window.SEHSCHULE_OPENAI_KEY_ENC) {
    try { session.openaiKey = (await C.decrypt(window.SEHSCHULE_OPENAI_KEY_ENC, code)).trim(); } catch {}
  }
  if (window.GITHUB_TOKEN_ENC) {
    try { session.ghToken = (await C.decrypt(window.GITHUB_TOKEN_ENC, code)).trim(); } catch {}
  }
  session.ghToken = session.ghToken || store.get("ghToken") || "";
  session.model = window.SEHSCHULE_MODEL || session.model;
  session.effort = window.SEHSCHULE_EFFORT || session.effort;
  session.openaiModel = window.SEHSCHULE_OPENAI_MODEL || session.openaiModel;
  // Provider from config; falls back to whichever key exists.
  session.provider = window.SEHSCHULE_PROVIDER || (session.anthropicKey ? "anthropic" : "openai");
  if (session.provider === "openai" && !session.openaiKey && session.anthropicKey) session.provider = "anthropic";
  if (session.provider === "anthropic" && !session.anthropicKey && session.openaiKey) session.provider = "openai";
}

export async function encryptBytes(bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, session.mediaKey, bytes));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return out;
}
export async function decryptBytes(buf) {
  const u8 = new Uint8Array(buf);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: u8.slice(0, 12) }, session.mediaKey, u8.slice(12)));
}

// ---------- GitHub contents API
const ghHeaders = () => ({ Accept: "application/vnd.github+json", ...(session.ghToken ? { Authorization: `Bearer ${session.ghToken}` } : {}) });
const contentsUrl = path => `https://api.github.com/repos/${REPO}/contents/${path}`;
export const rawUrl = (path, branch) => `https://raw.githubusercontent.com/${REPO}/${branch}/${path}`;

async function ensureBranch(branch, orphanFromPage = false) {
  const h = ghHeaders();
  const br = await fetch(`https://api.github.com/repos/${REPO}/branches/${encodeURIComponent(branch)}`, { headers: h });
  if (br.ok) return;
  if (!orphanFromPage) throw new Error(`Branch ${branch} fehlt`);
  const ref = await fetch(`https://api.github.com/repos/${REPO}/git/ref/heads/${encodeURIComponent(PAGE_BRANCH)}`, { headers: h }).then(r => r.json());
  const c = await fetch(`https://api.github.com/repos/${REPO}/git/refs`, { method: "POST", headers: h,
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: ref.object.sha }) });
  if (!c.ok && c.status !== 422) throw new Error(`Branch ${branch} anlegen: GitHub ${c.status}`);
}

async function ghGetFile(path, branch) {
  const r = await fetch(`${contentsUrl(path)}?ref=${encodeURIComponent(branch)}&t=${Date.now()}`, { headers: ghHeaders(), cache: "no-store" });
  if (r.status === 404) return { text: null, sha: null };
  if (r.status === 401) throw new Error("GitHub-Token ungültig");
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const j = await r.json();
  if (j.content && j.encoding === "base64" && j.size < 900000) return { text: td.decode(bytesFromB64(j.content)), sha: j.sha };
  // large files: content is not inlined, fetch the blob
  const blob = await fetch(j.git_url, { headers: ghHeaders() }).then(x => x.json());
  return { text: td.decode(bytesFromB64(blob.content)), sha: j.sha };
}

export async function ghPutBytes(path, branch, bytes, message, sha = null) {
  if (!session.ghToken) throw new Error("Kein GitHub-Token – Speichern nicht möglich.");
  const r = await fetch(contentsUrl(path), { method: "PUT", headers: ghHeaders(),
    body: JSON.stringify({ message, branch, content: b64FromBytes(bytes), ...(sha ? { sha } : {}) }) });
  if (r.status === 401 || r.status === 403) throw new Error("GitHub-Token ungültig oder ohne Schreibrecht");
  return r;
}

// ---------- encrypted JSON state in map-data/sehschule/<name>.enc
const stateCache = new Map();

async function decodeState(text) {
  return JSON.parse(td.decode(await decryptBytes(bytesFromB64(text.trim()))));
}
async function encodeState(obj) {
  return te.encode(b64FromBytes(await encryptBytes(te.encode(JSON.stringify(obj)))) + "\n");
}

export async function loadState(name, empty) {
  if (stateCache.has(name)) return stateCache.get(name).value;
  const path = `${STATE_DIR}/${name}.enc`;
  let value = empty, sha = null;
  if (session.ghToken) {
    const f = await ghGetFile(path, DATA_BRANCH).catch(e => { console.warn(name, e); return { text: null, sha: null }; });
    if (f.text) value = await decodeState(f.text);
    sha = f.sha;
  } else {
    const r = await fetch(`${rawUrl(path, DATA_BRANCH)}?t=${Date.now()}`, { cache: "no-store" });
    if (r.ok) value = await decodeState(await r.text());
  }
  stateCache.set(name, { value, sha });
  return value;
}

// Fetch fresh, apply fn, write back; on a conflict retry once with the newer version.
export async function mutateState(name, empty, fn, message) {
  const path = `${STATE_DIR}/${name}.enc`;
  await ensureBranch(DATA_BRANCH, true);
  for (let attempt = 0; attempt < 3; attempt++) {
    const f = await ghGetFile(path, DATA_BRANCH);
    const current = f.text ? await decodeState(f.text) : structuredClone(empty);
    const next = fn(current) ?? current;
    const r = await ghPutBytes(path, DATA_BRANCH, await encodeState(next), message, f.sha);
    if (r.ok) { stateCache.set(name, { value: next, sha: (await r.json()).content.sha }); return next; }
    if (r.status !== 409 && r.status !== 422) throw new Error(`Speichern: GitHub ${r.status}`);
  }
  throw new Error("Speichern fehlgeschlagen (Konflikt)");
}

// ---------- encrypted media (branch sehschule-media: m/<id>.bin full, t/<id>.bin thumb)
const blobUrls = new Map();
const pending = new Map();
let active = 0; const queue = [];
const limit = fn => new Promise((res, rej) => {
  const run = () => { active++; fn().then(res, rej).finally(() => { active--; queue.length && queue.shift()(); }); };
  active < 6 ? run() : queue.push(run);
});

async function fetchMedia(path) {
  let cache = null;
  try { cache = await caches.open("sehschule-media-v1"); } catch {}
  const url = rawUrl(path, MEDIA_BRANCH);
  let res = cache && await cache.match(url);
  if (!res) {
    res = await fetch(url);
    if (!res.ok) throw new Error(`Bild ${path}: ${res.status}`);
    if (cache) await cache.put(url, res.clone()).catch(() => {});
  }
  return decryptBytes(await res.arrayBuffer());
}

export function mediaUrl(id, kind = "t") {
  const key = `${kind}/${id}`;
  if (blobUrls.has(key)) return Promise.resolve(blobUrls.get(key));
  if (!pending.has(key)) {
    pending.set(key, limit(() => fetchMedia(`${key}.bin`)).then(bytes => {
      const u = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
      blobUrls.set(key, u); return u;
    }).finally(() => pending.delete(key)));
  }
  return pending.get(key);
}

export async function mediaBase64(id) {
  return b64FromBytes(await fetchMedia(`m/${id}.bin`));
}

export async function uploadMedia(id, fullJpeg, thumbJpeg) {
  await ensureBranch(MEDIA_BRANCH);
  for (const [kind, bytes] of [["m", fullJpeg], ["t", thumbJpeg]]) {
    const r = await ghPutBytes(`${kind}/${id}.bin`, MEDIA_BRANCH, await encryptBytes(bytes), `Bild ${id}`);
    if (!r.ok) throw new Error(`Bild hochladen: GitHub ${r.status}`);
  }
}

// ---------- AI providers (direct from the browser): Claude (Anthropic) or OpenAI
export class AIError extends Error {}

const prompts = new Map();
export async function prompt(name) {
  if (!prompts.has(name)) {
    const r = await fetch(`prompts/${name}.md`);
    if (!r.ok) throw new Error(`Prompt ${name} fehlt`);
    prompts.set(name, await r.text());
  }
  return prompts.get(name);
}

export const providerLabel = () => session.provider === "openai" ? `OpenAI (${session.openaiModel})` : `Claude (${session.model})`;

// content: string or Anthropic-style blocks [{type:"text"}|{type:"image", source:{base64}}]
export async function ai(opts) {
  return session.provider === "openai" ? openai(opts) : anthropic(opts);
}

async function anthropic({ system, content, schema = null, maxTokens = 16000 }) {
  if (!session.anthropicKey) throw new AIError("Kein Anthropic-API-Key hinterlegt (setup.html).");
  const body = {
    model: session.model, max_tokens: maxTokens, system, messages: [{ role: "user", content }],
    output_config: { effort: session.effort, ...(schema ? { format: { type: "json_schema", schema } } : {}) },
  };
  const send = async withFallback => {
    const headers = {
      "content-type": "application/json", "x-api-key": session.anthropicKey,
      "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true",
    };
    // Server-side fallback when the model declines a request (refusal).
    if (withFallback) headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
    return fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers,
      body: JSON.stringify(withFallback ? { ...body, fallbacks: "default" } : body) });
  };
  let r;
  try {
    r = await send(true);
    if (r.status === 400) {
      const err = await r.clone().json().catch(() => ({}));
      if (/fallback/i.test(JSON.stringify(err))) r = await send(false);
    }
  } catch { throw new AIError("Keine Verbindung zur Claude API."); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw httpError(r.status, j.error?.message || r.statusText);
  if (j.stop_reason === "refusal") throw new AIError("Das Modell hat die Anfrage abgelehnt.");
  if (j.stop_reason === "max_tokens") throw new AIError("Antwort wurde abgeschnitten.");
  const text = (j.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
  return result(text, j.model, schema);
}

async function openai({ system, content, schema = null, maxTokens = 16000 }) {
  if (!session.openaiKey) throw new AIError("Kein OpenAI-API-Key hinterlegt (setup.html).");
  const parts = typeof content === "string" ? [{ type: "text", text: content }] : content.map(b => b.type === "image"
    ? { type: "image_url", image_url: { url: `data:${b.source.media_type};base64,${b.source.data}`, detail: "high" } }
    : { type: "text", text: b.text });
  const body = {
    model: session.openaiModel, max_completion_tokens: maxTokens,
    messages: [{ role: "system", content: system }, { role: "user", content: parts }],
    ...(schema ? { response_format: { type: "json_schema", json_schema: { name: "result", strict: true, schema } } } : {}),
  };
  let r;
  try {
    r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session.openaiKey}` }, body: JSON.stringify(body) });
  } catch { throw new AIError("Keine Verbindung zur OpenAI API."); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw httpError(r.status, j.error?.message || r.statusText);
  const choice = j.choices?.[0] || {};
  if (choice.message?.refusal) throw new AIError("Das Modell hat die Anfrage abgelehnt.");
  if (choice.finish_reason === "length") throw new AIError("Antwort wurde abgeschnitten.");
  return result((choice.message?.content || "").trim(), j.model, schema);
}

function httpError(status, msg) {
  if (status === 401) return new AIError("API-Key ungültig.");
  if (status === 429) return new AIError("Rate-Limit oder Guthaben erschöpft – bitte später erneut versuchen.");
  return new AIError(`API-Fehler ${status}: ${msg}`);
}

function result(text, model, schema) {
  if (!schema) return { text, model };
  try { return { data: JSON.parse(text), model }; }
  catch { throw new AIError("Antwort entsprach nicht dem Schema."); }
}
