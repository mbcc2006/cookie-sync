import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import webpush from "web-push";
import { WebSocketServer } from "ws";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const PAIR_TTL_MS = 10 * 60 * 1000;
const MESSAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const IMPORT_TTL_MS = 5 * 60 * 1000;
const ACCESS_TTL_MS = 2 * 60 * 1000;
const AUDIT_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const AUDIT_MAX_PER_DEVICE = 500;
const DEFAULT_RATE_LIMITS = {
  api: { max: 120, windowMs: 60_000 },
  pairs: { max: 10, windowMs: 60_000 },
  claims: { max: 20, windowMs: 60_000 }
  , imports: { max: 10, windowMs: 60_000 }
};

function isDomain(value) {
  return typeof value === "string" && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function browserMetadata(value = {}) {
  const text = (input, limit = 500) => typeof input === "string" ? input.slice(0, limit) : "";
  return {
    userAgent: text(value.userAgent), platform: text(value.platform, 100), os: text(value.os, 100),
    architecture: text(value.architecture, 50), browser: text(value.browser, 100), language: text(value.language, 50)
  };
}

function clientMetadata(value = {}) {
  const text = (input, limit = 200) => typeof input === "string" ? input.slice(0, limit) : "";
  return { hostname: text(value.hostname, 100), platform: text(value.platform, 50), release: text(value.release, 100), architecture: text(value.architecture, 50), cliVersion: text(value.cliVersion, 30) };
}

function accessReason(value, fallback = "CookieSync CLI request") {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : fallback;
}

function clientIp(request) {
  const cloudflare = request.headers["cf-connecting-ip"];
  const forwarded = request.headers["x-forwarded-for"]?.split(",")[0].trim();
  return cloudflare || forwarded || request.socket.remoteAddress || "unknown";
}

function createRateLimiter() {
  const entries = new Map();
  return (key, { max, windowMs }) => {
    const now = Date.now();
    const current = entries.get(key);
    if (!current || current.resetAt <= now) {
      entries.set(key, { count: 1, resetAt: now + windowMs });
      return null;
    }
    current.count += 1;
    if (current.count <= max) return null;
    return Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  };
}

function createStore(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, "messages.json");
  let pairs = new Map();
  let devices = new Map();
  let messages = new Map();
  let imports = new Map();
  let accessRequests = new Map();
  let auditEvents = [];
  let pushSubscriptions = [];
  try {
    const values = JSON.parse(fs.readFileSync(file, "utf8"));
    pairs = new Map((values.pairs || []).map((pair) => [pair.code, pair]));
    devices = new Map((values.devices || []).map((device) => [device.id, device]));
    messages = new Map((values.messages || []).map((message) => [message.id, message]));
    imports = new Map((values.imports || []).map((item) => [item.id, item]));
    accessRequests = new Map((values.accessRequests || []).map((item) => [item.id, item]));
    auditEvents = values.auditEvents || [];
    pushSubscriptions = values.pushSubscriptions || [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  function save() {
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ pairs: [...pairs.values()], devices: [...devices.values()], messages: [...messages.values()], imports: [...imports.values()], accessRequests: [...accessRequests.values()], auditEvents, pushSubscriptions })}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
  }
  return { pairs, devices, messages, imports, accessRequests, auditEvents, pushSubscriptions, save };
}

function cleanup(pairs, store) {
  const now = Date.now();
  let changed = false;
  for (const [id, message] of store.messages) {
    if (message.expiresAt <= now) {
      store.messages.delete(id);
      changed = true;
    }
  }
  for (const [id, item] of store.imports) {
    if (item.expiresAt <= now) {
      store.imports.delete(id);
      changed = true;
    }
  }
  for (const [id, item] of store.accessRequests) {
    if (item.expiresAt <= now) {
      if (item.status === "pending") store.auditEvents.push({ id: crypto.randomUUID(), deviceId: item.deviceId, requestId: item.id, action: "expired", createdAt: now, domains: item.domains, mode: item.mode });
      store.accessRequests.delete(id);
      changed = true;
    }
  }
  const audits = store.auditEvents.filter((event) => event.createdAt > now - AUDIT_TTL_MS);
  if (audits.length !== store.auditEvents.length) {
    store.auditEvents.splice(0, store.auditEvents.length, ...audits);
    changed = true;
  }
  for (const [code, pair] of pairs) {
    if (pair.expiresAt <= now && ![...store.devices.values()].some((device) => device.code === code) && ![...store.messages.values()].some((message) => message.code === code) && ![...store.imports.values()].some((item) => item.code === code)) {
      pairs.delete(code);
      changed = true;
    }
  }
  if (changed) store.save();
}

