import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import test from "node:test";
import WebSocket from "ws";
import { encryptFor, generateKeyPair } from "../src/crypto.js";
import { createRelay } from "../src/relay.js";

// Every relay test runs on the JSON file; with COOKIE_SYNC_TEST_REDIS_URL (e.g. redis://127.0.0.1:6379/15) also on Redis.
const REDIS_URL = process.env.COOKIE_SYNC_TEST_REDIS_URL;
const backend = new AsyncLocalStorage();
function relayTest(name, fn) {
  for (const kind of ["json", ...(REDIS_URL ? ["redis"] : [])]) {
    test(`${name} [${kind}]`, (context) => backend.run(kind, () => fn(context)));
  }
}

async function startRelay(directory, options = {}) {
  const redis = backend.getStore() === "redis" ? { redisUrl: REDIS_URL, redisPrefix: `cs-test:${path.basename(directory)}:` } : { redisUrl: "" };
  const relay = createRelay({ dataDirectory: directory, ...redis, ...options });
  await relay.storeReady;
  await new Promise((resolve) => relay.listen(0, "127.0.0.1", resolve));
  const { port } = relay.address();
  return { relay, url: `http://127.0.0.1:${port}` };
}

async function json(url, path, options) {
  const response = await fetch(`${url}${path}`, options);
  const value = response.status === 204 ? undefined : await response.json();
  return { response, value };
}

if (REDIS_URL) {
  test.after(async () => {
    const { createClient } = await import("redis");
    const client = createClient({ url: REDIS_URL });
    await client.connect();
    const keys = [];
    for await (const batch of client.scanIterator({ MATCH: "cs-test:*", COUNT: 500 })) keys.push(...batch);
    if (keys.length) await client.sendCommand(["DEL", ...keys]);
    await client.close();
  });
}

// A fresh relay with one pair and one claimed browser.
async function pairedRelay(context, options) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-sync-relay-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { relay, url } = await startRelay(directory, options);
  context.after(() => relay.close());
  const identity = generateKeyPair();
  const pair = await json(url, "/v1/pairs", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicKey: identity.publicKey })
  });
  const device = await json(url, "/v1/devices", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: pair.value.code })
  });
  return {
    relay, url, identity, directory, pair: pair.value, device: device.value,
    cliHeaders: { "content-type": "application/json", authorization: `Bearer ${pair.value.readToken}` },
    deviceHeaders: { "content-type": "application/json", authorization: `Bearer ${device.value.uploadToken}` }
  };
}

function rawRequest(url, text) {
  const { port } = new URL(url);
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(port), "127.0.0.1", () => socket.write(text));
    let data = "";
    socket.on("data", (chunk) => { data += chunk; });
    socket.on("end", () => resolve(data));
    socket.on("error", reject);
  });
}

