const syncTimers = new Map();

function base64(bytes) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

async function importPublicKey(pem) {
  const body = pem.replace(/-----(BEGIN|END) PUBLIC KEY-----|\s/g, "");
  const bytes = Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
  return crypto.subtle.importKey("spki", bytes, { name: "X25519" }, false, []);
}

async function encrypt(publicKeyPem, snapshot) {
  const recipient = await importPublicKey(publicKeyPem);
  const ephemeral = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const shared = await crypto.subtle.deriveBits({ name: "X25519", public: recipient }, ephemeral.privateKey, 256);
  const hkdfKey = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: new TextEncoder().encode("cookie-sync-v1") }, hkdfKey, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(snapshot))));
  const rawPublicKey = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));
  const prefix = Uint8Array.from([48, 42, 48, 5, 6, 3, 43, 110, 110, 3, 33, 0]);
  const spki = new Uint8Array(prefix.length + rawPublicKey.length);
  spki.set(prefix); spki.set(rawPublicKey, prefix.length);
  return { ephemeralPublicKey: `-----BEGIN PUBLIC KEY-----\n${base64(spki)}\n-----END PUBLIC KEY-----`, iv: base64(iv), ciphertext: base64(encrypted.slice(0, -16)), tag: base64(encrypted.slice(-16)) };
}

async function syncDomain(domain) {
  const { relay, deviceId, uploadToken, publicKey } = await chrome.storage.local.get(["relay", "deviceId", "uploadToken", "publicKey"]);
  if (!relay || !deviceId || !uploadToken || !publicKey) return;
  const cookies = await chrome.cookies.getAll({ domain });
  const envelope = await encrypt(publicKey, { domain, cookies, syncedAt: new Date().toISOString() });
  const response = await fetch(`${relay}/v1/messages`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${uploadToken}` }, body: JSON.stringify({ deviceId, domain, envelope }) });
  if (!response.ok) throw new Error((await response.json()).error || "Cookie upload failed.");
}

function schedule(domain) {
  clearTimeout(syncTimers.get(domain));
  syncTimers.set(domain, setTimeout(() => syncDomain(domain).catch(() => {}), 1500));
}

async function syncAll() {
  const cookies = await chrome.cookies.getAll({});
  const domains = new Set(cookies.map((cookie) => cookie.domain.replace(/^\./, "")));
  await Promise.all([...domains].map((domain) => syncDomain(domain)));
}

chrome.cookies.onChanged.addListener(({ cookie }) => schedule(cookie.domain.replace(/^\./, "")));
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "sync-all") syncAll().then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ error: error.message }));
  return true;
});
chrome.runtime.onStartup.addListener(syncAll);
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create("cookie-sync", { periodInMinutes: 15 }));
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "cookie-sync") syncAll(); });
