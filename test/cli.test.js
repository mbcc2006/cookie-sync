import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("yt-dlp passes a private temporary Cookie file and removes it", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-sync-yt-dlp-test-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const resultFile = path.join(directory, "result.json");
  const executable = path.join(directory, "fake-yt-dlp");
  fs.writeFileSync(path.join(directory, "cookies-console-youtube.com.json"), JSON.stringify({
    domain: "youtube.com",
    cookies: [{ name: "session", value: "secret", domain: ".youtube.com", path: "/", secure: true, httpOnly: true }]
  }));
  fs.writeFileSync(executable, `#!/usr/bin/env node
const fs = require("node:fs");
const index = process.argv.indexOf("--cookies");
const cookieFile = process.argv[index + 1];
fs.writeFileSync(process.env.RESULT_FILE, JSON.stringify({
  args: process.argv.slice(2), cookieFile, mode: fs.statSync(cookieFile).mode & 0o777,
  contents: fs.readFileSync(cookieFile, "utf8")
}));
`, { mode: 0o700 });

  const command = spawnSync(process.execPath, [
    "src/cli.js", "yt-dlp", "https://www.youtube.com/watch?v=test", "--browser", "console",
    "--yt-dlp", executable, "--", "--no-playlist", "--browser", "ignored-by-cookie-sync"
  ], {
    cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8",
    env: { ...process.env, COOKIE_SYNC_HOME: directory, COOKIE_SYNC_LANG: "en", RESULT_FILE: resultFile }
  });

  assert.equal(command.status, 0, command.stderr);
  const result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  assert.deepEqual(result.args.slice(0, 3), ["--no-playlist", "--browser", "ignored-by-cookie-sync"]);
  assert.equal(result.args.includes("https://www.youtube.com/watch?v=test"), true);
  assert.equal(result.mode, 0o600);
  assert.match(result.contents, /^# Netscape HTTP Cookie File/m);
  assert.match(result.contents, /#HttpOnly_\.youtube\.com/);
  assert.equal(fs.existsSync(result.cookieFile), false);
  assert.equal(fs.existsSync(path.dirname(result.cookieFile)), false);
});