function send(response, status, value, origin, extraHeaders = {}) {
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  if (origin) headers["access-control-allow-origin"] = origin;
  response.writeHead(status, { ...headers, ...extraHeaders });
  response.end(JSON.stringify(value));
}

function consoleImportScript() {
  return `(() => {
  const script = document.currentScript;
  const config = JSON.parse(decodeURIComponent(script.src.split("#")[1] || ""));
  const b64 = bytes => btoa(String.fromCharCode(...bytes));
  const decodePem = pem => Uint8Array.from(atob(pem.replace(/-----(BEGIN|END) PUBLIC KEY-----|\\s/g, "")), c => c.charCodeAt(0));
  async function run() {
    if (location.hostname !== config.domain && !location.hostname.endsWith("." + config.domain)) throw new Error("CookieSync domain mismatch");
    console.info("CookieSync access reason:", config.reason);
    const recipient = await crypto.subtle.importKey("spki", decodePem(config.publicKey), { name: "X25519" }, false, []);
    const ephemeral = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
    const shared = await crypto.subtle.deriveBits({ name: "X25519", public: recipient }, ephemeral.privateKey, 256);
    const material = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: new TextEncoder().encode("cookie-sync-v1") }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    const cookies = document.cookie ? document.cookie.split(/;\\s*/).map(part => { const i = part.indexOf("="); return { name: decodeURIComponent(part.slice(0, i)), value: decodeURIComponent(part.slice(i + 1)), domain: location.hostname, path: "/", secure: location.protocol === "https:", httpOnly: false, sameSite: "unspecified" }; }) : [];
    const snapshot = { domain: config.domain, cookies, source: "console", userAgent: navigator.userAgent, syncedAt: new Date().toISOString() };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(snapshot))));
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));
    const prefix = Uint8Array.from([48,42,48,5,6,3,43,101,110,3,33,0]); const spki = new Uint8Array(44); spki.set(prefix); spki.set(raw, 12);
    const envelope = { ephemeralPublicKey: "-----BEGIN PUBLIC KEY-----\\n" + b64(spki) + "\\n-----END PUBLIC KEY-----", iv: b64(iv), ciphertext: b64(encrypted.slice(0,-16)), tag: b64(encrypted.slice(-16)) };
    const response = await fetch(config.relay + "/v1/imports/" + config.id, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + config.uploadToken }, body: JSON.stringify({ envelope }) });
    if (!response.ok) throw new Error((await response.json()).error || "CookieSync upload failed");
    console.info("CookieSync: uploaded " + cookies.length + " non-HttpOnly cookies for " + config.domain + ". Reason: " + config.reason);
  }
  run().catch(error => console.error("CookieSync:", error));
})();`;
}

