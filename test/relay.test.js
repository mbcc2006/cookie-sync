import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import WebSocket from "ws";
import { encryptFor, generateKeyPair } from "../src/crypto.js";
import { createRelay } from "../src/relay.js";

async function startRelay(directory, options = {}) {
  const relay = createRelay({ dataDirectory: directory, ...options });
  await new Promise((resolve) => relay.listen(0, "127.0.0.1", resolve));
  const { port } = relay.address();
  return { relay, url: `http://127.0.0.1:${port}` };
}

async function json(url, path, options) {
  const response = await fetch(`${url}${path}`, options);
  const value = response.status === 204 ? undefined : await response.json();
  return { response, value };
}

test("stores an encrypted message and lets only the CLI token retrieve it", async (context) => {
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

test("lets a device revoke its own authorization but not with another device's token", async (context) => {
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

test("returns a masked pair code only to its authorized device", async (context) => {
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

test("permits configured extension origins and rejects other CORS preflights", async (context) => {
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

test("keeps claimed upload devices across relay restarts", async (context) => {
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

test("rate limits pair creation by client IP", async (context) => {
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

test("isolates same-domain snapshots by browser and emits websocket updates", async (context) => {
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

test("requires browser approval when confirmation policy is enabled", async (context) => {
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

test("accepts and consumes an encrypted console import exactly once", async (context) => {
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

test("serves a no-store pairing page only for valid pair codes", async (context) => {
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

test("serves a locked-down same-origin Console upload page", async (context) => {
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

test("provides an isolated metadata-only access audit to each browser", async (context) => {
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

test("bounds access reasons and returns Console import reasons", async (context) => {
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

test("sends authenticated open URL commands only to an online device", async (context) => {
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
