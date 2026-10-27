import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSite } from "../scripts/build-site.mjs";

test("pages load self-hosted fonts for their script and never contact Google", (context) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-sync-site-"));
  context.after(() => fs.rmSync(out, { recursive: true, force: true }));
  buildSite(out);
  const page = (code) => fs.readFileSync(path.join(out, code === "en" ? "" : code, "index.html"), "utf8");
  const sheets = (code) => [...page(code).matchAll(/href="\/(fonts-[a-z]+\.css)\?v=[0-9a-f]{10}"/g)].map(([, file]) => file);

  assert.deepEqual(sheets("en"), ["fonts-mono.css", "fonts-sc.css"]);
  assert.deepEqual(sheets("zh-hant"), ["fonts-mono.css", "fonts-tc.css"]);
  assert.deepEqual(sheets("ja"), ["fonts-mono.css", "fonts-jp.css"]);
  assert.deepEqual(sheets("ko"), ["fonts-mono.css", "fonts-kr.css"]);
  for (const code of ["en", "zh", "ar"]) assert.doesNotMatch(page(code), /fonts\.(googleapis|gstatic)\.com/);
  for (const file of ["fonts-mono.css", "fonts-sc.css", "fonts-tc.css", "fonts-jp.css", "fonts-kr.css"]) {
    const css = fs.readFileSync(path.join(out, file), "utf8");
    assert.match(css, /url\(https:\/\/r2\.ivjn\.us\/cookie-sync\/fonts\/[0-9a-f]{20}\.woff2\)/, file);
    assert.doesNotMatch(css, /gstatic/, file);
  }

  const headers = fs.readFileSync(path.join(out, "_headers"), "utf8");
  assert.match(headers, /font-src https:\/\/r2\.ivjn\.us;/);
  assert.match(headers, /style-src 'self';/);
  assert.match(headers, /\/fonts-\*\n {2}Cache-Control: public, max-age=31536000, immutable/);
  assert.equal(fs.existsSync(path.join(out, "i18n.js")), false);
  assert.match(fs.readFileSync(path.join(out, "404.html"), "utf8"), /\/styles\.css\?v=[0-9a-f]{10}/);
  assert.match(fs.readFileSync(path.join(out, "sitemap.xml"), "utf8"), /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
});
