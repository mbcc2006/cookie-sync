import assert from "node:assert/strict";
import test from "node:test";
import { chromeLaunchArgs, defaultStateDirectory, findChrome } from "../src/platform.js";

test("selects native state directories", () => {
  assert.equal(defaultStateDirectory({ platform: "win32", env: { APPDATA: "C:\\Users\\Me\\AppData\\Roaming" } }), "C:\\Users\\Me\\AppData\\Roaming\\cookie-sync");
  assert.equal(defaultStateDirectory({ platform: "darwin", env: {}, home: "/Users/me" }), "/Users/me/Library/Application Support/cookie-sync");
  assert.equal(defaultStateDirectory({ platform: "linux", env: { XDG_STATE_HOME: "/state" } }), "/state/cookie-sync");
});

test("finds native Chrome paths and respects CHROME_PATH", () => {
  assert.equal(findChrome({ platform: "linux", env: { CHROME_PATH: "/custom/chrome" } }), "/custom/chrome");
  assert.equal(findChrome({ platform: "darwin", env: {}, exists: (value) => value.includes("Chromium") }), "/Applications/Chromium.app/Contents/MacOS/Chromium");
  assert.equal(findChrome({ platform: "win32", env: { PROGRAMFILES: "C:\\Apps" }, exists: (value) => value.includes("C:\\Apps") }), "C:\\Apps\\Google\\Chrome\\Application\\chrome.exe");
});

test("uses no-sandbox only for root on Linux", () => {
  assert.deepEqual(chromeLaunchArgs({ platform: "linux", getuid: () => 0 }), ["--no-sandbox"]);
  assert.deepEqual(chromeLaunchArgs({ platform: "linux", getuid: () => 1000 }), []);
  assert.deepEqual(chromeLaunchArgs({ platform: "win32" }), []);
});