function pairingPage(pair) {
  const safeCode = pair ? JSON.stringify(pair.code) : "null";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CookieSync Pair</title><style>
  :root{color-scheme:light}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f0e6;color:#13251d;font-family:ui-sans-serif,system-ui,sans-serif}.card{width:min(560px,calc(100% - 32px));border:1px solid #13251d;background:#fbf8ef;padding:38px;box-shadow:10px 10px 0 #c9ff45}.mark{display:inline-grid;place-items:center;width:38px;height:38px;background:#13251d;color:#c9ff45;font:700 12px ui-monospace,monospace}h1{font-size:38px;letter-spacing:-.05em;margin:24px 0 10px}p{line-height:1.7;color:#52645a}.code{font:600 24px ui-monospace,monospace;letter-spacing:.08em;border:1px dashed #13251d;padding:16px;margin:24px 0;background:white;overflow-wrap:anywhere}button{width:100%;border:1px solid #13251d;background:#13251d;color:white;padding:15px;font-weight:700;cursor:pointer;box-shadow:5px 5px 0 #c9ff45}.status{font-size:13px;min-height:24px;margin-top:18px}.bad{color:#a43b1c}@media(max-width:520px){.card{padding:25px}h1{font-size:31px}.code{font-size:18px}}</style></head><body><main class="card"><span class="mark">CS</span><h1>连接这台浏览器</h1>${pair ? `<p>配对码将在 ${new Date(pair.expiresAt).toISOString()} 过期。点击后，已安装的 CookieSync 扩展会自动预填。</p><div class="code">${pair.code}</div><button id="open">打开 CookieSync 扩展</button><p class="status" id="status">如果扩展弹窗未自动打开，请点击浏览器工具栏中的 CookieSync 图标。</p>` : `<p class="bad">配对码无效或已过期。请回到 CLI 重新运行 <code>cookie-sync pair</code>。</p>`}</main><script>
  const pair=${safeCode}; const button=document.getElementById('open');
  if(button) button.onclick=()=>{document.dispatchEvent(new CustomEvent('cookie-sync-pair',{detail:{pair,relay:location.origin}}));document.getElementById('status').textContent='配对码已发送给扩展。';};
  if(pair) setTimeout(()=>document.dispatchEvent(new CustomEvent('cookie-sync-pair',{detail:{pair,relay:location.origin}})),300);
  </script></body></html>`;
}

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return null;
  }
}

export function createRelay({ dataDirectory = process.env.COOKIE_SYNC_RELAY_DATA || "./data", rateLimits = DEFAULT_RATE_LIMITS } = {}) {
  const store = createStore(dataDirectory);
  const pairs = store.pairs;
  const rateLimit = createRateLimiter();
  const allowedOrigins = (process.env.COOKIE_SYNC_ALLOWED_ORIGINS || "*").split(",").map((value) => value.trim());
  const allowOrigin = (origin) => origin && (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) ? origin : undefined;

  const sockets = new Map();
  const deviceSockets = new Map();
  const vapidPublicKey = process.env.COOKIE_SYNC_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.COOKIE_SYNC_VAPID_PRIVATE_KEY;
  if (vapidPublicKey && vapidPrivateKey) webpush.setVapidDetails(process.env.COOKIE_SYNC_VAPID_SUBJECT || "mailto:admin@ivjn.us", vapidPublicKey, vapidPrivateKey);

  const notify = (code, event) => {
    const payload = JSON.stringify(event);
    for (const socket of sockets.get(code) || []) if (socket.readyState === 1) socket.send(payload);
    if (!vapidPrivateKey) return;
    for (const item of store.pushSubscriptions.filter((subscription) => subscription.code === code)) {
      webpush.sendNotification(item.subscription, payload, { TTL: 60 }).catch(() => {});
    }
  };
  const notifyDevice = (deviceId, event) => {
    const payload = JSON.stringify(event);
    for (const socket of deviceSockets.get(deviceId) || []) if (socket.readyState === 1) socket.send(payload);
  };
  const audit = (deviceId, requestId, action, details = {}) => {
    store.auditEvents.push({ id: crypto.randomUUID(), deviceId, requestId, action, createdAt: Date.now(), ...details });
    const deviceEvents = store.auditEvents.filter((event) => event.deviceId === deviceId);
    if (deviceEvents.length > AUDIT_MAX_PER_DEVICE) {
      const remove = new Set(deviceEvents.slice(0, deviceEvents.length - AUDIT_MAX_PER_DEVICE).map((event) => event.id));
      const retained = store.auditEvents.filter((event) => !remove.has(event.id));
      store.auditEvents.splice(0, store.auditEvents.length, ...retained);
    }
  };

  const server = http.createServer(async (request, response) => {
    const origin = allowOrigin(request.headers.origin);
    if (request.method === "OPTIONS") {
      if (!origin) return send(response, 403, { error: "Origin is not allowed." });
      response.writeHead(204, {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
        "access-control-allow-headers": "content-type, authorization",
        "access-control-max-age": "600",
        vary: "Origin"
      });
      return response.end();
    }

    const url = new URL(request.url, `http://${request.headers.host}`);
    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/") {
      cleanup(pairs, store);
      const code = url.searchParams.get("pair");
      const pair = code && pairs.get(code);
      const valid = pair && pair.expiresAt > Date.now() ? pair : null;
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'", "x-content-type-options": "nosniff" });
      return response.end(request.method === "HEAD" ? undefined : pairingPage(valid));
    }
    if (request.method === "GET" && url.pathname === "/console-import.js") {
      response.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" });
      return response.end(consoleImportScript());
    }
    if (url.pathname !== "/healthz") {
      const ip = clientIp(request);
      const bucket = request.method === "POST" && url.pathname === "/v1/pairs" ? "pairs"
        : request.method === "POST" && url.pathname === "/v1/devices" ? "claims"
          : request.method === "POST" && (url.pathname === "/v1/imports" || url.pathname.startsWith("/v1/imports/")) ? "imports" : "api";
      const retryAfter = rateLimit(`${bucket}:${ip}`, rateLimits[bucket]);
      if (retryAfter) return send(response, 429, { error: "Too many requests. Try again later." }, origin, { "retry-after": String(retryAfter) });
    }
    cleanup(pairs, store);
    const input = request.method === "GET" || request.method === "DELETE" ? {} : await body(request);
    if (input === undefined) return send(response, 413, { error: "Request body is too large." }, origin);
    if (!input) return send(response, 400, { error: "Invalid JSON." }, origin);

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/healthz") {
      return send(response, 200, { ok: true, websocket: true, webPush: Boolean(vapidPublicKey) }, origin);
    }

    if (request.method === "POST" && url.pathname === "/v1/pairs") {
      if (typeof input.publicKey !== "string" || input.publicKey.length > 1000) {
        return send(response, 400, { error: "A valid publicKey is required." }, origin);
      }
      const code = crypto.randomBytes(18).toString("base64url").toUpperCase();
      const readToken = crypto.randomBytes(32).toString("base64url");
      const expiresAt = Date.now() + PAIR_TTL_MS;
      pairs.set(code, { code, publicKey: input.publicKey, readToken, expiresAt });
      store.save();
      return send(response, 201, { code, readToken, expiresAt }, origin);
    }

    if (request.method === "GET" && url.pathname.startsWith("/v1/pairs/")) {
      const code = decodeURIComponent(url.pathname.slice("/v1/pairs/".length));
      const pair = pairs.get(code);
      if (!pair || pair.expiresAt <= Date.now()) return send(response, 404, { error: "Pair code is invalid or expired." }, origin);
      return send(response, 200, { publicKey: pair.publicKey, expiresAt: pair.expiresAt }, origin);
    }

    if (request.method === "POST" && url.pathname === "/v1/devices") {
      if (typeof input.code !== "string") return send(response, 400, { error: "A pair code is required." }, origin);
      const pair = pairs.get(input.code);
      if (!pair || pair.expiresAt <= Date.now()) return send(response, 404, { error: "Pair code is invalid or expired." }, origin);
      const uploadToken = crypto.randomBytes(32).toString("base64url");
      const now = Date.now();
      const device = {
        id: crypto.randomUUID(), code: pair.code, uploadTokenHash: tokenHash(uploadToken), alias: "", note: "",
        accessPolicy: "notify", metadata: browserMetadata(input.metadata), createdAt: now, lastSeenAt: now
      };
      store.devices.set(device.id, device);
      store.save();
      return send(response, 201, { deviceId: device.id, uploadToken, publicKey: pair.publicKey }, origin);
    }

    if (request.method === "POST" && url.pathname.startsWith("/v1/devices/") && url.pathname.endsWith("/policy")) {
      const id = decodeURIComponent(url.pathname.slice("/v1/devices/".length, -"/policy".length));
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const device = store.devices.get(id);
      if (!device || !token || !safeEqual(tokenHash(token), device.uploadTokenHash)) return send(response, 401, { error: "A valid device upload token is required." }, origin);
      if (!["notify", "confirm"].includes(input.accessPolicy)) return send(response, 400, { error: "Access policy must be notify or confirm." }, origin);
      device.accessPolicy = input.accessPolicy;
      store.save();
      return send(response, 200, { accessPolicy: device.accessPolicy }, origin);
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/v1/devices/") && url.pathname.slice("/v1/devices/".length).indexOf("/") === -1) {
      const id = decodeURIComponent(url.pathname.slice("/v1/devices/".length));
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const device = store.devices.get(id);
      if (!device || !token || !safeEqual(tokenHash(token), device.uploadTokenHash)) return send(response, 401, { error: "A valid device upload token is required." }, origin);
      store.devices.delete(id);
      for (const [messageId, message] of store.messages) if (message.deviceId === id) store.messages.delete(messageId);
      for (const [requestId, item] of store.accessRequests) if (item.deviceId === id) store.accessRequests.delete(requestId);
      const audits = store.auditEvents.filter((event) => event.deviceId !== id);
      store.auditEvents.splice(0, store.auditEvents.length, ...audits);
      store.save();
      notifyDevice(id, { type: "revoked" });
      return send(response, 204, {}, origin);
    }

    if (request.method === "POST" && url.pathname === "/v1/access-requests") {
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const pair = pairs.get(input.code);
      const device = store.devices.get(input.deviceId);
      if (!pair || !device || device.code !== input.code || !token || !safeEqual(token, pair.readToken)) return send(response, 401, { error: "A valid CLI read token is required." }, origin);
      const domains = Array.isArray(input.domains) ? input.domains.map((domain) => domain === "*" ? "*" : isDomain(domain) ? domain.toLowerCase() : null) : [];
      if (!domains.length || domains.includes(null)) return send(response, 400, { error: "At least one valid domain is required." }, origin);
      const now = Date.now();
      const reason = accessReason(input.reason);
      const item = { id: crypto.randomUUID(), code: input.code, deviceId: device.id, domains, reason, status: device.accessPolicy === "confirm" ? "pending" : "approved", mode: device.accessPolicy, client: clientMetadata(input.client), createdAt: now, expiresAt: now + ACCESS_TTL_MS };
      store.accessRequests.set(item.id, item);
      audit(device.id, item.id, "requested", { domains, reason, mode: item.mode, client: item.client, clientIp: clientIp(request) });
      if (item.status === "approved") audit(device.id, item.id, "auto-approved", { domains, reason, mode: item.mode });
      store.save();
      notifyDevice(device.id, { type: "access-request", requestId: item.id, domains, reason, mode: item.mode, status: item.status, expiresAt: item.expiresAt });
      return send(response, 201, item, origin);
    }

    if (request.method === "GET" && url.pathname.startsWith("/v1/access-requests/")) {
      const id = decodeURIComponent(url.pathname.slice("/v1/access-requests/".length));
      const code = url.searchParams.get("code");
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const pair = pairs.get(code);
      const item = store.accessRequests.get(id);
      if (!pair || !item || item.code !== code || !token || !safeEqual(token, pair.readToken)) return send(response, 401, { error: "A valid CLI read token is required." }, origin);
      return send(response, 200, item, origin);
    }

    if (request.method === "GET" && url.pathname === "/v1/device/access-requests") {
      const deviceId = url.searchParams.get("deviceId");
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const device = store.devices.get(deviceId);
      if (!device || !token || !safeEqual(tokenHash(token), device.uploadTokenHash)) return send(response, 401, { error: "A valid device upload token is required." }, origin);
      const requests = [...store.accessRequests.values()].filter((item) => item.deviceId === deviceId && item.expiresAt > Date.now());
      return send(response, 200, { requests }, origin);
    }

    if (request.method === "POST" && url.pathname.startsWith("/v1/device/access-requests/")) {
      const id = decodeURIComponent(url.pathname.slice("/v1/device/access-requests/".length));
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const item = store.accessRequests.get(id);
      const device = item && store.devices.get(item.deviceId);
      if (!device || !token || !safeEqual(tokenHash(token), device.uploadTokenHash)) return send(response, 401, { error: "A valid device upload token is required." }, origin);
      if (item.status !== "pending" || item.expiresAt <= Date.now()) return send(response, 409, { error: "Access request is no longer pending." }, origin);
      if (!["approved", "denied"].includes(input.decision)) return send(response, 400, { error: "Decision must be approved or denied." }, origin);
      item.status = input.decision;
      item.decidedAt = Date.now();
      audit(device.id, item.id, input.decision, { domains: item.domains, reason: item.reason, mode: item.mode });
      store.save();
      notify(item.code, { type: "access-decision", requestId: item.id, status: item.status });
      return send(response, 200, item, origin);
    }

    if (request.method === "GET" && url.pathname === "/v1/device/audit") {
      const deviceId = url.searchParams.get("deviceId");
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const device = store.devices.get(deviceId);
      if (!device || !token || !safeEqual(tokenHash(token), device.uploadTokenHash)) return send(response, 401, { error: "A valid device upload token is required." }, origin);
      const events = store.auditEvents.filter((event) => event.deviceId === deviceId).slice(-100).reverse();
      return send(response, 200, { events, retentionDays: 90, maxEvents: AUDIT_MAX_PER_DEVICE }, origin);
    }

    if (request.method === "POST" && url.pathname === "/v1/imports") {
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const pair = pairs.get(input.code);
      if (!pair || !token || !safeEqual(token, pair.readToken)) return send(response, 401, { error: "A valid CLI read token is required." }, origin);
      if (!isDomain(input.domain)) return send(response, 400, { error: "A valid domain is required." }, origin);
      const uploadToken = crypto.randomBytes(32).toString("base64url");
      const item = { id: crypto.randomUUID(), code: input.code, domain: input.domain.toLowerCase(), reason: accessReason(input.reason, "One-time Console Cookie import"), uploadTokenHash: tokenHash(uploadToken), createdAt: Date.now(), expiresAt: Date.now() + IMPORT_TTL_MS, envelope: null };
      store.imports.set(item.id, item);
      store.save();
      return send(response, 201, { id: item.id, domain: item.domain, reason: item.reason, uploadToken, publicKey: pair.publicKey, expiresAt: item.expiresAt }, origin);
    }

    if (request.method === "POST" && url.pathname.startsWith("/v1/imports/")) {
      const id = decodeURIComponent(url.pathname.slice("/v1/imports/".length));
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const item = store.imports.get(id);
      if (!item || item.expiresAt <= Date.now()) return send(response, 404, { error: "Import session is invalid or expired." }, origin);
      if (item.envelope) return send(response, 409, { error: "Import session has already been used." }, origin);
      if (!token || !safeEqual(tokenHash(token), item.uploadTokenHash)) return send(response, 401, { error: "A valid one-time upload token is required." }, origin);
      if (!input.envelope) return send(response, 400, { error: "An encrypted envelope is required." }, origin);
      item.envelope = input.envelope;
      delete item.uploadTokenHash;
      store.save();
      notify(item.code, { type: "console-import", importId: item.id, domain: item.domain, createdAt: Date.now() });
      return send(response, 201, { ok: true }, origin);
    }

    if (request.method === "GET" && url.pathname.startsWith("/v1/imports/")) {
      const id = decodeURIComponent(url.pathname.slice("/v1/imports/".length));
      const code = url.searchParams.get("code");
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const pair = pairs.get(code);
      const item = store.imports.get(id);
      if (!pair || !item || item.code !== code || !token || !safeEqual(token, pair.readToken)) return send(response, 401, { error: "A valid CLI read token is required." }, origin);
      if (!item.envelope) return send(response, 404, { error: "Console import has not been uploaded yet." }, origin);
      store.imports.delete(id);
      store.save();
      return send(response, 200, { id: item.id, domain: item.domain, envelope: item.envelope }, origin);
    }

    if (request.method === "GET" && url.pathname === "/v1/devices") {
      const code = url.searchParams.get("code");
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const pair = pairs.get(code);
      if (!pair || !token || !safeEqual(token, pair.readToken)) return send(response, 401, { error: "A valid CLI read token is required." }, origin);
      const devices = [...store.devices.values()].filter((device) => device.code === code).map(({ uploadTokenHash, code: _, ...device }) => device);
      return send(response, 200, { devices }, origin);
    }

    if (request.method === "POST" && url.pathname.startsWith("/v1/devices/") && url.pathname.endsWith("/profile")) {
      const id = decodeURIComponent(url.pathname.slice("/v1/devices/".length, -"/profile".length));
      const code = input.code;
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const pair = pairs.get(code);
      const device = store.devices.get(id);
      if (!pair || !device || device.code !== code || !token || !safeEqual(token, pair.readToken)) return send(response, 401, { error: "A valid CLI read token is required." }, origin);
      if (input.alias !== undefined) device.alias = typeof input.alias === "string" ? input.alias.trim().slice(0, 80) : "";
      if (input.note !== undefined) device.note = typeof input.note === "string" ? input.note.trim().slice(0, 500) : "";
      store.save();
      const { uploadTokenHash, code: _, ...result } = device;
      return send(response, 200, result, origin);
    }

    if (request.method === "POST" && url.pathname === "/v1/messages") {
      if (typeof input.deviceId !== "string" || !isDomain(input.domain) || !input.envelope) {
        return send(response, 400, { error: "A device ID, valid domain, and envelope are required." }, origin);
      }
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const device = store.devices.get(input.deviceId);
      if (!device || !token || !safeEqual(tokenHash(token), device.uploadTokenHash)) return send(response, 401, { error: "A valid device upload token is required." }, origin);
      device.lastSeenAt = Date.now();
      if (input.metadata) device.metadata = browserMetadata(input.metadata);
      const now = Date.now();
      const message = {
        id: crypto.randomUUID(), code: device.code, deviceId: device.id, domain: input.domain.toLowerCase(), envelope: input.envelope,
        createdAt: now, expiresAt: now + MESSAGE_TTL_MS
      };
      for (const [id, existing] of store.messages) {
        if (existing.code === device.code && existing.deviceId === device.id && existing.domain === message.domain) store.messages.delete(id);
      }
      store.messages.set(message.id, message);
      store.save();
      notify(device.code, { type: "cookie-update", browserId: device.id, domain: message.domain, createdAt: message.createdAt });
      return send(response, 201, { id: message.id, expiresAt: message.expiresAt }, origin);
    }

    if (request.method === "GET" && url.pathname === "/v1/messages") {
      const code = url.searchParams.get("code");
      const domain = url.searchParams.get("domain")?.toLowerCase();
      const deviceId = url.searchParams.get("deviceId");
      const accessRequestId = url.searchParams.get("accessRequestId");
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const pair = pairs.get(code);
      if (!pair || !token || !safeEqual(token, pair.readToken)) {
        return send(response, 401, { error: "A valid CLI read token is required." }, origin);
      }
      const access = store.accessRequests.get(accessRequestId);
      const scopeMatches = access && access.code === code && access.deviceId === deviceId && access.status === "approved" && !access.usedAt && access.expiresAt > Date.now() && (access.domains.includes("*") || (domain && access.domains.includes(domain)));
      if (!scopeMatches) return send(response, 403, { error: "An approved browser access request is required." }, origin);
      if (!domain) {
        const messages = [...store.messages.values()].filter((item) => item.code === code && (!deviceId || item.deviceId === deviceId));
        access.usedAt = Date.now();
        audit(deviceId, access.id, "consumed", { domains: access.domains, reason: access.reason, count: messages.length });
        store.save();
        return send(response, 200, { messages }, origin);
      }
      const message = [...store.messages.values()].reverse().find((item) => item.code === code && item.domain === domain && (!deviceId || item.deviceId === deviceId));
      if (!message) return send(response, 404, { error: "No message found." }, origin);
      access.usedAt = Date.now();
      audit(deviceId, access.id, "consumed", { domains: [domain], reason: access.reason, count: 1 });
      store.save();
      return send(response, 200, message, origin);
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/v1/messages/")) {
      const id = decodeURIComponent(url.pathname.slice("/v1/messages/".length));
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const message = store.messages.get(id);
      const pair = message && pairs.get(message.code);
      if (!pair || !token || !safeEqual(token, pair.readToken)) {
        return send(response, 401, { error: "A valid CLI read token is required." }, origin);
      }
      store.messages.delete(id);
      store.save();
      return send(response, 204, {}, origin);
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/v1/pairs/")) {
      const code = decodeURIComponent(url.pathname.slice("/v1/pairs/".length));
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const pair = pairs.get(code);
      if (!pair || !token || !safeEqual(token, pair.readToken)) return send(response, 401, { error: "A valid CLI read token is required." }, origin);
      const revokedDeviceIds = new Set([...store.devices.values()].filter((device) => device.code === code).map((device) => device.id));
      for (const [id, device] of store.devices) if (device.code === code) store.devices.delete(id);
      for (const [id, message] of store.messages) if (message.code === code) store.messages.delete(id);
      for (const [id, item] of store.imports) if (item.code === code) store.imports.delete(id);
      for (const [id, item] of store.accessRequests) if (item.code === code) store.accessRequests.delete(id);
      const audits = store.auditEvents.filter((event) => !revokedDeviceIds.has(event.deviceId));
      store.auditEvents.splice(0, store.auditEvents.length, ...audits);
      const subscriptions = store.pushSubscriptions.filter((subscription) => subscription.code !== code);
      store.pushSubscriptions.splice(0, store.pushSubscriptions.length, ...subscriptions);
      pairs.delete(code);
      store.save();
      return send(response, 204, {}, origin);
    }

    if (request.method === "GET" && url.pathname === "/v1/push/key") return send(response, 200, { publicKey: vapidPublicKey || null }, origin);

    if (request.method === "POST" && url.pathname === "/v1/push/subscriptions") {
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const pair = pairs.get(input.code);
      if (!pair || !token || !safeEqual(token, pair.readToken)) return send(response, 401, { error: "A valid CLI read token is required." }, origin);
      if (!input.subscription?.endpoint) return send(response, 400, { error: "A valid Web Push subscription is required." }, origin);
      const subscriptions = store.pushSubscriptions.filter((item) => item.subscription.endpoint !== input.subscription.endpoint);
      store.pushSubscriptions.splice(0, store.pushSubscriptions.length, ...subscriptions);
      store.pushSubscriptions.push({ code: input.code, subscription: input.subscription, createdAt: Date.now() });
      store.save();
      return send(response, 201, { ok: true }, origin);
    }

    return send(response, 404, { error: "Not found." }, origin);
  });

  const websocket = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === "/v1/device/ws") {
      const deviceId = url.searchParams.get("deviceId");
      const token = url.searchParams.get("token");
      const device = store.devices.get(deviceId);
      if (!device || !token || !safeEqual(tokenHash(token), device.uploadTokenHash)) return socket.destroy();
      return websocket.handleUpgrade(request, socket, head, (client) => {
        if (!deviceSockets.has(deviceId)) deviceSockets.set(deviceId, new Set());
        deviceSockets.get(deviceId).add(client);
        client.on("close", () => deviceSockets.get(deviceId)?.delete(client));
        client.send(JSON.stringify({ type: "connected" }));
      });
    }
    if (url.pathname !== "/v1/ws") return socket.destroy();
    const code = url.searchParams.get("code");
    const token = url.searchParams.get("token");
    const pair = pairs.get(code);
    if (!pair || !token || !safeEqual(token, pair.readToken)) return socket.destroy();
    websocket.handleUpgrade(request, socket, head, (client) => {
      if (!sockets.has(code)) sockets.set(code, new Set());
      sockets.get(code).add(client);
      client.on("close", () => sockets.get(code)?.delete(client));
      client.send(JSON.stringify({ type: "connected" }));
    });
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || "127.0.0.1";
  createRelay().listen(port, host, () => console.log(`CookieSync relay listening on ${host}:${port}`));
}
