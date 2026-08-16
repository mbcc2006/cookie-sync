const $ = (id) => document.getElementById(id);
const status = (message) => { $("status").textContent = message; };

async function connect() {
  const relay = $("relay").value.replace(/\/$/, "");
  const code = $("code").value.trim();
  if (!relay || !code) throw new Error("Relay URL and pair code are required.");
  const relayUrl = new URL(relay);
  if (relayUrl.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(relayUrl.hostname)) throw new Error("Use an HTTPS relay outside local development.");
  const granted = await chrome.permissions.request({ origins: [`${relayUrl.origin}/*`, "https://*/*", "http://*/*"] });
  if (!granted) throw new Error("CookieSync needs relay and site permissions to keep cookies synchronized.");
  status("Authorizing this browser...");
  const response = await fetch(`${relay}/v1/devices`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code })
  });
  const device = await response.json();
  if (!response.ok) throw new Error(device.error || "Authorization failed.");
  await chrome.storage.local.set({ relay, deviceId: device.deviceId, uploadToken: device.uploadToken, publicKey: device.publicKey });
  await chrome.runtime.sendMessage({ type: "sync-all" });
  status("Authorized. CookieSync will continuously sync all permitted domains.");
}

chrome.storage.local.get(["relay", "deviceId"]).then((saved) => {
  $("relay").value = saved.relay || "https://relay.ivjn.us";
  if (saved.deviceId) {
    $("code").disabled = true;
    $("sync").textContent = "Sync all permitted domains now";
    status("This browser is authorized for continuous synchronization.");
  }
});
$("sync").addEventListener("click", () => {
  const action = $("code").disabled ? chrome.runtime.sendMessage({ type: "sync-all" }) : connect();
  action.catch((error) => status(`Error: ${error.message}`));
});