relayTest("answers malformed URLs and Host headers with 400 and keeps running", async (context) => {
  const { url } = await pairedRelay(context);
  const badPath = await rawRequest(url, "GET /v1/pairs/%E0%A4%A HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
  assert.match(badPath, /^HTTP\/1\.1 400/);
  assert.match(badPath, /"code":"bad_request"/);
  const badHost = await rawRequest(url, "GET /healthz HTTP/1.1\r\nHost: [\r\nConnection: close\r\n\r\n");
  assert.match(badHost, /^HTTP\/1\.1 400/);
  const health = await json(url, "/healthz");
  assert.equal(health.response.status, 200);
});

relayTest("tells a browser it was revoked when the CLI deletes the pair", async (context) => {
  const { url, pair, device, cliHeaders, deviceHeaders } = await pairedRelay(context);
  const socket = new WebSocket(`${url.replace("http", "ws")}/v1/device/ws?deviceId=${device.deviceId}&token=${device.uploadToken}`);
  context.after(() => socket.close());
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  const events = [];
  socket.on("message", (data) => events.push(JSON.parse(data.toString()).type));
  const closed = new Promise((resolve) => socket.once("close", (code) => resolve(code)));

  assert.equal((await json(url, `/v1/pairs/${pair.code}`, { method: "DELETE", headers: cliHeaders })).response.status, 204);
  assert.equal(await closed, 4001);
  assert.ok(events.includes("revoked"));
  const after = await json(url, `/v1/device/access-requests?deviceId=${device.deviceId}`, { headers: deviceHeaders });
  assert.equal(after.response.status, 401);
  assert.equal(after.value.code, "unknown_device");
});

relayTest("distinguishes a wrong device token from a deleted device", async (context) => {
  const { url, device, deviceHeaders } = await pairedRelay(context);
  const wrong = await json(url, `/v1/device/audit?deviceId=${device.deviceId}`, { headers: { authorization: "Bearer wrong" } });
  assert.equal(wrong.value.code, "invalid_token");
  const missing = await json(url, "/v1/device/access-requests/00000000-0000-0000-0000-000000000000", {
    method: "POST", headers: deviceHeaders, body: JSON.stringify({ decision: "approved" })
  });
  assert.equal(missing.response.status, 409);
  assert.equal(missing.value.code, "not_pending");
});

relayTest("lets an access grant read only once when requests race", async (context) => {
  const { url, identity, pair, device, cliHeaders, deviceHeaders } = await pairedRelay(context);
  await json(url, "/v1/messages", {
    method: "POST", headers: deviceHeaders,
    body: JSON.stringify({ deviceId: device.deviceId, domain: "relay.ivjn.us", envelope: encryptFor(identity.publicKey, { domain: "relay.ivjn.us", cookies: [] }) })
  });
  const access = await json(url, "/v1/access-requests", {
    method: "POST", headers: cliHeaders, body: JSON.stringify({ code: pair.code, deviceId: device.deviceId, domains: ["relay.ivjn.us"] })
  });
  const path = `/v1/messages?code=${pair.code}&deviceId=${device.deviceId}&domain=relay.ivjn.us&accessRequestId=${access.value.id}`;
  const results = await Promise.all(Array.from({ length: 8 }, () => json(url, path, { headers: cliHeaders })));
  assert.equal(results.filter((result) => result.response.status === 200).length, 1);
  assert.ok(results.every((result) => [200, 403].includes(result.response.status)));
  const missing = await json(url, "/v1/access-requests", {
    method: "POST", headers: cliHeaders, body: JSON.stringify({ code: pair.code, deviceId: device.deviceId, domains: ["other.example.com"] })
  });
  const none = await json(url, `/v1/messages?code=${pair.code}&deviceId=${device.deviceId}&domain=other.example.com&accessRequestId=${missing.value.id}`, { headers: cliHeaders });
  assert.equal(none.response.status, 404);
  assert.equal(none.value.code, "no_message");
});

relayTest("stores only the first of racing Console import uploads", async (context) => {
  const { url, identity, pair, cliHeaders } = await pairedRelay(context);
  const session = await json(url, "/v1/imports", { method: "POST", headers: cliHeaders, body: JSON.stringify({ code: pair.code, domain: "relay.ivjn.us" }) });
  const upload = () => json(url, `/v1/imports/${session.value.id}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session.value.uploadToken}` },
    body: JSON.stringify({ envelope: encryptFor(identity.publicKey, { domain: "relay.ivjn.us", cookies: [] }) })
  });
  const results = await Promise.all(Array.from({ length: 6 }, upload));
  assert.equal(results.filter((result) => result.response.status === 201).length, 1);
});

