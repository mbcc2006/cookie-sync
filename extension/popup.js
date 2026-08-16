const $ = (id) => document.getElementById(id);
const status = (message) => { $("status").textContent = message; };

let lang = "en";
const t = (key, params) => self.CookieSyncI18n.t(lang, key, params);

function applyTranslations() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
}

async function resolveLang() {
  const { lang: saved } = await chrome.storage.local.get("lang");
  if (saved && self.CookieSyncI18n.LANGS.includes(saved)) return saved;
  return self.CookieSyncI18n.detectLang();
}

async function setLang(next) {
  lang = next;
  $("lang").value = next;
  applyTranslations();
  await chrome.storage.local.set({ lang: next });
}

async function browserMetadata() {
  const data = navigator.userAgentData;
  const details = data?.getHighEntropyValues ? await data.getHighEntropyValues(["architecture", "bitness", "fullVersionList", "platformVersion"]) : {};
  const brands = details.fullVersionList || data?.brands || [];
  return {
    userAgent: navigator.userAgent,
    platform: data?.platform || navigator.platform || "",
    os: [data?.platform || navigator.platform, details.platformVersion].filter(Boolean).join(" "),
    architecture: [details.architecture, details.bitness].filter(Boolean).join(" "),
    browser: brands.map((item) => `${item.brand} ${item.version}`).join(", "),
    language: navigator.language
  };
}

async function connect() {
  const relay = $("relay").value.replace(/\/$/, "");
  const code = $("code").value.trim();
  if (!relay || !code) throw new Error(t("status.missingFields"));
  const relayUrl = new URL(relay);
  if (relayUrl.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(relayUrl.hostname)) throw new Error(t("status.httpsRequired"));
  const granted = await chrome.permissions.request({ origins: [`${relayUrl.origin}/*`, "https://*/*", "http://*/*"] });
  if (!granted) throw new Error(t("status.permissionRequired"));
  status(t("status.authorizing"));
  const metadata = await browserMetadata();
  const response = await fetch(`${relay}/v1/devices`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, metadata })
  });
  const device = await response.json();
  if (!response.ok) throw new Error(device.error || t("status.authorizeFailed"));
  await chrome.storage.local.set({ relay, deviceId: device.deviceId, uploadToken: device.uploadToken, publicKey: device.publicKey });
  await chrome.storage.local.remove("pendingPair");
  await setPolicy();
  await chrome.runtime.sendMessage({ type: "sync-all" });
  showAuthorized();
  status(t("status.authorized"));
  loadAudit().catch((error) => status(t("status.errorPrefix", { message: error.message })));
}

async function setPolicy() {
  const { relay, deviceId, uploadToken } = await chrome.storage.local.get(["relay", "deviceId", "uploadToken"]);
  if (!deviceId) return;
  const accessPolicy = $("policy").value;
  const response = await fetch(`${relay}/v1/devices/${deviceId}/policy`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${uploadToken}` }, body: JSON.stringify({ accessPolicy })
  });
  if (!response.ok) throw new Error((await response.json()).error || t("status.policyFailed"));
  await chrome.storage.local.set({ accessPolicy });
  status(accessPolicy === "confirm" ? t("status.policyConfirm") : t("status.policyNotify"));
}

function eventLabel(action) {
  return { requested: t("event.requested"), "auto-approved": t("event.autoApproved"), approved: t("event.approved"), denied: t("event.denied"), consumed: t("event.consumed"), expired: t("event.expired") }[action] || action;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

async function loadAudit() {
  const { relay, deviceId, uploadToken } = await chrome.storage.local.get(["relay", "deviceId", "uploadToken"]);
  if (!deviceId) return;
  const response = await fetch(`${relay}/v1/device/audit?deviceId=${encodeURIComponent(deviceId)}`, { headers: { authorization: `Bearer ${uploadToken}` } });
  if (!response.ok) throw new Error((await response.json()).error || t("status.auditFailed"));
  const { events } = await response.json();
  $("audit").innerHTML = events.length ? events.map((event) => {
    const host = event.client?.hostname ? ` · ${event.client.hostname}` : "";
    const source = event.clientIp ? ` · ${event.clientIp}` : "";
    const domains = (event.domains || []).join(", ") || "-";
    const reason = event.reason || t("audit.noReason");
    return `<article class="event ${escapeHtml(event.action)}"><b>${escapeHtml(eventLabel(event.action))}</b><small>${escapeHtml(t("audit.domainLabel", { domains }))}</small><small>${escapeHtml(t("audit.reasonLabel", { reason }))}</small><small>${escapeHtml((host + source).replace(/^ · /, ""))}</small><time>${escapeHtml(new Date(event.createdAt).toLocaleString())}</time></article>`;
  }).join("") : `<p>${escapeHtml(t("audit.empty"))}</p>`;
}

async function revoke() {
  const { relay, deviceId, uploadToken } = await chrome.storage.local.get(["relay", "deviceId", "uploadToken"]);
  if (deviceId) {
    const response = await fetch(`${relay}/v1/devices/${deviceId}`, { method: "DELETE", headers: { authorization: `Bearer ${uploadToken}` } });
    if (!response.ok && response.status !== 204) throw new Error((await response.json().catch(() => ({}))).error || t("status.revokeFailed"));
  }
  await chrome.storage.local.remove(["deviceId", "uploadToken", "publicKey", "accessPolicy", "pendingPair"]);
  await chrome.runtime.sendMessage({ type: "revoked" }).catch(() => {});
  showUnauthorized();
  status(t("status.revoked"));
}

function showUnauthorized() {
  $("pair-code-label").hidden = false;
  $("code").disabled = false;
  $("code").value = "";
  const button = $("sync");
  button.dataset.i18n = "button.sync.authorize";
  button.textContent = t("button.sync.authorize");
  $("revoke").hidden = true;
  $("audit-section").hidden = true;
}

function showAuthorized() {
  $("pair-code-label").hidden = true;
  $("code").disabled = true;
  const button = $("sync");
  button.dataset.i18n = "button.sync.now";
  button.textContent = t("button.sync.now");
  $("revoke").hidden = false;
  $("audit-section").hidden = false;
}

(async () => {
  lang = await resolveLang();
  $("lang").value = lang;
  applyTranslations();

  const saved = await chrome.storage.local.get(["relay", "deviceId", "accessPolicy", "pendingPair"]);
  $("relay").value = saved.relay || "https://relay.ivjn.us";
  if (saved.deviceId) {
    showAuthorized();
    status(t("status.authorizedExisting"));
    loadAudit().catch((error) => status(t("status.errorPrefix", { message: error.message })));
  } else {
    showUnauthorized();
  }
  $("policy").value = saved.accessPolicy || "notify";
  if (saved.pendingPair && !saved.deviceId) $("code").value = saved.pendingPair;
})();

$("lang").addEventListener("change", () => setLang($("lang").value));
$("policy").addEventListener("change", () => setPolicy().catch((error) => status(t("status.errorPrefix", { message: error.message }))));
$("refresh-audit").addEventListener("click", () => loadAudit().catch((error) => status(t("status.errorPrefix", { message: error.message }))));
$("sync").addEventListener("click", () => {
  const action = $("code").disabled ? chrome.runtime.sendMessage({ type: "sync-all" }) : connect();
  action.catch((error) => status(t("status.errorPrefix", { message: error.message })));
});
$("revoke").addEventListener("click", () => revoke().catch((error) => status(t("status.errorPrefix", { message: error.message }))));
