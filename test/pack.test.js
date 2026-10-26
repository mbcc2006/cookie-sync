import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { packExtension, zip } from "../scripts/pack-extension.mjs";

// Read entries back through the central directory, the way the store's unzip does.
function unzip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(end + 10);
  let pos = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    const size = buffer.readUInt32LE(pos + 20);
    const nameLength = buffer.readUInt16LE(pos + 28);
    const offset = buffer.readUInt32LE(pos + 42);
    const name = buffer.toString("utf8", pos + 46, pos + 46 + nameLength);
    const local = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
    entries.set(name, zlib.inflateRawSync(buffer.subarray(local, local + size)));
    pos += 46 + nameLength;
  }
  return entries;
}

function fixture(manifest, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-sync-pack-"));
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

test("zip round-trips file contents", () => {
  const entries = unzip(zip([["a.txt", Buffer.from("hello")], ["b/c.json", Buffer.from("{}")]]));
  assert.equal(entries.get("a.txt").toString(), "hello");
  assert.equal(entries.get("b/c.json").toString(), "{}");
});

test("packs the real extension with matching version and no key", () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-sync-dist-"));
  const { out, files } = packExtension({ outDir });
  const entries = unzip(fs.readFileSync(out));
  const manifest = JSON.parse(entries.get("manifest.json"));
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url)));
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.key, undefined);
  for (const name of ["background.js", "popup.html", "welcome.html", "domains.js", "i18n.js", "icon.png"]) assert.ok(files.includes(name), name);
});

test("strips a local key and rejects version drift and missing files", () => {
  const base = { manifest_version: 3, name: "x", version: "1.0.0", description: "d", key: "LOCAL", background: { service_worker: "bg.js" } };
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-sync-dist-"));
  const ok = packExtension({ dir: fixture(base, { "bg.js": 'importScripts("lib.js");', "lib.js": "" }), outDir, version: "1.0.0" });
  assert.equal(JSON.parse(unzip(fs.readFileSync(ok.out)).get("manifest.json")).key, undefined);
  assert.throws(() => packExtension({ dir: fixture(base, { "bg.js": "", "lib.js": "" }), outDir, version: "2.0.0" }), /does not match/);
  assert.throws(() => packExtension({ dir: fixture(base, { "bg.js": 'importScripts("lib.js");' }), outDir, version: "1.0.0" }), /lib\.js/);
});