relayTest("imports a pre-0.11 data file and sweeps what expired", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-sync-legacy-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const now = Date.now();
  const uploadToken = "legacy-upload-token";
  const uploadTokenHash = crypto.createHash("sha256").update(uploadToken).digest("hex");
  const legacy = {
    pairs: [
      { code: "LIVEPAIR", publicKey: "pk", readToken: "read", expiresAt: now - 1000 },
      { code: "DEADPAIR", publicKey: "pk", readToken: "read2", expiresAt: now - 1000 }
    ],
    devices: [{ id: "dev-1", code: "LIVEPAIR", uploadTokenHash, alias: "Laptop", note: "", accessPolicy: "confirm", metadata: {}, createdAt: now - 5000, lastSeenAt: now - 5000 }],
    messages: [{ id: "msg-1", code: "LIVEPAIR", deviceId: "dev-1", domain: "relay.ivjn.us", envelope: { x: 1 }, createdAt: now - 4000, expiresAt: now + 60_000 }],
    imports: [],
    accessRequests: [{ id: "acc-1", code: "LIVEPAIR", deviceId: "dev-1", domains: ["relay.ivjn.us"], status: "pending", mode: "confirm", createdAt: now - 3000, expiresAt: now - 1000 }],
    auditEvents: [{ id: "aud-1", deviceId: "dev-1", requestId: "acc-1", action: "requested", createdAt: now - 3000 }],
    pushSubscriptions: []
  };
  fs.writeFileSync(path.join(directory, "messages.json"), JSON.stringify(legacy));
  const { relay, url } = await startRelay(directory);
  context.after(() => relay.close());

  const devices = await json(url, "/v1/devices?code=LIVEPAIR", { headers: { authorization: "Bearer read" } });
  assert.deepEqual(devices.value.devices.map((device) => device.alias), ["Laptop"]);
  await relay.sweep();
  const audit = await json(url, "/v1/device/audit?deviceId=dev-1", { headers: { authorization: `Bearer ${uploadToken}` } });
  assert.deepEqual(audit.value.events.map((event) => event.action), ["expired", "requested"]);
  assert.equal((await json(url, "/v1/devices?code=DEADPAIR", { headers: { authorization: "Bearer read2" } })).value.code, "unknown_pair");
  assert.equal((await json(url, "/v1/devices?code=LIVEPAIR", { headers: { authorization: "Bearer read" } })).response.status, 200);
  if (backend.getStore() === "json") assert.ok(fs.existsSync(path.join(directory, "messages.json.v1.bak")));
});

relayTest("stores an encrypted message and lets only the CLI token retrieve it", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-sync-relay-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { relay, url } = await startRelay(directory);
  context.after(() => relay.close());

  const identity = generateKeyPair();
  const pair = await json(url, "/v1/pairs", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ publicKey: identity.publicKey })
  });
  assert.equal(pair.response.status, 201);

  const device = await json(url, "/v1/devices", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: pair.value.code, metadata: { userAgent: "Browser/1.0", os: "TestOS 1", architecture: "x86_64" } })
  });
  assert.equal(device.response.status, 201);

  const upload = await json(url, "/v1/messages", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deviceId: device.value.deviceId,
      domain: "relay.ivjn.us",
      envelope: encryptFor(identity.publicKey, { domain: "relay.ivjn.us", cookies: [] })
    })
  });
  const tokenUpload = await json(url, "/v1/messages", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${device.value.uploadToken}` },
    body: JSON.stringify({ deviceId: device.value.deviceId, domain: "relay.ivjn.us", envelope: encryptFor(identity.publicKey, { domain: "relay.ivjn.us", cookies: [] }) })
  });
  assert.equal(tokenUpload.response.status, 201);
  assert.equal(upload.response.status, 401);

  const readHeaders = { "content-type": "application/json", authorization: `Bearer ${pair.value.readToken}` };
  const access = await json(url, "/v1/access-requests", {
    method: "POST", headers: readHeaders, body: JSON.stringify({ code: pair.value.code, deviceId: device.value.deviceId, domains: ["*"] })
  });
  assert.equal(access.value.status, "approved");
  const listed = await json(url, `/v1/messages?code=${pair.value.code}&deviceId=${device.value.deviceId}&accessRequestId=${access.value.id}`, { headers: readHeaders });
  assert.equal(listed.response.status, 200);
  assert.deepEqual(listed.value.messages.map((message) => message.domain), ["relay.ivjn.us"]);

  const deviceList = await json(url, `/v1/devices?code=${pair.value.code}`, { headers: { authorization: `Bearer ${pair.value.readToken}` } });
  assert.equal(deviceList.response.status, 200);
  assert.equal(deviceList.value.devices[0].metadata.userAgent, "Browser/1.0");
  assert.equal(deviceList.value.devices[0].uploadTokenHash, undefined);
  const profile = await json(url, `/v1/devices/${device.value.deviceId}/profile`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${pair.value.readToken}` },
    body: JSON.stringify({ code: pair.value.code, alias: "Work laptop", note: "Primary Chrome profile" })
  });
  assert.equal(profile.response.status, 200);
  assert.equal(profile.value.alias, "Work laptop");

  const blocked = await json(url, `/v1/messages?code=${pair.value.code}&domain=relay.ivjn.us`);
  assert.equal(blocked.response.status, 401);

  const headers = { authorization: `Bearer ${pair.value.readToken}` };
  const domainAccess = await json(url, "/v1/access-requests", {
    method: "POST", headers: readHeaders, body: JSON.stringify({ code: pair.value.code, deviceId: device.value.deviceId, domains: ["relay.ivjn.us"] })
  });
  const fetched = await json(url, `/v1/messages?code=${pair.value.code}&domain=relay.ivjn.us&deviceId=${device.value.deviceId}&accessRequestId=${domainAccess.value.id}`, { headers });
  assert.equal(fetched.response.status, 200);
  assert.equal(fetched.value.id, tokenUpload.value.id);

  const removed = await json(url, `/v1/messages/${tokenUpload.value.id}`, { method: "DELETE", headers });
  assert.equal(removed.response.status, 204);
  const reused = await json(url, `/v1/messages?code=${pair.value.code}&domain=relay.ivjn.us&deviceId=${device.value.deviceId}&accessRequestId=${domainAccess.value.id}`, { headers });
  assert.equal(reused.response.status, 403);
});

