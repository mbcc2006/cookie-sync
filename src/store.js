import fs from "node:fs";
import path from "node:path";

export function stateDirectory() {
  return process.env.COOKIE_SYNC_HOME || path.join(process.env.HOME || ".", ".local", "share", "cookie-sync");
}

export function ensureStateDirectory() {
  fs.mkdirSync(stateDirectory(), { recursive: true, mode: 0o700 });
}

export function statePath(name) {
  ensureStateDirectory();
  return path.join(stateDirectory(), name);
}

export function writePrivateJson(name, value) {
  fs.writeFileSync(statePath(name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

export function readJson(name) {
  return JSON.parse(fs.readFileSync(statePath(name), "utf8"));
}
