#!/usr/bin/env node
// Build the Chrome Web Store upload: dist/cookie-sync-extension-<version>.zip
// Usage: npm run pack:extension
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Minimal deflate zip writer; entries are [name, Buffer] with "/" separators.
export function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0x00210000, 10); // fixed 1980-01-01 timestamp keeps builds reproducible
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0x00210000, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

// Files the manifest points at, plus scripts and pages those files load.
function referencedFiles(manifest, dir) {
  const files = new Set(["manifest.json"]);
  for (const icon of Object.values(manifest.icons || {})) files.add(icon);
  if (manifest.action?.default_icon) files.add(manifest.action.default_icon);
  if (manifest.action?.default_popup) files.add(manifest.action.default_popup);
  if (manifest.background?.service_worker) files.add(manifest.background.service_worker);
  for (const script of manifest.content_scripts || []) for (const js of script.js || []) files.add(js);
  for (const file of [...files]) {
    const text = fs.existsSync(path.join(dir, file)) ? fs.readFileSync(path.join(dir, file), "utf8") : "";
    if (file.endsWith(".html")) for (const [, ref] of text.matchAll(/(?:src|href)="(?!https?:|#)([^"]+)"/g)) files.add(ref);
    if (file.endsWith(".js")) {
      for (const [, list] of text.matchAll(/importScripts\(([^)]*)\)/g)) for (const [, ref] of list.matchAll(/"([^"]+)"/g)) files.add(ref);
      for (const [, ref] of text.matchAll(/getURL\("([^"]+)"\)/g)) files.add(ref);
    }
  }
  return files;
}

export function packExtension({ dir = path.join(root, "extension"), outDir = path.join(root, "dist"), version } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const expected = version || JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  if (manifest.manifest_version !== 3) throw new Error("manifest_version must be 3.");
  if (manifest.version !== expected) throw new Error(`manifest version ${manifest.version} does not match package.json ${expected}.`);
  if ((manifest.description || "").length > 132) throw new Error("manifest description must be 132 characters or fewer.");
  const missing = [...referencedFiles(manifest, dir)].filter((file) => !fs.existsSync(path.join(dir, file)));
  if (missing.length) throw new Error(`Missing files referenced by the extension: ${missing.join(", ")}`);

  // The store assigns the ID; a local "key" (used to pin the dev ID) must not be uploaded.
  delete manifest.key;
  const entries = fs.readdirSync(dir).filter((name) => fs.statSync(path.join(dir, name)).isFile()).sort()
    .map((name) => [name, name === "manifest.json" ? Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) : fs.readFileSync(path.join(dir, name))]);
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `cookie-sync-extension-${manifest.version}.zip`);
  fs.writeFileSync(out, zip(entries));
  return { out, files: entries.map(([name]) => name) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { out, files } = packExtension();
    console.log(`Packed ${files.length} files into ${path.relative(root, out)}`);
  } catch (error) {
    console.error(`pack-extension: ${error.message}`);
    process.exitCode = 1;
  }
}