relayTest("lets a device revoke its own authorization but not with another device's token", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-sync-relay-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { relay, url } = await startRelay(directory);
  context.after(() => relay.close());
  const identity = generateKeyPair();
  const pair = await json(url, "/v1/pairs", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicKey: identity.publicKey })
  });
  const device = await json(url, "/v1/devices", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: pair.value.code })
  });
  const other = await json(url, "/v1/devices", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: pair.value.code })
  });
  await json(url, "/v1/messages", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${device.value.uploadToken}` },
    body: JSON.stringify({ deviceId: device.value.deviceId, domain: "relay.ivjn.us", envelope: encryptFor(identity.publicKey, { domain: "relay.ivjn.us", cookies: [] }) })
  });

  const wrongToken = await json(url, `/v1/devices/${device.value.deviceId}`, {
    method: "DELETE", headers: { authorization: `Bearer ${other.value.uploadToken}` }
  });
  assert.equal(wrongToken.response.status, 401);

  const revoked = await json(url, `/v1/devices/${device.value.deviceId}`, {
    method: "DELETE", headers: { authorization: `Bearer ${device.value.uploadToken}` }
  });
  assert.equal(revoked.response.status, 204);

  const cliHeaders = { "content-type": "application/json", authorization: `Bearer ${pair.value.readToken}` };
  const deviceList = await json(url, `/v1/devices?code=${pair.value.code}`, { headers: cliHeaders });
  assert.deepEqual(deviceList.value.devices.map((item) => item.id), [other.value.deviceId]);

  const policyAfterRevoke = await json(url, `/v1/devices/${device.value.deviceId}/policy`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${device.value.uploadToken}` },
    body: JSON.stringify({ accessPolicy: "confirm" })
  });
  assert.equal(policyAfterRevoke.response.status, 401);
});

relayTest("returns a masked pair code only to its authorized device", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-sync-device-status-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { relay, url } = await startRelay(directory);
  context.after(() => relay.close());

  const pair = await json(url, "/v1/pairs", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ publicKey: generateKeyPair().publicKey })
  });
  const device = await json(url, "/v1/devices", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: pair.value.code })
  });

  const authorized = await json(url, `/v1/device/status?deviceId=${encodeURIComponent(device.value.deviceId)}`, {
    headers: { authorization: `Bearer ${device.value.uploadToken}` }
  });
  assert.equal(authorized.response.status, 200);
  assert.equal(authorized.value.pairCode, `${pair.value.code.slice(0, 4)}...${pair.value.code.slice(-4)}`);
  assert.notEqual(authorized.value.pairCode, pair.value.code);

  const unauthorized = await json(url, `/v1/device/status?deviceId=${encodeURIComponent(device.value.deviceId)}`, {
    headers: { authorization: "Bearer wrong-token" }
  });
  assert.equal(unauthorized.response.status, 401);
});

relayTest("permits configured extension origins and rejects other CORS preflights", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-sync-relay-"));
  const previous = process.env.COOKIE_SYNC_ALLOWED_ORIGINS;
  process.env.COOKIE_SYNC_ALLOWED_ORIGINS = "chrome-extension://approved";
  const { relay, url } = await startRelay(directory);
  context.after(() => {
    relay.close();
    fs.rmSync(directory, { recursive: true, force: true });
    if (previous === undefined) delete process.env.COOKIE_SYNC_ALLOWED_ORIGINS;
    else process.env.COOKIE_SYNC_ALLOWED_ORIGINS = previous;
  });

  const allowed = await fetch(`${url}/v1/pairs`, { method: "OPTIONS", headers: { origin: "chrome-extension://approved" } });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "chrome-extension://approved");

  const denied = await fetch(`${url}/v1/pairs`, { method: "OPTIONS", headers: { origin: "chrome-extension://blocked" } });
  assert.equal(denied.status, 403);
});

