const $ = (id) => document.getElementById(id);
const D = self.CookieSyncDomains;
const status = (message) => { $("status").textContent = message; };
const maskPairCode = (code) => code.length > 9 ? `${code.slice(0, 4)}...${code.slice(-4)}` : code;

let lang = "en";
const t = (key, params) => self.CookieSyncI18n.t(lang, key, params);

function applyTranslations() {
  document.documentElement.lang = lang;
  document.documentElement.dir = self.CookieSyncI18n.RTL.includes(lang) ? "rtl" : "ltr";
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
  await renderDomains();
}

async function hasConsent() {
  const { consentVersion = 0 } = await chrome.storage.local.get("consentVersion");
  return consentVersion >= D.CONSENT_VERSION;
}

function domainItem(domain, label, action, note) {
  const li = document.createElement("li");
  const text = document.createElement("span");
  text.textContent = domain;
  if (note) {
    const small = document.createElement("small");
    small.textContent = note;
    text.append(small);
  }
  const button = document.createElement("button");
  button.textContent = label;
  button.addEventListener("click", () => action(domain).catch((error) => status(t("status.errorPrefix", { message: error.message }))));
  li.append(text, button);
  return li;
}

async function renderDomains() {
  const { allowedDomains = [], pendingDomains = [], allSites = false } = await chrome.storage.local.get(["allowedDomains", "pendingDomains", "allSites"]);
  const requested = new URLSearchParams(location.search).get("add");
  const pending = [...new Set([...pendingDomains, requested].map(D.normalizeDomain).filter(Boolean))].filter((domain) => !allowedDomains.includes(domain));
  $("pending").replaceChildren(...pending.map((domain) => {
    const li = domainItem(domain, t("domains.add"), allowDomain, t("domains.requested", { domain }));
    li.classList.add("pending");
    return li;
  }));
  const items = [];
  for (const domain of allowedDomains) {
    // Access can be withdrawn in Chrome's settings, or was never recorded because "Sync all sites" covered it.
    const granted = allSites || await chrome.permissions.contains({ origins: D.originsFor(domain) });
    if (granted) items.push(domainItem(domain, t("domains.remove"), removeDomain));
    else {
      const li = domainItem(domain, t("domains.add"), allowDomain, t("domains.regrant"));
      li.classList.add("pending");
      items.push(li);
    }
  }
  $("domains").replaceChildren(...items);
  $("domains-empty").hidden = allowedDomains.length > 0 || pending.length > 0;
  $("all-sites").checked = allSites;
}

// permissions.request must run straight from the click, before other awaits use up the user gesture.
async function allowDomain(input) {
  const domain = D.normalizeDomain(input);
  if (!domain) throw new Error(t("domains.invalid"));
  const granted = await chrome.permissions.request({ origins: D.originsFor(domain) });
  if (!granted) throw new Error(t("domains.denied", { domain }));
  const { allowedDomains = [], pendingDomains = [] } = await chrome.storage.local.get(["allowedDomains", "pendingDomains"]);
  await chrome.storage.local.set({
    allowedDomains: [...new Set([...allowedDomains, domain])].sort(),
    pendingDomains: pendingDomains.filter((item) => item !== domain)
  });
  $("domain-input").value = "";
  await renderDomains();
  const result = await chrome.runtime.sendMessage({ type: "sync-domains", domains: [domain] });
  if (result?.error) throw new Error(result.error);
  status(t("domains.added", { domain }));
}

async function removeDomain(domain) {
  const { allowedDomains = [] } = await chrome.storage.local.get("allowedDomains");
  await chrome.storage.local.set({ allowedDomains: allowedDomains.filter((item) => item !== domain) });
  await chrome.permissions.remove({ origins: D.originsFor(domain) }).catch(() => {});
  await renderDomains();
  status(t("domains.removed", { domain }));
}

