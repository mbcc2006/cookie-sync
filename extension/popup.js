const $ = (id) => document.getElementById(id);
const status = (message) => { $("status").textContent = message; };

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
  if (!relay || !code) throw new Error("Relay URL and pair code are required.");
  const relayUrl = new URL(relay);
  if (relayUrl.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(relayUrl.hostname)) throw new Error("Use an HTTPS relay outside local development.");
  const granted = await chrome.permissions.request({ origins: [`${relayUrl.origin}/*`, "https://*/*", "http://*/*"] });
  if (!granted) throw new Error("CookieSync needs relay and site permissions to keep cookies synchronized.");
  status("Authorizing this browser...");
  const metadata = await browserMetadata();
  const response = await fetch(`${relay}/v1/devices`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, metadata })
  });
  const device = await response.json();
  if (!response.ok) throw new Error(device.error || "Authorization failed.");
  await chrome.storage.local.set({ relay, deviceId: device.deviceId, uploadToken: device.uploadToken, publicKey: device.publicKey });
  await chrome.storage.local.remove("pendingPair");
  await setPolicy();
  await chrome.runtime.sendMessage({ type: "sync-all" });
  status("Authorized. CookieSync will continuously sync all permitted domains.");
}

async function setPolicy() {
  const { relay, deviceId, uploadToken } = await chrome.storage.local.get(["relay", "deviceId", "uploadToken"]);
  if (!deviceId) return;
  const accessPolicy = $("policy").value;
  const response = await fetch(`${relay}/v1/devices/${deviceId}/policy`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${uploadToken}` }, body: JSON.stringify({ accessPolicy })
  });
  if (!response.ok) throw new Error((await response.json()).error || "Failed to update access policy.");
  await chrome.storage.local.set({ accessPolicy });
  status(accessPolicy === "confirm" ? "每次 CLI 读取前都需要你确认。" : "CLI 读取时会通知你，但默认不阻塞。 ");
}

function eventLabel(action) {
  return { requested: "CLI 发起读取", "auto-approved": "默认自动允许", approved: "你已允许", denied: "你已拒绝", consumed: "Cookie 已被读取", expired: "请求已过期" }[action] || action;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

async function loadAudit() {
  const { relay, deviceId, uploadToken } = await chrome.storage.local.get(["relay", "deviceId", "uploadToken"]);
  if (!deviceId) return;
  const response = await fetch(`${relay}/v1/device/audit?deviceId=${encodeURIComponent(deviceId)}`, { headers: { authorization: `Bearer ${uploadToken}` } });
  if (!response.ok) throw new Error((await response.json()).error || "Failed to load audit log.");
  const { events } = await response.json();
  $("audit").innerHTML = events.length ? events.map((event) => {
    const host = event.client?.hostname ? ` · ${event.client.hostname}` : "";
    const source = event.clientIp ? ` · ${event.clientIp}` : "";
    const domains = (event.domains || []).join(", ") || "-";
    const reason = event.reason || "未提供原因";
    return `<article class="event ${escapeHtml(event.action)}"><b>${escapeHtml(eventLabel(event.action))}</b><small>域名：${escapeHtml(domains)}</small><small>原因：${escapeHtml(reason)}</small><small>${escapeHtml((host + source).replace(/^ · /, ""))}</small><time>${escapeHtml(new Date(event.createdAt).toLocaleString())}</time></article>`;
  }).join("") : "<p>暂无访问记录。</p>";
}

chrome.storage.local.get(["relay", "deviceId", "accessPolicy", "pendingPair"]).then((saved) => {
  $("relay").value = saved.relay || "https://relay.ivjn.us";
  if (saved.deviceId) {
    $("code").disabled = true;
    $("sync").textContent = "Sync all permitted domains now";
    status("This browser is authorized for continuous synchronization.");
    $("audit-section").hidden = false;
    loadAudit().catch((error) => status(`Error: ${error.message}`));
  }
  $("policy").value = saved.accessPolicy || "notify";
  if (saved.pendingPair && !saved.deviceId) $("code").value = saved.pendingPair;
});
$("policy").addEventListener("change", () => setPolicy().catch((error) => status(`Error: ${error.message}`)));
$("refresh-audit").addEventListener("click", () => loadAudit().catch((error) => status(`Error: ${error.message}`)));
$("sync").addEventListener("click", () => {
  const action = $("code").disabled ? chrome.runtime.sendMessage({ type: "sync-all" }) : connect();
  action.catch((error) => status(`Error: ${error.message}`));
});