relayTest("keeps claimed upload devices across relay restarts", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-sync-relay-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const first = await startRelay(directory);
  const identity = generateKeyPair();
  const pair = await json(first.url, "/v1/pairs", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicKey: identity.publicKey })
  });
  const device = await json(first.url, "/v1/devices", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: pair.value.code })
  });
  await new Promise((resolve) => first.relay.close(resolve));

  const second = await startRelay(directory);
  context.after(() => second.relay.close());
  const upload = await json(second.url, "/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${device.value.uploadToken}` },
    body: JSON.stringify({ deviceId: device.value.deviceId, domain: "relay.ivjn.us", envelope: encryptFor(identity.publicKey, { domain: "relay.ivjn.us", cookies: [] }) })
  });
  assert.equal(upload.response.status, 201);
});

relayTest("rate limits pair creation by client IP", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-sync-relay-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const limits = {
    api: { max: 100, windowMs: 60_000 }, pairs: { max: 2, windowMs: 60_000 }, claims: { max: 100, windowMs: 60_000 }
  };
  const { relay, url } = await startRelay(directory, { rateLimits: limits });
  context.after(() => relay.close());
  const identity = generateKeyPair();
  const options = {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.8" },
    body: JSON.stringify({ publicKey: identity.publicKey })
  };
  assert.equal((await fetch(`${url}/v1/pairs`, options)).status, 201);
  assert.equal((await fetch(`${url}/v1/pairs`, options)).status, 201);
  const limited = await fetch(`${url}/v1/pairs`, options);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
});

relayTest("rate limits uploads per device token instead of sharing an IP bucket", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-sync-upload-limit-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const limits = {
    api: { max: 100, windowMs: 60_000 }, pairs: { max: 100, windowMs: 60_000 },
    claims: { max: 100, windowMs: 60_000 }, uploads: { max: 1, windowMs: 60_000 }
  };
  const { relay, url } = await startRelay(directory, { rateLimits: limits });
  context.after(() => relay.close());
  const identity = generateKeyPair();
  const pair = await json(url, "/v1/pairs", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicKey: identity.publicKey })
  });
  const claim = () => json(url, "/v1/devices", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: pair.value.code })
  });
  const first = await claim();
  const second = await claim();
  const upload = (device, domain) => fetch(`${url}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${device.value.uploadToken}`, "cf-connecting-ip": "203.0.113.9" },
    body: JSON.stringify({ deviceId: device.value.deviceId, domain, envelope: encryptFor(identity.publicKey, { domain, cookies: [] }) })
  });

  assert.equal((await upload(first, "first.example.com")).status, 201);
  assert.equal((await upload(first, "again.example.com")).status, 429);
  assert.equal((await upload(second, "second.example.com")).status, 201);
});

relayTest("stores a validated batch of encrypted snapshots in one request", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-sync-batch-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { relay, url } = await startRelay(directory);
  context.after(() => relay.close());
  const identity = generateKeyPair();
  const pair = await json(url, "/v1/pairs", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicKey: identity.publicKey })
  });
  const device = await json(url, "/v1/devices", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: pair.value.code })
  });
  const headers = { "content-type": "application/json", authorization: `Bearer ${device.value.uploadToken}` };
  const messages = ["first.example.com", "second.example.com"].map((domain) => ({
    domain, envelope: encryptFor(identity.publicKey, { domain, cookies: [{ name: domain, value: "1" }] })
  }));
  const uploaded = await json(url, "/v1/messages/batch", {
    method: "POST", headers, body: JSON.stringify({ deviceId: device.value.deviceId, messages })
  });
  assert.equal(uploaded.response.status, 201);
  assert.deepEqual(uploaded.value.messages.map((message) => message.domain), messages.map((message) => message.domain));

  const invalid = await json(url, "/v1/messages/batch", {
    method: "POST", headers, body: JSON.stringify({ deviceId: device.value.deviceId, messages: [...messages, { domain: "invalid", envelope: {} }] })
  });
  assert.equal(invalid.response.status, 400);

  const readHeaders = { authorization: `Bearer ${pair.value.readToken}` };
  const access = await json(url, "/v1/access-requests", {
    method: "POST", headers: { "content-type": "application/json", ...readHeaders },
    body: JSON.stringify({ code: pair.value.code, deviceId: device.value.deviceId, domains: ["*"] })
  });
  const listed = await json(url, `/v1/messages?code=${pair.value.code}&deviceId=${device.value.deviceId}&accessRequestId=${access.value.id}`, { headers: readHeaders });
  assert.deepEqual(listed.value.messages.map((message) => message.domain).sort(), ["first.example.com", "second.example.com"]);
});