async function setAllSites(on) {
  if (on) {
    const granted = await chrome.permissions.request({ origins: D.ALL_SITES });
    if (!granted) {
      $("all-sites").checked = false;
      throw new Error(t("allSites.denied"));
    }
    await chrome.storage.local.set({ allSites: true });
    await chrome.runtime.sendMessage({ type: "sync-all" });
    status(t("allSites.on"));
  } else {
    await chrome.storage.local.set({ allSites: false });
    await chrome.permissions.remove({ origins: D.ALL_SITES }).catch(() => {});
    status(t("allSites.off"));
  }
  await renderDomains();
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
  if (!(await hasConsent())) throw new Error(t("consent.required"));
  const relayUrl = new URL(relay);
  if (relayUrl.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(relayUrl.hostname)) throw new Error(t("status.httpsRequired"));
  // Pairing only needs the relay; sites are allowed one by one afterwards.
  const granted = await chrome.permissions.request({ origins: [`${relayUrl.origin}/*`] });
  if (!granted) throw new Error(t("status.permissionRequired"));
  status(t("status.authorizing"));
  const metadata = await browserMetadata();
  const response = await fetch(`${relay}/v1/devices`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, metadata })
  });
  const device = await response.json();
  if (!response.ok) throw new Error(device.error || t("status.authorizeFailed"));
  const pairedCode = maskPairCode(code);
  await chrome.storage.local.set({ relay, deviceId: device.deviceId, uploadToken: device.uploadToken, publicKey: device.publicKey, pairedCode });
  await chrome.storage.local.remove("pendingPair");
  await setPolicy();
  await chrome.runtime.sendMessage({ type: "sync-all" });
  showAuthorized(pairedCode);
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
  await chrome.storage.local.remove(["deviceId", "uploadToken", "publicKey", "accessPolicy", "pendingPair", "pairedCode"]);
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

function showAuthorized(pairedCode) {
  $("pair-code-label").hidden = !pairedCode;
  $("code").disabled = true;
  $("code").value = pairedCode || "";
  const button = $("sync");
  button.dataset.i18n = "button.sync.now";
  button.textContent = t("button.sync.now");
  $("revoke").hidden = false;
  $("audit-section").hidden = false;
}

(async () => {
  const { LANGS, NAMES } = self.CookieSyncI18n;
  $("lang").replaceChildren(...LANGS.map((code) => new Option(NAMES[code], code)));
  lang = await resolveLang();
  $("lang").value = lang;
  applyTranslations();

  const saved = await chrome.storage.local.get(["relay", "deviceId", "uploadToken", "accessPolicy", "pendingPair", "pairedCode"]);
  $("relay").value = saved.relay || "https://relay.ivjn.us";
  if (saved.deviceId) {
    let pairedCode = saved.pairedCode;
    if (!pairedCode) {
      try {
        const response = await fetch(`${$("relay").value}/v1/device/status?deviceId=${encodeURIComponent(saved.deviceId)}`, { headers: { authorization: `Bearer ${saved.uploadToken}` } });
        if (response.ok) {
          pairedCode = (await response.json()).pairCode;
          await chrome.storage.local.set({ pairedCode });
        }
      } catch {}
    }
    showAuthorized(pairedCode);
    status(t("status.authorizedExisting"));
    loadAudit().catch((error) => status(t("status.errorPrefix", { message: error.message })));
  } else {
    showUnauthorized();
  }
  $("policy").value = saved.accessPolicy || "notify";
  if (saved.pendingPair && !saved.deviceId) $("code").value = saved.pendingPair;

  const consented = await hasConsent();
  $("consent").hidden = consented;
  $("domains-section").hidden = !consented;
  if (!saved.deviceId) $("sync").disabled = !consented;
  await renderDomains();
})();

$("open-welcome").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") }));
$("add-form").addEventListener("submit", (event) => {
  event.preventDefault();
  allowDomain($("domain-input").value).catch((error) => status(t("status.errorPrefix", { message: error.message })));
});
$("all-sites").addEventListener("change", () => setAllSites($("all-sites").checked).catch((error) => status(t("status.errorPrefix", { message: error.message }))));
chrome.storage.onChanged.addListener((changes) => {
  if (changes.allowedDomains || changes.pendingDomains || changes.allSites) renderDomains();
});

$("lang").addEventListener("change", () => setLang($("lang").value));
$("policy").addEventListener("change", () => setPolicy().catch((error) => status(t("status.errorPrefix", { message: error.message }))));
$("refresh-audit").addEventListener("click", () => loadAudit().catch((error) => status(t("status.errorPrefix", { message: error.message }))));
$("sync").addEventListener("click", () => {
  const action = $("code").disabled ? chrome.runtime.sendMessage({ type: "sync-all" }) : connect();
  action.catch((error) => status(t("status.errorPrefix", { message: error.message })));
});
$("revoke").addEventListener("click", () => revoke().catch((error) => status(t("status.errorPrefix", { message: error.message }))));
