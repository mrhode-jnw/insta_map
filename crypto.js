// AES-GCM-Verschlüsselung des Google-Maps-Keys mit einem Zugangscode (PBKDF2-SHA256).
// Format: base64(salt[16] | iv[12] | ciphertext)
window.InstaMapCrypto = (() => {
  const ITER = 250000;
  const te = new TextEncoder(), td = new TextDecoder();
  const b64 = u8 => btoa(String.fromCharCode(...u8));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function derive(code, salt) {
    const base = await crypto.subtle.importKey("raw", te.encode(code), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function encrypt(plain, code) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await derive(code, salt), te.encode(plain)));
    const out = new Uint8Array(28 + ct.length); out.set(salt); out.set(iv, 16); out.set(ct, 28);
    return b64(out);
  }
  async function decrypt(blob, code) {
    const raw = unb64(blob);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(16, 28) },
      await derive(code, raw.slice(0, 16)), raw.slice(28));
    return td.decode(pt);
  }
  return { encrypt, decrypt };
})();