relayTest("isolates same-domain snapshots by browser and emits websocket updates", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-sync-relay-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { relay, url } = await startRelay(directory);
  context.after(() => relay.close());
  const identity = generateKeyPair();
  const pair = await json(url, "/v1/pairs", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicKey: identity.publicKey })
  });
  const claim = () => json(url, "/v1/devices", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: pair.value.code })
  });
  const first = await claim();
  const second = await claim();
  const socketUrl = url.replace("http", "ws") + `/v1/ws?code=${pair.value.code}&token=${pair.value.readToken}`;
  const socket = new WebSocket(socketUrl);
  context.after(() => socket.close());
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  const update = new Promise((resolve) => socket.on("message", (data) => {
    const event = JSON.parse(data.toString());
    if (event.type === "cookie-update") resolve(event);
  }));
  const upload = async (device, marker) => json(url, "/v1/messages", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${device.value.uploadToken}` },
    body: JSON.stringify({ deviceId: device.value.deviceId, domain: "relay.ivjn.us", envelope: encryptFor(identity.publicKey, { domain: "relay.ivjn.us", cookies: [{ name: marker, value: marker }] }) })
  });
  await upload(first, "first");
  await upload(second, "second");
  assert.equal((await update).browserId, first.value.deviceId);
  const headers = { authorization: `Bearer ${pair.value.readToken}` };
  for (const device of [first, second]) {
    const access = await json(url, "/v1/access-requests", {
      method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ code: pair.value.code, deviceId: device.value.deviceId, domains: ["*"] })
    });
    const listed = await json(url, `/v1/messages?code=${pair.value.code}&deviceId=${device.value.deviceId}&accessRequestId=${access.value.id}`, { headers });
    assert.equal(listed.value.messages.length, 1);
    assert.equal(listed.value.messages[0].deviceId, device.value.deviceId);
  }
});

relayTest("requires browser approval when confirmation policy is enabled", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-sync-relay-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { relay, url } = await startRelay(directory);
  context.after(() => relay.close());
  const identity = generateKeyPair();
  const pair = await json(url, "/v1/pairs", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicKey: identity.publicKey })
  });
  const device = await json(url, "/v1/devices", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: pair.value.code })
  });
  const deviceHeaders = { "content-type": "application/json", authorization: `Bearer ${device.value.uploadToken}` };
  await json(url, `/v1/devices/${device.value.deviceId}/policy`, {
    method: "POST", headers: deviceHeaders, body: JSON.stringify({ accessPolicy: "confirm" })
  });
  await json(url, "/v1/messages", {
    method: "POST", headers: deviceHeaders,
    body: JSON.stringify({ deviceId: device.value.deviceId, domain: "relay.ivjn.us", envelope: encryptFor(identity.publicKey, { domain: "relay.ivjn.us", cookies: [] }) })
  });
  const cliHeaders = { "content-type": "application/json", authorization: `Bearer ${pair.value.readToken}` };
  const access = await json(url, "/v1/access-requests", {
    method: "POST", headers: cliHeaders, body: JSON.stringify({ code: pair.value.code, deviceId: device.value.deviceId, domains: ["relay.ivjn.us"] })
  });
  assert.equal(access.value.status, "pending");
  const messagePath = `/v1/messages?code=${pair.value.code}&deviceId=${device.value.deviceId}&domain=relay.ivjn.us&accessRequestId=${access.value.id}`;
  assert.equal((await json(url, messagePath, { headers: cliHeaders })).response.status, 403);
  await json(url, `/v1/device/access-requests/${access.value.id}`, {
    method: "POST", headers: deviceHeaders, body: JSON.stringify({ decision: "approved" })
  });
  assert.equal((await json(url, messagePath, { headers: cliHeaders })).response.status, 200);
});

relayTest("accepts and consumes an encrypted console import exactly once", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-sync-relay-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { relay, url } = await startRelay(directory);
  context.after(() => relay.close());
  const identity = generateKeyPair();
  const pair = await json(url, "/v1/pairs", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicKey: identity.publicKey })
  });
  const readHeaders = { "content-type": "application/json", authorization: `Bearer ${pair.value.readToken}` };
  const session = await json(url, "/v1/imports", {
    method: "POST", headers: readHeaders, body: JSON.stringify({ code: pair.value.code, domain: "relay.ivjn.us" })
  });
  assert.equal(session.response.status, 201);
  const envelope = encryptFor(identity.publicKey, { domain: "relay.ivjn.us", cookies: [{ name: "visible", value: "yes" }] });
  const uploadOptions = {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session.value.uploadToken}` }, body: JSON.stringify({ envelope })
  };
  assert.equal((await json(url, `/v1/imports/${session.value.id}`, uploadOptions)).response.status, 201);
  assert.equal((await json(url, `/v1/imports/${session.value.id}`, uploadOptions)).response.status, 409);
  const importPath = `/v1/imports/${session.value.id}?code=${pair.value.code}`;
  assert.equal((await json(url, importPath, { headers: readHeaders })).response.status, 200);
  assert.equal((await json(url, importPath, { headers: readHeaders })).response.status, 401);
});

