importScripts("i18n.js", "domains.js", "metadata.js");

const D = self.CookieSyncDomains;
const { browserMetadata } = self.CookieSyncMetadata;
const syncTimers = new Map();
const PAIRING_KEYS = ["deviceId", "uploadToken", "publicKey", "accessPolicy", "pendingPair", "pairedCode"];
const NOTIFIED_TTL_MS = 24 * 60 * 60 * 1000;
let deviceSocket;

// Cheap read for hot paths; nothing is read before the user accepts the disclosure.
async function storedScope() {
  const { consentVersion = 0, allowedDomains = [], allSites = false } = await chrome.storage.local.get(["consentVersion", "allowedDomains", "allSites"]);
  if (consentVersion < D.CONSENT_VERSION) return { allowed: [], allSites: false };
  return { allowed: allowedDomains, allSites };
}

// What may be synced right now. Sites whose access was withdrawn stay in the list (the popup offers to allow them
// again) but are skipped; that also covers sites added while "Sync all sites" was on, which Chrome does not record.
async function syncScope() {
  const scope = await storedScope();
  const allSites = scope.allSites && await chrome.permissions.contains({ origins: D.ALL_SITES });
  if (allSites !== scope.allSites) await chrome.storage.local.set({ allSites });
  const allowed = [];
  for (const domain of scope.allowed) if (allSites || await chrome.permissions.contains({ origins: D.originsFor(domain) })) allowed.push(domain);
  return { allowed, allSites };
}

async function currentLang() {
  const { lang } = await chrome.storage.local.get("lang");
  if (lang && self.CookieSyncI18n.LANGS.includes(lang)) return lang;
  return self.CookieSyncI18n.detectLang();
}

async function t(key, params) {
  return self.CookieSyncI18n.t(await currentLang(), key, params);
}

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
  const prefix = Uint8Array.from([48, 42, 48, 5, 6, 3, 43, 101, 110, 3, 33, 0]);
  const spki = new Uint8Array(prefix.length + rawPublicKey.length);
  spki.set(prefix); spki.set(rawPublicKey, prefix.length);
  return { ephemeralPublicKey: `-----BEGIN PUBLIC KEY-----\n${base64(spki)}\n-----END PUBLIC KEY-----`, iv: base64(iv), ciphertext: base64(encrypted.slice(0, -16)), tag: base64(encrypted.slice(-16)) };
}

// The pairing was deleted on the relay (the CLI ran revoke): forget it, as the popup's revoke button does.
async function forgetPairing() {
  const { deviceId } = await chrome.storage.local.get("deviceId");
  if (!deviceId) return;
  await chrome.storage.local.remove(PAIRING_KEYS);
  deviceSocket?.close();
  deviceSocket = undefined;
  const lang = await currentLang();
  const i18n = self.CookieSyncI18n;
  try {
    await chrome.notifications.create(`revoked:${Date.now()}`, {
      type: "basic", iconUrl: chrome.runtime.getURL("icon.png"), title: i18n.t(lang, "notify.revokedTitle"), message: i18n.t(lang, "notify.revokedMessage"), priority: 1
    });
  } catch (error) {
    console.warn("CookieSync notification unavailable:", error.message);
  }
}

// Reads a relay error. Only unknown_device means the pairing is gone; any other 401 may be a passing relay problem.
async function relayError(response, fallbackKey) {
  const value = await response.json().catch(() => ({}));
  if (response.status === 401 && value.code === "unknown_device") await forgetPairing();
  return new Error(value.error || await t(fallbackKey));
}

async function uploadWithRetry(url, options) {
  let response = await fetch(url, options);
  if (response.status === 429) {
    const retryAfter = Math.min(60, Math.max(1, Number(response.headers.get("retry-after")) || 1));
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    response = await fetch(url, options);
  }
  if (!response.ok) throw await relayError(response, "error.uploadFailed");
  return response;
}

