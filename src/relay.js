import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const PAIR_TTL_MS = 10 * 60 * 1000;
const MESSAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function isDomain(value) {
  return typeof value === "string" && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createStore(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, "messages.json");
  let pairs = new Map();
  let messages = new Map();
  try {
    const values = JSON.parse(fs.readFileSync(file, "utf8"));
    pairs = new Map((values.pairs || []).map((pair) => [pair.code, pair]));
    messages = new Map((values.messages || []).map((message) => [message.id, message]));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  function save() {
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ pairs: [...pairs.values()], messages: [...messages.values()] })}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
  }
  return { pairs, messages, save };
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
  for (const [code, pair] of pairs) {
    if (pair.expiresAt <= now && ![...store.messages.values()].some((message) => message.code === code)) {
      pairs.delete(code);
      changed = true;
    }
  }
  if (changed) store.save();
}

function send(response, status, value, origin) {
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  if (origin) headers["access-control-allow-origin"] = origin;
  response.writeHead(status, headers);
  response.end(JSON.stringify(value));
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

export function createRelay({ dataDirectory = process.env.COOKIE_SYNC_RELAY_DATA || "./data" } = {}) {
  const store = createStore(dataDirectory);
  const pairs = store.pairs;
  const allowedOrigins = (process.env.COOKIE_SYNC_ALLOWED_ORIGINS || "*").split(",").map((value) => value.trim());
  const allowOrigin = (origin) => origin && (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) ? origin : undefined;

  return http.createServer(async (request, response) => {
    const origin = allowOrigin(request.headers.origin);
    if (request.method === "OPTIONS") {
      if (!origin) return send(response, 403, { error: "Origin is not allowed." });
      response.writeHead(204, {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "600",
        vary: "Origin"
      });
      return response.end();
    }

    const url = new URL(request.url, `http://${request.headers.host}`);
    cleanup(pairs, store);
    const input = request.method === "GET" || request.method === "DELETE" ? {} : await body(request);
    if (input === undefined) return send(response, 413, { error: "Request body is too large." }, origin);
    if (!input) return send(response, 400, { error: "Invalid JSON." }, origin);

    if (request.method === "GET" && url.pathname === "/healthz") return send(response, 200, { ok: true }, origin);

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

    if (request.method === "POST" && url.pathname === "/v1/messages") {
      if (typeof input.code !== "string" || !isDomain(input.domain) || !input.envelope) {
        return send(response, 400, { error: "A pair code, valid domain, and envelope are required." }, origin);
      }
      const pair = pairs.get(input.code);
      if (!pair || pair.expiresAt <= Date.now()) return send(response, 404, { error: "Pair code is invalid or expired." }, origin);
      const now = Date.now();
      const message = {
        id: crypto.randomUUID(), code: input.code, domain: input.domain.toLowerCase(), envelope: input.envelope,
        createdAt: now, expiresAt: now + MESSAGE_TTL_MS
      };
      store.messages.set(message.id, message);
      store.save();
      return send(response, 201, { id: message.id, expiresAt: message.expiresAt }, origin);
    }

    if (request.method === "GET" && url.pathname === "/v1/messages") {
      const code = url.searchParams.get("code");
      const domain = url.searchParams.get("domain")?.toLowerCase();
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const pair = pairs.get(code);
      if (!pair || !token || !safeEqual(token, pair.readToken)) {
        return send(response, 401, { error: "A valid CLI read token is required." }, origin);
      }
      const message = [...store.messages.values()].reverse().find((item) => item.code === code && item.domain === domain);
      if (!message) return send(response, 404, { error: "No message found." }, origin);
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

    return send(response, 404, { error: "Not found." }, origin);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 8787);
  createRelay().listen(port, "0.0.0.0", () => console.log(`CookieSync relay listening on port ${port}`));
}
