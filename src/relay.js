import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import webpush from "web-push";
import { WebSocketServer } from "ws";
import { isDomain } from "./domain.js";
import { openRelayStore, pushKey } from "./relay-store.js";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_WS_PAYLOAD_BYTES = 64 * 1024;
const WS_HEARTBEAT_MS = 30 * 1000;
const PAIR_TTL_MS = 10 * 60 * 1000;
const MESSAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const IMPORT_TTL_MS = 5 * 60 * 1000;
const ACCESS_TTL_MS = 2 * 60 * 1000;
const DEVICE_COMMAND_TIMEOUT_MS = 10 * 1000;
const AUDIT_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const AUDIT_MAX_PER_DEVICE = 500;
const SWEEP_INTERVAL_MS = 60 * 1000;
const AUDIT_PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_RATE_LIMITS = {
  api: { max: 120, windowMs: 60_000 },
  pairs: { max: 10, windowMs: 60_000 },
  claims: { max: 20, windowMs: 60_000 },
  imports: { max: 10, windowMs: 60_000 },
  uploads: { max: 600, windowMs: 60_000 }
};

// Thrown by handlers to answer with a JSON error; code is the stable, machine-readable part clients branch on.
class HttpError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

const DEVICE_TOKEN_ERROR = "A valid device upload token is required.";
const READ_TOKEN_ERROR = "A valid CLI read token is required.";

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function bearer(request) {
  return request.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
}

