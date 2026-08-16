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

  const listed = await json(url, `/v1/messages?code=${pair.value.code}`, { headers: { authorization: `Bearer ${pair.value.readToken}` } });
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
  const fetched = await json(url, `/v1/messages?code=${pair.value.code}&domain=relay.ivjn.us`, { headers });
  assert.equal(fetched.response.status, 200);
  assert.equal(fetched.value.id, tokenUpload.value.id);

  const removed = await json(url, `/v1/messages/${tokenUpload.value.id}`, { method: "DELETE", headers });
  assert.equal(removed.response.status, 204);
  const missing = await json(url, `/v1/messages?code=${pair.value.code}&domain=relay.ivjn.us`, { headers });
  assert.equal(missing.response.status, 404);
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
  const listed = await json(url, `/v1/messages?code=${pair.value.code}`, { headers });
  assert.equal(listed.value.messages.length, 2);
  assert.deepEqual(new Set(listed.value.messages.map((message) => message.deviceId)), new Set([first.value.deviceId, second.value.deviceId]));
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
