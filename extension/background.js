importScripts("i18n.js");

const syncTimers = new Map();
let deviceSocket;

async function currentLang() {
  const { lang } = await chrome.storage.local.get("lang");
  if (lang && self.CookieSyncI18n.LANGS.includes(lang)) return lang;
  return self.CookieSyncI18n.detectLang();
}

async function t(key, params) {
  return self.CookieSyncI18n.t(await currentLang(), key, params);
}

async function browserMetadata() {
  const data = navigator.userAgentData;
  const details = data?.getHighEntropyValues ? await data.getHighEntropyValues(["architecture", "bitness", "fullVersionList", "platformVersion"]) : {};
  const brands = details.fullVersionList || data?.brands || [];
  return {
    userAgent: navigator.userAgent, platform: data?.platform || navigator.platform || "",
    os: [data?.platform || navigator.platform, details.platformVersion].filter(Boolean).join(" "),
    architecture: [details.architecture, details.bitness].filter(Boolean).join(" "),
    browser: brands.map((item) => `${item.brand} ${item.version}`).join(", "), language: navigator.language
  };
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

async function uploadWithRetry(url, options) {
  let response = await fetch(url, options);
  if (response.status === 429) {
    const retryAfter = Math.min(60, Math.max(1, Number(response.headers.get("retry-after")) || 1));
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    response = await fetch(url, options);
  }
  if (!response.ok) throw new Error((await response.json()).error || await t("error.uploadFailed"));
  return response;
}

async function syncDomain(domain) {
  const { relay, deviceId, uploadToken, publicKey } = await chrome.storage.local.get(["relay", "deviceId", "uploadToken", "publicKey"]);
  if (!relay || !deviceId || !uploadToken || !publicKey) return;
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

async function syncAll() {
  const { relay, deviceId, uploadToken, publicKey } = await chrome.storage.local.get(["relay", "deviceId", "uploadToken", "publicKey"]);
  if (!relay || !deviceId || !uploadToken || !publicKey) return;
  const cookies = await chrome.cookies.getAll({});
  const domains = [...new Set(cookies.map((cookie) => cookie.domain.replace(/^\./, "")))];
  const metadata = await browserMetadata();
  for (let index = 0; index < domains.length; index += 20) {
    const messages = await Promise.all(domains.slice(index, index + 20).map(async (domain) => {
      const domainCookies = await chrome.cookies.getAll({ domain });
      return { domain, envelope: await encrypt(publicKey, { domain, cookies: domainCookies, syncedAt: new Date().toISOString() }) };
    }));
    const options = { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${uploadToken}` }, body: JSON.stringify({ deviceId, messages, metadata }) };
    await uploadWithRetry(`${relay}/v1/messages/batch`, options);
  }
}

async function decide(requestId, decision) {
  const { relay, deviceId, uploadToken } = await chrome.storage.local.get(["relay", "deviceId", "uploadToken"]);
  const response = await fetch(`${relay}/v1/device/access-requests/${requestId}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${uploadToken}` }, body: JSON.stringify({ decision })
  });
  if (!response.ok) throw new Error((await response.json()).error || await t("error.decisionFailed"));
}

async function showAccessRequest(request) {
  const key = `access-notified-${request.id}`;
  if ((await chrome.storage.local.get(key))[key]) return;
  await chrome.storage.local.set({ [key]: true });
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
  if (!response.ok) return;
  for (const request of (await response.json()).requests) await showAccessRequest(request);
}

async function connectDeviceSocket() {
  const { relay, deviceId, uploadToken } = await chrome.storage.local.get(["relay", "deviceId", "uploadToken"]);
  if (!relay || !deviceId || !uploadToken) return;
  const url = new URL("/v1/device/ws", relay);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("deviceId", deviceId); url.searchParams.set("token", uploadToken);
  deviceSocket?.close();
  deviceSocket = new WebSocket(url);
  deviceSocket.onmessage = async (event) => {
    const message = JSON.parse(event.data);
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

chrome.cookies.onChanged.addListener(({ cookie }) => schedule(cookie.domain.replace(/^\./, "")));
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "sync-all") Promise.all([syncAll(), connectDeviceSocket(), pollAccessRequests()]).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ error: error.message }));
  if (message.type === "open-pair") chrome.action.openPopup().catch(() => {});
  if (message.type === "revoked") { deviceSocket?.close(); deviceSocket = undefined; sendResponse({ ok: true }); }
  return true;
});
chrome.runtime.onStartup.addListener(() => syncAll().catch(() => {}));
chrome.runtime.onStartup.addListener(() => { connectDeviceSocket(); pollAccessRequests(); });
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("cookie-sync", { periodInMinutes: 15 });
  chrome.alarms.create("cookie-access", { periodInMinutes: 1 });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "cookie-sync") syncAll().catch(() => {});
  if (alarm.name === "cookie-access") { pollAccessRequests(); connectDeviceSocket(); }
});
chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (!notificationId.startsWith("access:")) return;
  decide(notificationId.slice(7), buttonIndex === 0 ? "approved" : "denied").finally(() => chrome.notifications.clear(notificationId));
});