async function syncDomain(domain) {
  const { relay, deviceId, uploadToken, publicKey } = await chrome.storage.local.get(["relay", "deviceId", "uploadToken", "publicKey"]);
  if (!relay || !deviceId || !uploadToken || !publicKey) return;
  const scope = await syncScope();
  if (!scope.allSites && !scope.allowed.includes(domain)) return;
  const cookies = await chrome.cookies.getAll({ domain });
  const envelope = await encrypt(publicKey, { domain, cookies, syncedAt: new Date().toISOString() });
  const metadata = await browserMetadata();
  const options = { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${uploadToken}` }, body: JSON.stringify({ deviceId, domain, envelope, metadata }) };
  await uploadWithRetry(`${relay}/v1/messages`, options);
}

function schedule(domain) {
  clearTimeout(syncTimers.get(domain));
  syncTimers.set(domain, setTimeout(() => syncDomain(domain).catch(() => {}), 1500));
}

async function syncAll(only) {
  const { relay, deviceId, uploadToken, publicKey } = await chrome.storage.local.get(["relay", "deviceId", "uploadToken", "publicKey"]);
  if (!relay || !deviceId || !uploadToken || !publicKey) return;
  const scope = await syncScope();
  let domains = scope.allowed;
  if (scope.allSites) {
    const cookies = await chrome.cookies.getAll({});
    domains = [...new Set([...cookies.map((cookie) => cookie.domain.replace(/^\./, "").toLowerCase()), ...scope.allowed])];
  }
  if (only) domains = domains.filter((domain) => only.includes(domain));
  // One localhost or IP cookie would make the relay reject its whole batch.
  domains = domains.filter(D.isSyncable);
  if (!domains.length) return;
  const metadata = await browserMetadata();
  let failure;
  for (let index = 0; index < domains.length; index += 20) {
    const messages = await Promise.all(domains.slice(index, index + 20).map(async (domain) => {
      const domainCookies = await chrome.cookies.getAll({ domain });
      return { domain, envelope: await encrypt(publicKey, { domain, cookies: domainCookies, syncedAt: new Date().toISOString() }) };
    }));
    const options = { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${uploadToken}` }, body: JSON.stringify({ deviceId, messages, metadata }) };
    // A failed batch should not hold back the ones after it; report the first failure at the end.
    try {
      await uploadWithRetry(`${relay}/v1/messages/batch`, options);
    } catch (error) {
      failure ??= error;
      if (!(await chrome.storage.local.get("deviceId")).deviceId) break;
    }
  }
  if (failure) throw failure;
}

async function decide(requestId, decision) {
  const { relay, deviceId, uploadToken } = await chrome.storage.local.get(["relay", "deviceId", "uploadToken"]);
  const response = await fetch(`${relay}/v1/device/access-requests/${requestId}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${uploadToken}` }, body: JSON.stringify({ decision })
  });
  if (!response.ok) throw await relayError(response, "error.decisionFailed");
}

// The CLI asked for sites that are not synced yet; Chrome only grants new sites from a click in an extension page.
async function promptGrant(domains) {
  const { pendingDomains = [] } = await chrome.storage.local.get("pendingDomains");
  await chrome.storage.local.set({ pendingDomains: [...new Set([...pendingDomains, ...domains])] });
  const lang = await currentLang();
  const i18n = self.CookieSyncI18n;
  try {
    await chrome.notifications.create(`grant:${Date.now()}`, {
      type: "basic", iconUrl: chrome.runtime.getURL("icon.png"), title: i18n.t(lang, "notify.grantTitle"),
      message: i18n.t(lang, "notify.grantMessage", { domains: domains.join(", ") }), priority: 2, requireInteraction: true,
      buttons: [{ title: i18n.t(lang, "notify.grantButton") }]
    });
  } catch (error) {
    console.warn("CookieSync notification unavailable:", error.message);
  }
}

async function openGrant(notificationId) {
  chrome.notifications.clear(notificationId);
  try {
    await chrome.action.openPopup();
  } catch {
    await chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
  }
}

// Remembers which access requests were shown, for a day, so polling and the WebSocket do not notify twice.
async function markNotified(id) {
  const { notifiedRequests = {} } = await chrome.storage.local.get("notifiedRequests");
  if (notifiedRequests[id]) return false;
  const now = Date.now();
  const kept = Object.fromEntries(Object.entries(notifiedRequests).filter(([, at]) => now - at < NOTIFIED_TTL_MS));
  await chrome.storage.local.set({ notifiedRequests: { ...kept, [id]: now } });
  return true;
}

async function showAccessRequest(request) {
  if (!(await markNotified(request.id))) return;
  const scope = await syncScope();
  // pull-all asks for "*", which means whatever is already allowed.
  const requested = request.domains || [];
  const missing = scope.allSites ? [] : requested.filter((domain) => domain !== "*" && !scope.allowed.includes(domain));
  if (missing.length) await promptGrant(missing);
  // Nothing could be read, so a "cookies were read" notice would mislead; confirm mode still needs a decision.
  if (missing.length && missing.length === requested.length && request.mode !== "confirm") return;
  const confirm = request.mode === "confirm" && request.status === "pending";
  const lang = await currentLang();
  const i18n = self.CookieSyncI18n;
  try {
    await chrome.notifications.create(`access:${request.id}`, {
      type: "basic", iconUrl: chrome.runtime.getURL("icon.png"), title: i18n.t(lang, confirm ? "notify.titleConfirm" : "notify.titleDone"),
      message: `${i18n.t(lang, "audit.domainLabel", { domains: request.domains.join(", ") })}\n${i18n.t(lang, "audit.reasonLabel", { reason: request.reason || i18n.t(lang, "audit.noReason") })}`,
      priority: 2,
      ...(confirm ? { requireInteraction: true, buttons: [{ title: i18n.t(lang, "notify.allow") }, { title: i18n.t(lang, "notify.deny") }] } : {})
    });
  } catch (error) {
    console.warn("CookieSync notification unavailable:", error.message);
  }
}

