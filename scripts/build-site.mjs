#!/usr/bin/env node
// Build cookie-sync.ivjn.us for Cloudflare Pages: one prerendered page per language plus SEO and agent files.
// Usage: npm run build:site   (output: dist-site/)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = path.join(root, "site");
const ORIGIN = "https://cookie-sync.ivjn.us";
const STORE = "https://chromewebstore.google.com/detail/bijlomfalfpalpmjnlkimmoeehjpbgfn";
const PRIVACY = "https://ivjn.us/cookie-sync/privacy/";
const GITHUB = "https://github.com/mbcc2006/cookie-sync";
const NPM = "https://www.npmjs.com/package/@ivjnus/cookie-sync";
const HREFLANG = { zh: "zh-Hans", "zh-hant": "zh-Hant" };
const OG_LOCALE = { en: "en_US", zh: "zh_CN", "zh-hant": "zh_TW", ja: "ja_JP", ko: "ko_KR", es: "es_ES", fr: "fr_FR", de: "de_DE", pt: "pt_BR", ru: "ru_RU", ar: "ar_AR", hi: "hi_IN", id: "id_ID", th: "th_TH", vi: "vi_VN", ms: "ms_MY", tr: "tr_TR", it: "it_IT", nl: "nl_NL" };

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const hreflang = (code) => HREFLANG[code] || code;
const pathFor = (code) => (code === "en" ? "/" : `/${code}/`);

function loadI18n() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(site, "i18n.js"), "utf8"), sandbox);
  return sandbox.window.CookieSyncI18n;
}

function headExtras(I, code, pkg) {
  const url = ORIGIN + pathFor(code);
  const title = I.t(code, "meta.title");
  const description = I.t(code, "meta.description");
  const alternates = I.LANGS.map((c) => `  <link rel="alternate" hreflang="${hreflang(c)}" href="${ORIGIN}${pathFor(c)}">`).join("\n");
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "CookieSync",
    url,
    description,
    inLanguage: hreflang(code),
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Chrome, Windows, macOS, Linux",
    softwareVersion: pkg.version,
    license: "https://opensource.org/licenses/MIT",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    downloadUrl: [STORE, NPM],
    softwareHelp: `${ORIGIN}/llms-full.txt`,
    sameAs: [GITHUB, NPM],
    author: { "@type": "Organization", name: "ivjn.us", url: "https://ivjn.us/" },
  };
  return `  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
  <link rel="canonical" href="${url}">
${alternates}
  <link rel="alternate" hreflang="x-default" href="${ORIGIN}/">
  <link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt">
  <link rel="sitemap" type="application/xml" href="/sitemap.xml">
  <link rel="icon" type="image/png" href="/favicon.png">
  <link rel="apple-touch-icon" href="/favicon.png">
  <meta name="theme-color" content="#13251d">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="CookieSync">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${ORIGIN}/og.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="${OG_LOCALE[code]}">
${I.LANGS.filter((c) => c !== code).map((c) => `  <meta property="og:locale:alternate" content="${OG_LOCALE[c]}">`).join("\n")}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${ORIGIN}/og.png">
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>
`;
}

// Plain links, so switching works without JavaScript and crawlers can follow every language.
function langMenu(I, code) {
  const items = I.LANGS.map((c) => `<li><a href="${pathFor(c)}" hreflang="${hreflang(c)}" lang="${hreflang(c)}"${c === code ? ' aria-current="page"' : ""}>${esc(I.NAMES[c])}</a></li>`).join("");
  return `<details class="lang-menu"><summary aria-label="Language">${esc(I.NAMES[code])}</summary><ul>${items}</ul></details>`;
}

