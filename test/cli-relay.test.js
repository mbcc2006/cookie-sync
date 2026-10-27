import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { encryptFor, generateKeyPair } from "../src/crypto.js";
import { createRelay } from "../src/relay.js";

const root = path.resolve(import.meta.dirname, "..");

// The relay runs in this process, so the CLI must not block it: spawn, not spawnSync.
function cli(home, relay, ...args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["src/cli.js", ...args], {
      cwd: root, env: { ...process.env, COOKIE_SYNC_HOME: home, COOKIE_SYNC_RELAY: relay, COOKIE_SYNC_LANG: "en" }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

async function post(url, pathname, value, token) {
  const response = await fetch(`${url}${pathname}`, {
    method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(value)
  });
  return response.json();
}

test("cookies prints clean JSON and falls back to the saved snapshot once the relay copy was pulled", async (context) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-sync-cli-home-"));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-sync-cli-relay-"));
  const relay = createRelay({ dataDirectory: data, redisUrl: "" });
  await new Promise((resolve) => relay.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${relay.address().port}`;
  context.after(() => {
    relay.close();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  });

  const identity = generateKeyPair();
  fs.writeFileSync(path.join(home, "identity.json"), JSON.stringify(identity));
  const pair = await post(url, "/v1/pairs", { publicKey: identity.publicKey });
  fs.writeFileSync(path.join(home, "pair.json"), JSON.stringify(pair));
  const device = await post(url, "/v1/devices", { code: pair.code });
  const cookies = [{ name: "session", value: "abc", domain: ".example.com", path: "/", secure: true, httpOnly: true }];
  await post(url, "/v1/messages", {
    deviceId: device.deviceId, domain: "example.com",
    envelope: encryptFor(identity.publicKey, { domain: "example.com", cookies, syncedAt: "2026-10-27T00:00:00.000Z" })
  }, device.uploadToken);

  const first = await cli(home, url, "cookies", "example.com");
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(JSON.parse(first.stdout), cookies);
  assert.match(first.stderr, /Saved 1/);

  const second = await cli(home, url, "cookies", "example.com");
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(JSON.parse(second.stdout), cookies);
  assert.match(second.stderr, /saved locally \(synced 2026-10-27T00:00:00.000Z\)/);

  const unknown = await cli(home, url, "cookies", "other.example.com");
  assert.equal(unknown.status, 1);
  assert.equal(unknown.stdout, "");
  assert.match(unknown.stderr, /No message found/);
  assert.match(unknown.stderr, /allow other\.example\.com/);
});

test("wait keeps polling over HTTP when the relay refuses the WebSocket", async (context) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-sync-cli-ws-"));
  fs.writeFileSync(path.join(home, "identity.json"), JSON.stringify(generateKeyPair()));
  fs.writeFileSync(path.join(home, "pair.json"), JSON.stringify({ code: "CODE", readToken: "token", expiresAt: Date.now() + 60_000 }));
  let polls = 0;
  const server = http.createServer((request, response) => {
    const reply = (status, value) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value)); };
    const { pathname } = new URL(request.url, "http://relay");
    if (pathname === "/v1/devices") return reply(200, { devices: [{ id: "device-1", alias: "", metadata: {} }] });
    if (pathname === "/v1/access-requests") return reply(201, { id: "access-1", status: "approved", expiresAt: Date.now() + 60_000 });
    if (pathname === "/v1/messages") {
      polls += 1;
      return reply(404, { error: "No message found.", code: "no_message" });
    }
    reply(404, { error: "Not found." });
  });
  server.on("upgrade", (_request, socket) => socket.destroy());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => {
    server.close();
    fs.rmSync(home, { recursive: true, force: true });
  });

  const result = await cli(home, `http://127.0.0.1:${server.address().port}`, "wait", "example.com", "--timeout", "6");
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /Unhandled 'error' event|socket hang up/);
  assert.match(result.stderr, /^cookie-sync: /m);
  assert.ok(polls >= 2, `polled ${polls} times`);
});
