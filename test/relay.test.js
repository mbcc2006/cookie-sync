import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { encryptFor, generateKeyPair } from "../src/crypto.js";
import { createRelay } from "../src/relay.js";

async function startRelay(directory) {
  const relay = createRelay({ dataDirectory: directory });
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
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: pair.value.code })
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