relayTest("serves a no-store pairing page only for valid pair codes", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-sync-relay-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { relay, url } = await startRelay(directory);
  context.after(() => relay.close());
  const identity = generateKeyPair();
  const pair = await json(url, "/v1/pairs", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicKey: identity.publicKey })
  });
  const valid = await fetch(`${url}/?pair=${pair.value.code}`);
  assert.equal(valid.status, 200);
  assert.equal(valid.headers.get("cache-control"), "no-store");
  assert.match(valid.headers.get("content-security-policy"), /default-src 'none'/);
  assert.match(await valid.text(), new RegExp(pair.value.code));
  assert.equal((await fetch(`${url}/?pair=${pair.value.code}`, { method: "HEAD" })).status, 200);
  const invalid = await fetch(`${url}/?pair=INVALID`);
  assert.match(await invalid.text(), /无效或已过期/);
});

relayTest("serves a locked-down same-origin Console upload page", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-sync-relay-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { relay, url } = await startRelay(directory);
  context.after(() => relay.close());

  const response = await fetch(`${url}/console-upload`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("content-security-policy"), /connect-src 'self'/);
  assert.match(html, /history\.replaceState/);
  assert.match(html, /fetch\("\/v1\/imports\/"/);
  assert.equal(html.includes("console-import.js"), false);
});

relayTest("provides an isolated metadata-only access audit to each browser", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-sync-relay-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { relay, url } = await startRelay(directory);
  context.after(() => relay.close());
  const identity = generateKeyPair();
  const pair = await json(url, "/v1/pairs", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicKey: identity.publicKey })
  });
  const claim = () => json(url, "/v1/devices", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: pair.value.code })
  });
  const first = await claim();
  const second = await claim();
  const cliHeaders = { "content-type": "application/json", authorization: `Bearer ${pair.value.readToken}` };
  const access = await json(url, "/v1/access-requests", {
    method: "POST", headers: { ...cliHeaders, "cf-connecting-ip": "203.0.113.21" },
    body: JSON.stringify({ code: pair.value.code, deviceId: first.value.deviceId, domains: ["relay.ivjn.us"], reason: "Verify production login before deployment", client: { hostname: "automation-01", platform: "linux", architecture: "x64", cliVersion: "0.6.0" } })
  });
  const firstHeaders = { authorization: `Bearer ${first.value.uploadToken}` };
  const firstAudit = await json(url, `/v1/device/audit?deviceId=${first.value.deviceId}`, { headers: firstHeaders });
  assert.equal(firstAudit.response.status, 200);
  assert.deepEqual(firstAudit.value.events.map((event) => event.action), ["auto-approved", "requested"]);
  assert.equal(firstAudit.value.events[1].client.hostname, "automation-01");
  assert.equal(firstAudit.value.events[1].clientIp, "203.0.113.21");
  assert.equal(firstAudit.value.events[1].reason, "Verify production login before deployment");
  assert.equal(JSON.stringify(firstAudit.value).includes(pair.value.readToken), false);
  assert.equal(JSON.stringify(firstAudit.value).includes("envelope"), false);
  const secondAudit = await json(url, `/v1/device/audit?deviceId=${second.value.deviceId}`, { headers: { authorization: `Bearer ${second.value.uploadToken}` } });
  assert.deepEqual(secondAudit.value.events, []);
  const blocked = await json(url, `/v1/device/audit?deviceId=${first.value.deviceId}`, { headers: { authorization: `Bearer ${second.value.uploadToken}` } });
  assert.equal(blocked.response.status, 401);
  assert.equal(access.value.deviceId, first.value.deviceId);
});