function maskedPairCode(code) {
  return code.length > 9 ? `${code.slice(0, 4)}...${code.slice(-4)}` : code;
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

function openUrl(value) {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function clientIp(request) {
  const cloudflare = request.headers["cf-connecting-ip"];
  const forwarded = request.headers["x-forwarded-for"]?.split(",")[0].trim();
  return cloudflare || forwarded || request.socket.remoteAddress || "unknown";
}

// Parses the request target; a malformed Host header or percent-escape is the client's mistake, not a crash.
function requestUrl(request) {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    decodeURIComponent(url.pathname);
    return url;
  } catch {
    return null;
  }
}

function pathParam(url, prefix, suffix = "") {
  return decodeURIComponent(url.pathname.slice(prefix.length, suffix ? -suffix.length : undefined));
}

function createRateLimiter() {
  const entries = new Map();
  let prunedAt = Date.now();
  return (key, { max, windowMs }) => {
    const now = Date.now();
    // Forget finished windows now and then so one-off clients do not accumulate.
    if (now - prunedAt > 60_000) {
      for (const [entryKey, entry] of entries) if (entry.resetAt <= now) entries.delete(entryKey);
      prunedAt = now;
    }
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

function send(response, status, value, origin, extraHeaders = {}) {
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  if (origin) Object.assign(headers, { "access-control-allow-origin": origin, vary: "Origin" });
  response.writeHead(status, { ...headers, ...extraHeaders });
  response.end(status === 204 ? undefined : JSON.stringify(value));
}

function consoleUploadPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>CookieSync Console Import</title><style>
  :root{color-scheme:light}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f0e6;color:#13251d;font-family:ui-monospace,monospace}.card{width:min(600px,calc(100% - 32px));border:1px solid #13251d;background:#fbf8ef;padding:36px;box-shadow:10px 10px 0 #c9ff45}h1{margin:0 0 18px;font:700 28px ui-sans-serif,sans-serif}p{line-height:1.6}.bad{color:#a43b1c}</style></head><body><main class="card"><h1>CookieSync Console Import</h1><p id="status">Uploading the encrypted Cookie snapshot...</p></main><script>
  (async()=>{const status=document.getElementById("status");try{const value=JSON.parse(decodeURIComponent(location.hash.slice(1)));history.replaceState(null,"",location.pathname);if(!value.id||!value.uploadToken||!value.envelope)throw Error("Invalid upload payload.");const response=await fetch("/v1/imports/"+encodeURIComponent(value.id),{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+value.uploadToken},body:JSON.stringify({envelope:value.envelope})});if(!response.ok)throw Error((await response.json()).error||"Upload failed.");status.textContent="Uploaded "+Number(value.count||0)+" cookies for "+String(value.domain||"")+". You can close this page."}catch(error){status.className="bad";status.textContent="CookieSync: "+error.message}})();
  </script></body></html>`;
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
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) throw new HttpError(413, "too_large", "Request body is too large.", { connection: "close" });
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "aborted", "The request body was interrupted.");
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value;
  } catch {
    throw new HttpError(400, "invalid_json", "Invalid JSON.");
  }
}

export function createRelay({
  dataDirectory = process.env.COOKIE_SYNC_RELAY_DATA || "./data",
  redisUrl = process.env.COOKIE_SYNC_REDIS_URL,
  redisPrefix = process.env.COOKIE_SYNC_REDIS_PREFIX || "cs:",
  rateLimits = DEFAULT_RATE_LIMITS
} = {}) {
  const storeReady = openRelayStore({ dataDirectory, redisUrl, redisPrefix }).then(async (store) => {
    await store.ready;
    return store;
  });
  // Surfaced on the first request; avoid an unhandled rejection before then.
  storeReady.catch(() => {});
  let store;
  storeReady.then((value) => { store = value; }, () => {});
  const rateLimit = createRateLimiter();
  const allowedOrigins = (process.env.COOKIE_SYNC_ALLOWED_ORIGINS || "*").split(",").map((value) => value.trim());
  const allowOrigin = (origin) => origin && (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) ? origin : undefined;

  const sockets = new Map();
  const deviceSockets = new Map();
  const pendingDeviceCommands = new Map();
  const vapidPublicKey = process.env.COOKIE_SYNC_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.COOKIE_SYNC_VAPID_PRIVATE_KEY;
  if (vapidPublicKey && vapidPrivateKey) webpush.setVapidDetails(process.env.COOKIE_SYNC_VAPID_SUBJECT || "mailto:admin@ivjn.us", vapidPublicKey, vapidPrivateKey);

  const track = (map, key, client) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(client);
    client.on("close", () => {
      const set = map.get(key);
      set?.delete(client);
      if (set && !set.size) map.delete(key);
    });
  };
  const closeSockets = (map, key) => {
    for (const client of map.get(key) || []) client.close(4001, "revoked");
    map.delete(key);
  };
  const notify = async (code, event) => {
    const payload = JSON.stringify(event);
    for (const socket of sockets.get(code) || []) if (socket.readyState === 1) socket.send(payload);
    if (!vapidPrivateKey) return;
    for (const item of await store.getMany("push", await store.zMembers(`pair-push:${code}`))) {
      webpush.sendNotification(item.subscription, payload, { TTL: 60 }).catch(() => {});
    }
  };
  const notifyDevice = (deviceId, event) => {
    const payload = JSON.stringify(event);
    let sent = 0;
    for (const socket of deviceSockets.get(deviceId) || []) {
      if (socket.readyState !== 1) continue;
      socket.send(payload);
      sent += 1;
    }
    return sent;
  };
  const audit = async (deviceId, requestId, action, details = {}) => {
    await store.listAppend(`audit:${deviceId}`, { id: crypto.randomUUID(), deviceId, requestId, action, createdAt: Date.now(), ...details }, AUDIT_MAX_PER_DEVICE);
    await store.zAdd("audit-devices", deviceId, 0);
  };

  // A device token: unknown_device tells the extension its pairing is gone for good; invalid_token may be a mistake.
  const requireDevice = async (request, deviceId) => {
    const device = typeof deviceId === "string" && deviceId ? await store.get("device", deviceId) : null;
    if (!device) throw new HttpError(401, "unknown_device", DEVICE_TOKEN_ERROR);
    const token = bearer(request);
    if (!token || !safeEqual(tokenHash(token), device.uploadTokenHash)) throw new HttpError(401, "invalid_token", DEVICE_TOKEN_ERROR);
    return device;
  };
  const requirePair = async (request, code) => {
    const pair = typeof code === "string" && code ? await store.get("pair", code) : null;
    if (!pair) throw new HttpError(401, "unknown_pair", READ_TOKEN_ERROR);
    const token = bearer(request);
    if (!token || !safeEqual(token, pair.readToken)) throw new HttpError(401, "invalid_token", READ_TOKEN_ERROR);
    return pair;
  };
  const publicDevice = ({ uploadTokenHash, code, ...device }) => device;

  const deleteMessage = async (id) => {
    const message = await store.get("message", id);
    await store.delete("message", id);
    await store.zRem("expiry:message", id);
    if (!message) return;
    await store.zRem(`device-messages:${message.deviceId}`, id);
    await store.update("latest", `${message.deviceId}:${message.domain}`, (current) => current?.id === id ? null : undefined);
  };
  const deleteAccessRequest = async (item) => {
    await store.delete("access", item.id);
    await store.zRem(`device-access:${item.deviceId}`, item.id);
    await store.zRem("expiry:access", item.id);
  };
  // Queue a pair for the sweep once nothing may still use it, but never before its claim window ends.
  const reconsiderPair = async (code) => {
    const pair = await store.get("pair", code);
    if (pair) await store.zAdd("expiry:pair", code, Math.max(pair.expiresAt, Date.now()));
  };
  const deleteImport = async (item) => {
    await store.delete("import", item.id);
    await store.zRem(`pair-imports:${item.code}`, item.id);
    await store.zRem("expiry:import", item.id);
    await reconsiderPair(item.code);
  };
  const deleteDevice = async (device) => {
    for (const id of await store.zMembers(`device-messages:${device.id}`)) await deleteMessage(id);
    for (const item of await store.getMany("access", await store.zMembers(`device-access:${device.id}`))) await deleteAccessRequest(item);
    await store.zDelete(`device-messages:${device.id}`);
    await store.zDelete(`device-access:${device.id}`);
    await store.listDelete(`audit:${device.id}`);
    await store.zRem("audit-devices", device.id);
    await store.zRem(`pair-devices:${device.code}`, device.id);
    await store.delete("device", device.id);
    await reconsiderPair(device.code);
  };
  const deletePair = async (code) => {
    const devices = await store.getMany("device", await store.zMembers(`pair-devices:${code}`));
    for (const device of devices) await deleteDevice(device);
    for (const item of await store.getMany("import", await store.zMembers(`pair-imports:${code}`))) await deleteImport(item);
    for (const id of await store.zMembers(`pair-push:${code}`)) await store.delete("push", id);
    await store.zDelete(`pair-imports:${code}`);
    await store.zDelete(`pair-push:${code}`);
    await store.zDelete(`pair-devices:${code}`);
    await store.zRem("expiry:pair", code);
    await store.delete("pair", code);
    return devices;
  };

  let auditPrunedAt = 0;
  const sweep = async () => {
    const now = Date.now();
    for (const id of await store.zRangeByScore("expiry:message", now)) await deleteMessage(id);
    for (const id of await store.zRangeByScore("expiry:import", now)) {
      const item = await store.get("import", id);
      if (item) await deleteImport(item);
      else await store.zRem("expiry:import", id);
    }
    for (const id of await store.zRangeByScore("expiry:access", now)) {
      const item = await store.get("access", id);
      if (!item) {
        await store.zRem("expiry:access", id);
        continue;
      }
      if (item.status === "pending") await audit(item.deviceId, item.id, "expired", { domains: item.domains, mode: item.mode });
      await deleteAccessRequest(item);
    }
    // A pair outlives its 10-minute claim window while browsers or Console imports still use it.
    // In use: drop it from the queue; deleting its last browser or import queues it again.
    for (const code of await store.zRangeByScore("expiry:pair", now)) {
      if ((await store.zMembers(`pair-devices:${code}`)).length || (await store.zMembers(`pair-imports:${code}`)).length) {
        await store.zRem("expiry:pair", code);
        continue;
      }
      await deletePair(code);
    }
    if (now - auditPrunedAt > AUDIT_PRUNE_INTERVAL_MS) {
      auditPrunedAt = now;
      for (const deviceId of await store.zMembers("audit-devices")) {
        const events = await store.listAll(`audit:${deviceId}`);
        const kept = events.filter((event) => event.createdAt > now - AUDIT_TTL_MS);
        if (kept.length !== events.length) await store.listReplace(`audit:${deviceId}`, kept);
        if (!kept.length) await store.zRem("audit-devices", deviceId);
      }
    }
  };
  let sweeping = false;
  const sweepTimer = setInterval(() => {
    if (sweeping || !store) return;
    sweeping = true;
    sweep().catch((error) => console.error("CookieSync relay sweep failed:", error)).finally(() => { sweeping = false; });
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref();

  async function handle(request, response, url, origin) {
    const reply = (status, value, headers) => send(response, status, value, origin, headers);

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/") {
      const code = url.searchParams.get("pair");
      const pair = code ? await store.get("pair", code) : null;
      const valid = pair && pair.expiresAt > Date.now() ? pair : null;
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'", "x-content-type-options": "nosniff" });
      return response.end(request.method === "HEAD" ? undefined : pairingPage(valid));
    }
    if (request.method === "GET" && url.pathname === "/console-upload") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'", "x-content-type-options": "nosniff" });
      return response.end(consoleUploadPage());
    }
    if (url.pathname !== "/healthz") {
      const ip = clientIp(request);
      const bucket = request.method === "POST" && url.pathname === "/v1/pairs" ? "pairs"
        : request.method === "POST" && url.pathname === "/v1/devices" ? "claims"
          : request.method === "POST" && (url.pathname === "/v1/imports" || url.pathname.startsWith("/v1/imports/")) ? "imports"
            : request.method === "POST" && (url.pathname === "/v1/messages" || url.pathname === "/v1/messages/batch") ? "uploads" : "api";
      const uploadToken = bucket === "uploads" ? bearer(request) : "";
      const limiterKey = uploadToken ? `${bucket}:${ip}:${tokenHash(uploadToken)}` : `${bucket}:${ip}`;
      const retryAfter = rateLimit(limiterKey, rateLimits[bucket] || rateLimits.api);
      if (retryAfter) throw new HttpError(429, "rate_limited", "Too many requests. Try again later.", { "retry-after": String(retryAfter) });
    }
    const input = request.method === "GET" || request.method === "HEAD" || request.method === "DELETE" ? {} : await body(request);

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/healthz") {
      return reply(200, { ok: true, websocket: true, webPush: Boolean(vapidPublicKey), storage: store.backend });
    }

    if (request.method === "POST" && url.pathname === "/v1/pairs") {
      if (typeof input.publicKey !== "string" || input.publicKey.length > 1000) {
        throw new HttpError(400, "invalid_public_key", "A valid publicKey is required.");
      }
      const code = crypto.randomBytes(18).toString("base64url").toUpperCase();
      const readToken = crypto.randomBytes(32).toString("base64url");
      const expiresAt = Date.now() + PAIR_TTL_MS;
      await store.set("pair", code, { code, publicKey: input.publicKey, readToken, expiresAt });
      await store.zAdd("expiry:pair", code, expiresAt);
      return reply(201, { code, readToken, expiresAt });
    }

    if (request.method === "GET" && url.pathname.startsWith("/v1/pairs/")) {
      const pair = await store.get("pair", pathParam(url, "/v1/pairs/"));
      if (!pair || pair.expiresAt <= Date.now()) throw new HttpError(404, "pair_expired", "Pair code is invalid or expired.");
      return reply(200, { publicKey: pair.publicKey, expiresAt: pair.expiresAt });
    }

    if (request.method === "POST" && url.pathname === "/v1/devices") {
      if (typeof input.code !== "string") throw new HttpError(400, "pair_required", "A pair code is required.");
      const pair = await store.get("pair", input.code);
      if (!pair || pair.expiresAt <= Date.now()) throw new HttpError(404, "pair_expired", "Pair code is invalid or expired.");
      const uploadToken = crypto.randomBytes(32).toString("base64url");
      const now = Date.now();
      const device = {
        id: crypto.randomUUID(), code: pair.code, uploadTokenHash: tokenHash(uploadToken), alias: "", note: "",
        accessPolicy: "notify", metadata: browserMetadata(input.metadata), createdAt: now, lastSeenAt: now
      };
      await store.set("device", device.id, device);
      await store.zAdd(`pair-devices:${pair.code}`, device.id, now);
      return reply(201, { deviceId: device.id, uploadToken, publicKey: pair.publicKey });
    }

    if (request.method === "POST" && url.pathname.startsWith("/v1/devices/") && url.pathname.endsWith("/policy")) {
      const device = await requireDevice(request, pathParam(url, "/v1/devices/", "/policy"));
      if (!["notify", "confirm"].includes(input.accessPolicy)) throw new HttpError(400, "invalid_policy", "Access policy must be notify or confirm.");
      await store.update("device", device.id, (current) => current && { ...current, accessPolicy: input.accessPolicy });
      return reply(200, { accessPolicy: input.accessPolicy });
    }

    if (request.method === "GET" && url.pathname === "/v1/device/status") {
      const device = await requireDevice(request, url.searchParams.get("deviceId"));
      return reply(200, { pairCode: maskedPairCode(device.code) });
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/v1/devices/") && !url.pathname.slice("/v1/devices/".length).includes("/")) {
      const device = await requireDevice(request, pathParam(url, "/v1/devices/"));
      await deleteDevice(device);
      notifyDevice(device.id, { type: "revoked" });
      closeSockets(deviceSockets, device.id);
      return reply(204);
    }

    if (request.method === "POST" && url.pathname === "/v1/access-requests") {
      await requirePair(request, input.code);
      const device = typeof input.deviceId === "string" ? await store.get("device", input.deviceId) : null;
      if (!device || device.code !== input.code) throw new HttpError(401, "unknown_device", READ_TOKEN_ERROR);
      const domains = Array.isArray(input.domains) ? input.domains.map((domain) => domain === "*" ? "*" : isDomain(domain) ? domain.toLowerCase() : null) : [];
      if (!domains.length || domains.includes(null)) throw new HttpError(400, "invalid_domain", "At least one valid domain is required.");
      const now = Date.now();
      const reason = accessReason(input.reason);
      const item = { id: crypto.randomUUID(), code: input.code, deviceId: device.id, domains, reason, status: device.accessPolicy === "confirm" ? "pending" : "approved", mode: device.accessPolicy, client: clientMetadata(input.client), createdAt: now, expiresAt: now + ACCESS_TTL_MS };
      await store.set("access", item.id, item);
      await store.zAdd(`device-access:${device.id}`, item.id, now);
      await store.zAdd("expiry:access", item.id, item.expiresAt);
      await audit(device.id, item.id, "requested", { domains, reason, mode: item.mode, client: item.client, clientIp: clientIp(request) });
      if (item.status === "approved") await audit(device.id, item.id, "auto-approved", { domains, reason, mode: item.mode });
      notifyDevice(device.id, { type: "access-request", requestId: item.id, domains, reason, mode: item.mode, status: item.status, expiresAt: item.expiresAt });
      return reply(201, item);
    }

    if (request.method === "GET" && url.pathname.startsWith("/v1/access-requests/")) {
      const code = url.searchParams.get("code");
      await requirePair(request, code);
      const item = await store.get("access", pathParam(url, "/v1/access-requests/"));
      if (!item || item.code !== code) throw new HttpError(401, "unknown_request", READ_TOKEN_ERROR);
      return reply(200, item);
    }

    if (request.method === "GET" && url.pathname === "/v1/device/access-requests") {
      const device = await requireDevice(request, url.searchParams.get("deviceId"));
      const now = Date.now();
      const requests = (await store.getMany("access", await store.zMembers(`device-access:${device.id}`))).filter((item) => item.expiresAt > now);
      return reply(200, { requests });
    }

    if (request.method === "POST" && url.pathname.startsWith("/v1/device/access-requests/")) {
      const item = await store.get("access", pathParam(url, "/v1/device/access-requests/"));
      // A swept request must not read as unknown_device, which would make the extension forget its pairing.
      if (!item) throw new HttpError(409, "not_pending", "Access request is no longer pending.");
      const device = await requireDevice(request, item.deviceId);
      if (!["approved", "denied"].includes(input.decision)) throw new HttpError(400, "invalid_decision", "Decision must be approved or denied.");
      const decided = await store.update("access", item.id, (current) => current?.status === "pending" && current.expiresAt > Date.now()
        ? { ...current, status: input.decision, decidedAt: Date.now() } : undefined);
      if (!decided.changed) throw new HttpError(409, "not_pending", "Access request is no longer pending.");
      await audit(device.id, item.id, input.decision, { domains: item.domains, reason: item.reason, mode: item.mode });
      notify(item.code, { type: "access-decision", requestId: item.id, status: input.decision }).catch(() => {});
      return reply(200, decided.value);
    }

    if (request.method === "GET" && url.pathname === "/v1/device/audit") {
      const device = await requireDevice(request, url.searchParams.get("deviceId"));
      const since = Date.now() - AUDIT_TTL_MS;
      const events = (await store.listAll(`audit:${device.id}`)).filter((event) => event.createdAt > since).slice(-100).reverse();
      return reply(200, { events, retentionDays: 90, maxEvents: AUDIT_MAX_PER_DEVICE });
    }

    if (request.method === "POST" && url.pathname === "/v1/imports") {
      const pair = await requirePair(request, input.code);
      if (!isDomain(input.domain)) throw new HttpError(400, "invalid_domain", "A valid domain is required.");
      const uploadToken = crypto.randomBytes(32).toString("base64url");
      const now = Date.now();
      const item = { id: crypto.randomUUID(), code: pair.code, domain: input.domain.toLowerCase(), reason: accessReason(input.reason, "One-time Console Cookie import"), uploadTokenHash: tokenHash(uploadToken), createdAt: now, expiresAt: now + IMPORT_TTL_MS, envelope: null };
      await store.set("import", item.id, item);
      await store.zAdd(`pair-imports:${pair.code}`, item.id, now);
      await store.zAdd("expiry:import", item.id, item.expiresAt);
      return reply(201, { id: item.id, domain: item.domain, reason: item.reason, uploadToken, publicKey: pair.publicKey, expiresAt: item.expiresAt });
    }

    if (request.method === "POST" && url.pathname.startsWith("/v1/imports/")) {
      const id = pathParam(url, "/v1/imports/");
      const token = bearer(request);
      const item = await store.get("import", id);
      if (!item || item.expiresAt <= Date.now()) throw new HttpError(404, "import_expired", "Import session is invalid or expired.");
      if (item.envelope) throw new HttpError(409, "already_used", "Import session has already been used.");
      if (!token || !safeEqual(tokenHash(token), item.uploadTokenHash)) throw new HttpError(401, "invalid_token", "A valid one-time upload token is required.");
      if (!input.envelope) throw new HttpError(400, "envelope_required", "An encrypted envelope is required.");
      // The token is single use: only the first of two racing uploads may store its envelope.
      const uploaded = await store.update("import", id, (current) => current && !current.envelope && current.uploadTokenHash === item.uploadTokenHash
        ? { ...current, envelope: input.envelope, uploadTokenHash: undefined } : undefined);
      if (!uploaded.changed) throw new HttpError(409, "already_used", "Import session has already been used.");
      notify(item.code, { type: "console-import", importId: item.id, domain: item.domain, createdAt: Date.now() }).catch(() => {});
      return reply(201, { ok: true });
    }

    if (request.method === "GET" && url.pathname.startsWith("/v1/imports/")) {
      const code = url.searchParams.get("code");
      await requirePair(request, code);
      const item = await store.get("import", pathParam(url, "/v1/imports/"));
      if (!item || item.code !== code) throw new HttpError(401, "unknown_import", READ_TOKEN_ERROR);
      if (!item.envelope) throw new HttpError(404, "import_pending", "Console import has not been uploaded yet.");
      const taken = await store.update("import", item.id, (current) => current?.envelope ? null : undefined);
      if (!taken.changed) throw new HttpError(401, "unknown_import", READ_TOKEN_ERROR);
      await deleteImport(item);
      return reply(200, { id: item.id, domain: item.domain, envelope: taken.previous.envelope });
    }

    if (request.method === "GET" && url.pathname === "/v1/devices") {
      const code = url.searchParams.get("code");
      await requirePair(request, code);
      const devices = await store.getMany("device", await store.zMembers(`pair-devices:${code}`));
      return reply(200, { devices: devices.filter((device) => device.code === code).map(publicDevice) });
    }

    if (request.method === "POST" && url.pathname.startsWith("/v1/devices/") && url.pathname.endsWith("/profile")) {
      await requirePair(request, input.code);
      const id = pathParam(url, "/v1/devices/", "/profile");
      const updated = await store.update("device", id, (device) => {
        if (!device || device.code !== input.code) return undefined;
        if (input.alias !== undefined) device.alias = typeof input.alias === "string" ? input.alias.trim().slice(0, 80) : "";
        if (input.note !== undefined) device.note = typeof input.note === "string" ? input.note.trim().slice(0, 500) : "";
        return device;
      });
      if (!updated.changed) throw new HttpError(401, "unknown_device", READ_TOKEN_ERROR);
      return reply(200, publicDevice(updated.value));
    }

    if (request.method === "POST" && url.pathname === "/v1/device-commands/open") {
      await requirePair(request, input.code);
      const device = typeof input.deviceId === "string" ? await store.get("device", input.deviceId) : null;
      if (!device || device.code !== input.code) throw new HttpError(401, "unknown_device", READ_TOKEN_ERROR);
      const targetUrl = openUrl(input.url);
      if (!targetUrl) throw new HttpError(400, "invalid_url", "A valid HTTP or HTTPS URL is required.");
      const id = crypto.randomUUID();
      const result = new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendingDeviceCommands.delete(id);
          resolve({ status: 504, value: { error: "Browser did not acknowledge the open command.", code: "device_timeout" } });
        }, DEVICE_COMMAND_TIMEOUT_MS);
        pendingDeviceCommands.set(id, { deviceId: device.id, resolve: (value) => {
          clearTimeout(timer);
          pendingDeviceCommands.delete(id);
          resolve(value.ok
            ? { status: 200, value: { ok: true, url: targetUrl } }
            : { status: 502, value: { error: typeof value.error === "string" ? value.error.slice(0, 300) : "Browser could not open the URL.", code: "device_failed" } });
        } });
      });
      if (!notifyDevice(device.id, { type: "open-url", commandId: id, url: targetUrl })) {
        pendingDeviceCommands.get(id)?.resolve({ ok: false, error: "Browser is offline." });
        const outcome = await result;
        return reply(409, { ...outcome.value, code: "device_offline" });
      }
      const outcome = await result;
      return reply(outcome.status, outcome.value);
    }

    if (request.method === "POST" && (url.pathname === "/v1/messages" || url.pathname === "/v1/messages/batch")) {
      const batch = url.pathname.endsWith("/batch");
      const snapshots = batch ? input.messages : [{ domain: input.domain, envelope: input.envelope }];
      if (typeof input.deviceId !== "string" || !Array.isArray(snapshots) || !snapshots.length || snapshots.length > 100
        || snapshots.some((snapshot) => !isDomain(snapshot?.domain) || !snapshot.envelope)) {
        throw new HttpError(400, "invalid_snapshot", batch ? "A device ID and 1-100 valid message snapshots are required." : "A device ID, valid domain, and envelope are required.");
      }
      const device = await requireDevice(request, input.deviceId);
      const now = Date.now();
      await store.update("device", device.id, (current) => current && { ...current, lastSeenAt: now, ...(input.metadata ? { metadata: browserMetadata(input.metadata) } : {}) });
      const messages = snapshots.map((snapshot) => ({
        id: crypto.randomUUID(), code: device.code, deviceId: device.id, domain: snapshot.domain.toLowerCase(), envelope: snapshot.envelope,
        createdAt: now, expiresAt: now + MESSAGE_TTL_MS
      }));
      for (const message of messages) {
        await store.set("message", message.id, message);
        await store.zAdd(`device-messages:${device.id}`, message.id, now);
        await store.zAdd("expiry:message", message.id, message.expiresAt);
        // Only the newest snapshot per browser and domain is kept.
        const previous = await store.swap("latest", `${device.id}:${message.domain}`, { id: message.id });
        if (previous && previous.id !== message.id) await deleteMessage(previous.id);
      }
      for (const message of messages) notify(device.code, { type: "cookie-update", browserId: device.id, domain: message.domain, createdAt: message.createdAt }).catch(() => {});
      return reply(201, batch
        ? { messages: messages.map(({ id, domain, expiresAt }) => ({ id, domain, expiresAt })) }
        : { id: messages[0].id, expiresAt: messages[0].expiresAt });
    }

    if (request.method === "GET" && url.pathname === "/v1/messages") {
      const code = url.searchParams.get("code");
      const domain = url.searchParams.get("domain")?.toLowerCase();
      const deviceId = url.searchParams.get("deviceId");
      const accessRequestId = url.searchParams.get("accessRequestId");
      await requirePair(request, code);
      const now = Date.now();
      const usable = (access) => access && access.code === code && access.deviceId === deviceId && access.status === "approved" && !access.usedAt && access.expiresAt > Date.now()
        && (access.domains.includes("*") || (domain && access.domains.includes(domain)));
      const access = accessRequestId ? await store.get("access", accessRequestId) : null;
      if (!usable(access)) throw new HttpError(403, "access_required", "An approved browser access request is required.");
      let value;
      let consumed;
      if (!domain) {
        const messages = (await store.getMany("message", await store.zMembers(`device-messages:${deviceId}`))).filter((item) => item.code === code && item.expiresAt > now);
        value = { messages };
        consumed = { domains: access.domains, count: messages.length };
      } else {
        const latest = await store.get("latest", `${deviceId}:${domain}`);
        const message = latest ? await store.get("message", latest.id) : null;
        if (!message || message.code !== code || message.expiresAt <= now) throw new HttpError(404, "no_message", "No message found.");
        value = message;
        consumed = { domains: [domain], count: 1 };
      }
      // An access grant reads once, even when two requests race with it.
      const used = await store.update("access", access.id, (current) => usable(current) ? { ...current, usedAt: Date.now() } : undefined);
      if (!used.changed) throw new HttpError(403, "access_required", "An approved browser access request is required.");
      await audit(deviceId, access.id, "consumed", { ...consumed, reason: access.reason });
      return reply(200, value);
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/v1/messages/")) {
      const id = pathParam(url, "/v1/messages/");
      const message = await store.get("message", id);
      if (!message) throw new HttpError(401, "unknown_message", READ_TOKEN_ERROR);
      await requirePair(request, message.code);
      await deleteMessage(id);
      return reply(204);
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/v1/pairs/")) {
      const code = pathParam(url, "/v1/pairs/");
      await requirePair(request, code);
      const devices = await deletePair(code);
      // Tell the browsers right away so the extension stops uploading and shows it is no longer paired.
      for (const device of devices) {
        notifyDevice(device.id, { type: "revoked" });
        closeSockets(deviceSockets, device.id);
      }
      closeSockets(sockets, code);
      return reply(204);
    }

    if (request.method === "GET" && url.pathname === "/v1/push/key") return reply(200, { publicKey: vapidPublicKey || null });

    if (request.method === "POST" && url.pathname === "/v1/push/subscriptions") {
      const pair = await requirePair(request, input.code);
      const endpoint = input.subscription?.endpoint;
      if (typeof endpoint !== "string" || JSON.stringify(input.subscription).length > 4096) {
        throw new HttpError(400, "invalid_subscription", "A valid Web Push subscription is required.");
      }
      const id = pushKey(endpoint);
      const previous = await store.swap("push", id, { code: pair.code, subscription: input.subscription, createdAt: Date.now() });
      if (previous && previous.code !== pair.code) await store.zRem(`pair-push:${previous.code}`, id);
      await store.zAdd(`pair-push:${pair.code}`, id, Date.now());
      return reply(201, { ok: true });
    }

    throw new HttpError(404, "not_found", "Not found.");
  }

  const server = http.createServer(async (request, response) => {
    const origin = allowOrigin(request.headers.origin);
    if (request.method === "OPTIONS") {
      if (!origin) return send(response, 403, { error: "Origin is not allowed.", code: "origin_denied" });
      response.writeHead(204, {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
        "access-control-allow-headers": "content-type, authorization",
        "access-control-max-age": "600",
        vary: "Origin"
      });
      return response.end();
    }
    try {
      const url = requestUrl(request);
      if (!url) throw new HttpError(400, "bad_request", "Malformed request URL.");
      store = await storeReady;
      await handle(request, response, url, origin);
    } catch (error) {
      if (response.headersSent) return response.destroy();
      if (error instanceof HttpError) return send(response, error.status, { error: error.message, code: error.code }, origin, error.headers);
      console.error("CookieSync relay request failed:", error);
      send(response, 500, { error: "Internal relay error.", code: "internal" }, origin);
    }
  });

  const websocket = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD_BYTES });
  // Ping every client; one that missed the last pong is gone and its socket is dropped.
  const heartbeat = setInterval(() => {
    for (const client of websocket.clients) {
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, WS_HEARTBEAT_MS);
  heartbeat.unref();

  const accept = (request, socket, head, onClient) => websocket.handleUpgrade(request, socket, head, (client) => {
    client.isAlive = true;
    client.on("pong", () => { client.isAlive = true; });
    client.on("error", () => {});
    onClient(client);
    client.send(JSON.stringify({ type: "connected" }));
  });

  server.on("upgrade", async (request, socket, head) => {
    socket.on("error", () => {});
    try {
      const url = requestUrl(request);
      if (!url) return socket.destroy();
      store = await storeReady;
      if (url.pathname === "/v1/device/ws") {
        const deviceId = url.searchParams.get("deviceId");
        const token = url.searchParams.get("token");
        const device = deviceId ? await store.get("device", deviceId) : null;
        if (!device || !token || !safeEqual(tokenHash(token), device.uploadTokenHash)) return socket.destroy();
        return accept(request, socket, head, (client) => {
          track(deviceSockets, deviceId, client);
          client.on("message", (data) => {
            try {
              const event = JSON.parse(data.toString());
              const pending = event.type === "command-result" && typeof event.commandId === "string" ? pendingDeviceCommands.get(event.commandId) : null;
              if (pending?.deviceId === deviceId) pending.resolve({ ok: event.ok === true, error: event.error });
            } catch {}
          });
        });
      }
      if (url.pathname !== "/v1/ws") return socket.destroy();
      const code = url.searchParams.get("code");
      const token = url.searchParams.get("token");
      const pair = code ? await store.get("pair", code) : null;
      if (!pair || !token || !safeEqual(token, pair.readToken)) return socket.destroy();
      accept(request, socket, head, (client) => track(sockets, code, client));
    } catch (error) {
      console.error("CookieSync relay upgrade failed:", error);
      socket.destroy();
    }
  });

  server.on("close", () => {
    clearInterval(heartbeat);
    clearInterval(sweepTimer);
    for (const client of websocket.clients) client.terminate();
    // Save synchronously, so a relay started right after close() sees every write.
    store?.flush();
    storeReady.then((value) => value.close()).catch(() => {});
  });
  // Lets tests and operators run the expiry sweep on demand.
  server.sweep = async () => {
    store = await storeReady;
    await sweep();
  };
  server.storeReady = storeReady;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || "127.0.0.1";
  const relay = createRelay();
  relay.storeReady
    .then((store) => relay.listen(port, host, () => console.log(`CookieSync relay listening on ${host}:${port} (storage: ${store.backend})`)))
    .catch((error) => {
      console.error("CookieSync relay could not open its storage:", error);
      process.exit(1);
    });
  // Write pending JSON changes and close Redis before the process manager stops the relay.
  const stop = () => {
    relay.close();
    relay.storeReady.then((store) => store.close()).catch(() => {}).finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
