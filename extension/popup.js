const $ = (id) => document.getElementById(id);
const status = (message) => { $("status").textContent = message; };

function normalizeDomain(value) {
  const domain = value.trim().toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)) {
    throw new Error("Enter a domain such as github.com.");
  }
  return domain;
}

async function importPublicKey(pem) {
  const body = pem.replace(/-----(BEGIN|END) PUBLIC KEY-----|\s/g, "");
  const bytes = Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
  return crypto.subtle.importKey("spki", bytes, { name: "X25519" }, false, []);
}

function base64(bytes) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

async function encrypt(publicKeyPem, snapshot) {
  const recipient = await importPublicKey(publicKeyPem);
  const ephemeral = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const shared = await crypto.subtle.deriveBits({ name: "X25519", public: recipient }, ephemeral.privateKey, 256);
  const hkdfKey = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: new TextEncoder().encode("cookie-sync-v1") },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(snapshot))));
  const ciphertext = encrypted.slice(0, -16);
  const tag = encrypted.slice(-16);
  const rawPublicKey = await crypto.subtle.exportKey("raw", ephemeral.publicKey);
  // X25519 raw public keys need SPKI encoding for Node's crypto API.
  const spkiPrefix = Uint8Array.from([48, 42, 48, 5, 6, 3, 43, 110, 110, 3, 33, 0]);
  const spki = new Uint8Array(spkiPrefix.length + 32);
  spki.set(spkiPrefix);
  spki.set(new Uint8Array(rawPublicKey), spkiPrefix.length);
  return {
    ephemeralPublicKey: `-----BEGIN PUBLIC KEY-----\n${base64(spki)}\n-----END PUBLIC KEY-----`,
    iv: base64(iv), ciphertext: base64(ciphertext), tag: base64(tag)
  };
}

async function sync() {
  const relay = $("relay").value.replace(/\/$/, "");
  const code = $("code").value.trim();
  const domain = normalizeDomain($("domain").value);
  if (!relay || !code || !domain) throw new Error("Relay URL, pair code, and domain are required.");
  const relayUrl = new URL(relay);
  if (relayUrl.protocol !== "https:" && relayUrl.hostname !== "localhost" && relayUrl.hostname !== "127.0.0.1") {
    throw new Error("Use an HTTPS relay outside local development.");
  }
  const relayOrigin = relayUrl.origin;
  const granted = await chrome.permissions.request({
    origins: [`https://${domain}/*`, `http://${domain}/*`, `${relayOrigin}/*`]
  });
  if (!granted) throw new Error("CookieSync needs permission for the selected domain and relay.");
  status("Reading selected cookies...");
  const pair = await fetch(`${relay}/v1/pairs/${encodeURIComponent(code)}`).then(async (response) => {
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "Pair lookup failed.");
    return value;
  });
  const cookies = await chrome.cookies.getAll({ domain });
  const snapshot = { domain, cookies, syncedAt: new Date().toISOString() };
  status("Encrypting and uploading...");
  const envelope = await encrypt(pair.publicKey, snapshot);
  const response = await fetch(`${relay}/v1/messages`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, domain, envelope })
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Upload failed.");
  await chrome.storage.local.set({ relay, code, domain });
  status(`Synced ${cookies.length} cookies for ${domain}.`);
}

chrome.storage.local.get(["relay", "code", "domain"]).then((saved) => {
  $("relay").value = saved.relay || "https://relay.ivjn.us";
  $("code").value = saved.code || "";
  $("domain").value = saved.domain || "";
});
$("sync").addEventListener("click", () => sync().catch((error) => status(`Error: ${error.message}`)));