relayTest("bounds access reasons and returns Console import reasons", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-sync-relay-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { relay, url } = await startRelay(directory);
  context.after(() => relay.close());
  const identity = generateKeyPair();
  const pair = await json(url, "/v1/pairs", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicKey: identity.publicKey })
  });
  const device = await json(url, "/v1/devices", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: pair.value.code })
  });
  const headers = { "content-type": "application/json", authorization: `Bearer ${pair.value.readToken}` };
  const reason = "x".repeat(500);
  const access = await json(url, "/v1/access-requests", {
    method: "POST", headers, body: JSON.stringify({ code: pair.value.code, deviceId: device.value.deviceId, domains: ["relay.ivjn.us"], reason })
  });
  assert.equal(access.value.reason.length, 300);
  const session = await json(url, "/v1/imports", {
    method: "POST", headers, body: JSON.stringify({ code: pair.value.code, domain: "relay.ivjn.us", reason: "Temporary migration" })
  });
  assert.equal(session.value.reason, "Temporary migration");
});

relayTest("sends authenticated open URL commands only to an online device", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-sync-relay-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { relay, url } = await startRelay(directory);
  context.after(() => relay.close());
  const identity = generateKeyPair();
  const pair = await json(url, "/v1/pairs", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicKey: identity.publicKey })
  });
  const device = await json(url, "/v1/devices", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: pair.value.code })
  });
  const other = await json(url, "/v1/devices", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: pair.value.code })
  });
  const headers = { "content-type": "application/json", authorization: `Bearer ${pair.value.readToken}` };
  const command = (input, requestHeaders = headers) => json(url, "/v1/device-commands/open", {
    method: "POST", headers: requestHeaders, body: JSON.stringify({ code: pair.value.code, deviceId: device.value.deviceId, ...input })
  });

  assert.equal((await command({ url: "https://cookie-sync.ivjn.us/" }, { "content-type": "application/json" })).response.status, 401);
  assert.equal((await command({ url: "javascript:alert(1)" })).response.status, 400);
  assert.equal((await command({ url: "https://cookie-sync.ivjn.us/" })).response.status, 409);

  const socketUrl = url.replace("http", "ws") + `/v1/device/ws?deviceId=${device.value.deviceId}&token=${device.value.uploadToken}`;
  const socket = new WebSocket(socketUrl);
  context.after(() => socket.close());
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  const otherSocketUrl = url.replace("http", "ws") + `/v1/device/ws?deviceId=${other.value.deviceId}&token=${other.value.uploadToken}`;
  const otherSocket = new WebSocket(otherSocketUrl);
  context.after(() => otherSocket.close());
  await new Promise((resolve, reject) => { otherSocket.once("open", resolve); otherSocket.once("error", reject); });
  const received = new Promise((resolve) => socket.on("message", (data) => {
    const event = JSON.parse(data.toString());
    if (event.type !== "open-url") return;
    otherSocket.send(JSON.stringify({ type: "command-result", commandId: event.commandId, ok: true }));
    setTimeout(() => socket.send(JSON.stringify({ type: "command-result", commandId: event.commandId, ok: true })), 10);
    resolve(event);
  }));
  const opened = command({ url: "https://cookie-sync.ivjn.us/#quickstart" });
  assert.equal((await opened).response.status, 200);
  assert.equal((await received).url, "https://cookie-sync.ivjn.us/#quickstart");
});
