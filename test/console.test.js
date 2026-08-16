import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { consoleImportUrl } from "../src/console.js";
import { encryptFor } from "../src/crypto.js";
import { createRelay } from "../src/relay.js";

test("creates a single-line JavaScript URL for Console import", () => {
  const url = consoleImportUrl({ relay: "https://relay.ivjn.us", domain: "cookie-sync.ivjn.us", publicKey: "key", id: "id", uploadToken: "token" });

  assert.match(url, /^javascript:/);
  assert.equal(url.includes("\n"), false);
  assert.equal(url.includes("console-import.js"), false);
  assert.equal(url.includes("createElement"), false);
  assert.equal(url.includes("/console-upload#"), true);
  assert.equal(url.includes("select its top-page DevTools context"), true);
});

test("console command auto-pairs and completes from a JavaScript URL", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-sync-console-"));
  const relay = createRelay({ dataDirectory: path.join(directory, "relay") });
  await new Promise((resolve) => relay.listen(0, "127.0.0.1", resolve));
  context.after(() => {
    relay.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const relayUrl = `http://127.0.0.1:${relay.address().port}`;
  const child = spawn(process.execPath, ["src/cli.js", "console", "cookie-sync.ivjn.us"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: { ...process.env, COOKIE_SYNC_HOME: path.join(directory, "state"), COOKIE_SYNC_RELAY: relayUrl, COOKIE_SYNC_LANG: "en" }
  });
  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const importUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for Console import URL.")), 5000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const line = stdout.split("\n").find((value) => value.startsWith("javascript:"));
      if (!line) return;
      clearTimeout(timer);
      resolve(line);
    });
    child.once("error", reject);
  });
  const configMatch = importUrl.match(/const c=(\{.*?\}),b=/);
  assert.ok(configMatch);
  const config = JSON.parse(configMatch[1]);
  assert.equal(config.domain, "cookie-sync.ivjn.us");
  const upload = await fetch(`${relayUrl}/v1/imports/${config.id}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.uploadToken}` },
    body: JSON.stringify({ envelope: encryptFor(config.publicKey, { domain: config.domain, cookies: [] }) })
  });
  assert.equal(upload.status, 201);
  const exitCode = await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0, stderr);
  assert.equal(fs.existsSync(path.join(directory, "state", "pair.json")), true);
  assert.equal(stdout.match(/^javascript:/gm)?.length, 1);
});