// assets maps file name -> content hash; the query string changes whenever the file does, so stale caches cannot mix versions.
export function renderPage(template, I, code, pkg, assets = {}) {
  const expected = (template.match(/\bdata-i18n="/g) || []).length;
  let replaced = 0;
  let html = template
    .replace(/<html lang="[^"]*">/, `<html lang="${hreflang(code)}" dir="${I.RTL.includes(code) ? "rtl" : "ltr"}" data-lang="${code}">`)
    .replace(/(<meta name="description" id="meta-description" content=")[^"]*(")/, `$1${esc(I.t(code, "meta.description"))}$2`)
    .replace(/(<title id="page-title">)[^<]*(<\/title>)/, `$1${esc(I.t(code, "meta.title"))}$2`)
    .replace(/(href|src)="(styles\.css|app\.js)"/g, (_, attr, file) => `${attr}="/${file}${assets[file] ? `?v=${assets[file]}` : ""}"`)
    .replace("{{langMenu}}", langMenu(I, code))
    .replace(/data-copy="/g, `data-copied="${esc(I.t(code, "copy.copied"))}" data-copy="`)
    .replace(/(<([a-zA-Z0-9]+)\b[^>]*\bdata-i18n="([^"]+)"[^>]*>)[^<]*(<\/\2>)/g, (_, open, tag, key, close) => {
      replaced++;
      return `${open}${esc(I.t(code, key))}${close}`;
    })
    .replace(/data-i18n-aria="([^"]+)"( aria-label="[^"]*")?/g, (_, key) => `data-i18n-aria="${key}" aria-label="${esc(I.t(code, key))}"`)
    .replaceAll("{{version}}", pkg.version)
    .replace("</head>", `${headExtras(I, code, pkg)}</head>`);
  if (replaced !== expected) throw new Error(`${code}: translated ${replaced} of ${expected} data-i18n elements`);
  return html;
}

function llms(I, pkg) {
  return `# CookieSync

> CookieSync keeps headless browsers and scripts signed in. A Chrome extension end-to-end encrypts the cookies of sites the user chooses and syncs them through a relay that cannot read them to the user's own CLI, which exports them for Playwright, curl, wget or yt-dlp.

Current CLI version: ${pkg.version}. The site is published in ${I.LANGS.length} languages; English is at ${ORIGIN}/ and the others at ${ORIGIN}/<code>/.

## Get started

- [Chrome extension](${STORE}): Chrome Web Store listing (in review; until it is live, load extension/ from the repository as an unpacked extension)
- [CLI on npm](${NPM}): run with \`npx @ivjnus/cookie-sync <command>\` (Node.js 20+)
- [Quick start](${ORIGIN}/#quickstart): pair with \`npx @ivjnus/cookie-sync pair\`, allow a site in the extension, then \`npx @ivjnus/cookie-sync pull <domain>\`

## For AI agents

- [Agent skill (SKILL.md)](${ORIGIN}/skill/SKILL.md): how to use CookieSync from an agent, including the safety rules; install with \`npx @ivjnus/cookie-sync skill\`
- [Full reference](${ORIGIN}/llms-full.txt): README, every CLI command and the skill in one file

## Security and privacy

- [Privacy policy](${PRIVACY}): what is collected, where it goes and for how long
- Cookies are encrypted in the browser with X25519 + HKDF-SHA256 + AES-256-GCM using the CLI's public key; the relay stores ciphertext for at most 7 days and deletes it after the CLI pulls it
- Only sites the user allows are read; "Sync all sites" is off by default
- Every CLI read is logged in the extension and can require the user's confirmation

## Links

- [Source code (MIT)](${GITHUB})
- [Relay health](https://relay.ivjn.us/healthz)
- [Sitemap](${ORIGIN}/sitemap.xml)
`;
}

function sitemap(I) {
  const today = new Date().toISOString().slice(0, 10);
  const alts = I.LANGS.map((c) => `<xhtml:link rel="alternate" hreflang="${hreflang(c)}" href="${ORIGIN}${pathFor(c)}"/>`).join("")
    + `<xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN}/"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${I.LANGS.map((c) => `<url><loc>${ORIGIN}${pathFor(c)}</loc><lastmod>${today}</lastmod>${alts}<image:image><image:loc>${ORIGIN}/og.png</image:loc></image:image></url>`).join("\n")}
</urlset>
`;
}

const AI_AGENTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User", "anthropic-ai", "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "CCBot", "Amazonbot", "meta-externalagent", "Bytespider", "cohere-ai", "DuckAssistBot", "MistralAI-User"];
const ROBOTS = `# CookieSync: end-to-end encrypted cookie sync for headless automation.
# For language models: ${ORIGIN}/llms.txt (full reference: ${ORIGIN}/llms-full.txt, agent skill: ${ORIGIN}/skill/SKILL.md)

User-agent: *
Content-Signal: search=yes, ai-input=yes, ai-train=yes
Allow: /

${AI_AGENTS.map((a) => `User-agent: ${a}`).join("\n")}
Content-Signal: search=yes, ai-input=yes, ai-train=yes
Allow: /

Sitemap: ${ORIGIN}/sitemap.xml
`;

const HEADERS = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'

/llms.txt
  Content-Type: text/plain; charset=utf-8
  Cache-Control: public, max-age=3600
  X-Robots-Tag: noindex

/llms-full.txt
  Content-Type: text/plain; charset=utf-8
  Cache-Control: public, max-age=3600
  X-Robots-Tag: noindex

/robots.txt
  Cache-Control: public, max-age=3600

/skill/SKILL.md
  Content-Type: text/markdown; charset=utf-8
  Cache-Control: public, max-age=3600

/og.png
  Cache-Control: public, max-age=86400
`;

const NOT_FOUND = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Page not found - CookieSync</title>
  <link rel="icon" type="image/png" href="/favicon.png">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main class="wrap" style="min-height:70vh;display:flex;flex-direction:column;justify-content:center;gap:16px">
    <h1>404</h1>
    <p>This page does not exist. <a href="/" style="text-decoration:underline">Go to the CookieSync home page</a>.</p>
  </main>
</body>
</html>
`;

export function buildSite(out = path.join(root, "dist-site")) {
  const I = loadI18n();
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const template = fs.readFileSync(path.join(site, "index.html"), "utf8").replace(/\r\n/g, "\n");
  fs.rmSync(out, { recursive: true, force: true });
  const write = (rel, content) => {
    const file = path.join(out, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  const assets = Object.fromEntries(["styles.css", "app.js"].map((f) => [f, crypto.createHash("sha256").update(fs.readFileSync(path.join(site, f))).digest("hex").slice(0, 10)]));
  for (const code of I.LANGS) write(path.join(pathFor(code), "index.html"), renderPage(template, I, code, pkg, assets));
  for (const f of ["styles.css", "i18n.js", "app.js", "og.png"]) fs.copyFileSync(path.join(site, f), path.join(out, f));
  fs.copyFileSync(path.join(root, "extension", "icon.png"), path.join(out, "favicon.png"));
  const skill = fs.readFileSync(path.join(root, "skills", "cookie-sync", "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8").replace(/\r\n/g, "\n");
  write("skill/SKILL.md", skill);
  write("llms.txt", llms(I, pkg));
  write("llms-full.txt", `${llms(I, pkg)}\n---\n\n${readme}\n---\n\n# Agent skill\n\n${skill}`);
  write("sitemap.xml", sitemap(I));
  write("robots.txt", ROBOTS);
  write("_headers", HEADERS);
  write("404.html", NOT_FOUND);
  return { out, pages: I.LANGS.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { out, pages } = buildSite();
  console.log(`Built ${pages} pages into ${path.relative(root, out)}`);
}