async function pollAccessRequests() {
  const { relay, deviceId, uploadToken } = await chrome.storage.local.get(["relay", "deviceId", "uploadToken"]);
  if (!relay || !deviceId || !uploadToken) return;
  const response = await fetch(`${relay}/v1/device/access-requests?deviceId=${encodeURIComponent(deviceId)}`, { headers: { authorization: `Bearer ${uploadToken}` } });
  if (!response.ok) return void await relayError(response, "error.uploadFailed");
  for (const request of (await response.json()).requests) await showAccessRequest(request);
}

async function connectDeviceSocket() {
  const { relay, deviceId, uploadToken } = await chrome.storage.local.get(["relay", "deviceId", "uploadToken"]);
  if (!relay || !deviceId || !uploadToken) return;
  // The alarm calls this every minute; a live connection stays, so open-url commands are not lost while reconnecting.
  if (deviceSocket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(deviceSocket.readyState)) return;
  const url = new URL("/v1/device/ws", relay);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("deviceId", deviceId); url.searchParams.set("token", uploadToken);
  const socket = new WebSocket(url);
  deviceSocket = socket;
  socket.onclose = () => { if (deviceSocket === socket) deviceSocket = undefined; };
  socket.onmessage = async (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === "revoked") return forgetPairing();
    if (message.type === "access-request") return showAccessRequest({ id: message.requestId, ...message });
    if (message.type !== "open-url") return;
    try {
      const url = new URL(message.url);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP and HTTPS URLs can be opened.");
      await chrome.tabs.create({ url: url.href });
      deviceSocket?.send(JSON.stringify({ type: "command-result", commandId: message.commandId, ok: true }));
    } catch (error) {
      deviceSocket?.send(JSON.stringify({ type: "command-result", commandId: message.commandId, ok: false, error: error.message }));
    }
  };
}

chrome.cookies.onChanged.addListener(async ({ cookie }) => {
  const scope = await storedScope();
  const covering = D.coveringDomain(cookie.domain, scope.allowed);
  if (covering) schedule(covering);
  const domain = cookie.domain.replace(/^\./, "").toLowerCase();
  if (scope.allSites && D.isSyncable(domain)) schedule(domain);
});
chrome.permissions.onRemoved.addListener(() => syncScope().catch(() => {}));
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "sync-all") Promise.all([syncAll(), connectDeviceSocket(), pollAccessRequests()]).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ error: error.message }));
  if (message.type === "sync-domains") syncAll(message.domains).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ error: error.message }));
  if (message.type === "open-pair") chrome.action.openPopup().catch(() => {});
  if (message.type === "revoked") { deviceSocket?.close(); deviceSocket = undefined; sendResponse({ ok: true }); }
  return true;
});
chrome.runtime.onStartup.addListener(() => syncAll().catch(() => {}));
chrome.runtime.onStartup.addListener(() => { connectDeviceSocket(); pollAccessRequests(); });
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  chrome.alarms.create("cookie-sync", { periodInMinutes: 15 });
  chrome.alarms.create("cookie-access", { periodInMinutes: 1 });
  if (reason === "update") {
    // 0.8.x synced every site after pairing; keep that for existing users while Chrome still grants it.
    const { allSites } = await chrome.storage.local.get("allSites");
    if (allSites === undefined) await chrome.storage.local.set({ allSites: await chrome.permissions.contains({ origins: D.ALL_SITES }) });
    // Before 0.11 every shown access request left its own key behind.
    const stale = Object.keys(await chrome.storage.local.get(null)).filter((key) => key.startsWith("access-notified-"));
    if (stale.length) await chrome.storage.local.remove(stale);
  }
  const { consentVersion = 0 } = await chrome.storage.local.get("consentVersion");
  if (["install", "update"].includes(reason) && consentVersion < D.CONSENT_VERSION) {
    await chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  }
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "cookie-sync") syncAll().catch(() => {});
  if (alarm.name === "cookie-access") { pollAccessRequests(); connectDeviceSocket(); }
});
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith("grant:")) openGrant(notificationId);
});
chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (notificationId.startsWith("grant:")) return openGrant(notificationId);
  if (!notificationId.startsWith("access:")) return;
  decide(notificationId.slice(7), buttonIndex === 0 ? "approved" : "denied").finally(() => chrome.notifications.clear(notificationId));
});
