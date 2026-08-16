#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import WebSocket from "ws";
import { consoleImportUrl } from "./console.js";
import { toNetscapeCookies } from "./cookies.js";
import { decryptFrom, generateKeyPair } from "./crypto.js";
import { resolveLang, setLang, t } from "./i18n.js";
import { chromeLaunchArgs, findChrome } from "./platform.js";
import { toPlaywrightCookie, toPlaywrightStorageState } from "./playwright.js";
import { readJson, stateDirectory, writePrivateJson } from "./store.js";

const relay = process.env.COOKIE_SYNC_RELAY || "https://relay.ivjn.us";
const CLI_VERSION = "0.8.2";

function normalizeDomain(domain) {
  const value = domain?.trim().toLowerCase();
  if (!value || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value)) {
    throw new Error(t("error.invalidDomain"));
  }
  return value;
}

async function request(path, options = {}) {
  const response = await fetch(`${relay}${path}`, options);
  const value = response.status === 204 ? undefined : await response.json();
  if (!response.ok) throw new Error(value?.error || t("error.requestFailed", { status: response.status }));
  return value;
}

function credentials() {
  try {
    return readJson("identity.json");
  } catch {
    const identity = generateKeyPair();
    writePrivateJson("identity.json", identity);
    return identity;
  }
}

function pairCredentials() {
  return readJson("pair.json");
}

async function browsers() {
  const { code, readToken } = pairCredentials();
  return request(`/v1/devices?code=${encodeURIComponent(code)}`, { headers: { authorization: `Bearer ${readToken}` } });
}

async function resolveBrowser(selector) {
  const { devices } = await browsers();
  if (!devices.length) throw new Error(t("error.noBrowsers"));
  if (!selector && devices.length === 1) return devices[0];
  if (!selector) throw new Error(t("error.multipleBrowsers"));
  const matches = devices.filter((device) => device.id === selector || device.id.startsWith(selector) || device.alias === selector);
  if (matches.length !== 1) throw new Error(matches.length ? t("error.browserAmbiguous") : t("error.browserNotFound", { selector }));
  return matches[0];
}

async function listBrowsers() {
  const { devices } = await browsers();
  if (!devices.length) return console.log(t("info.noBrowsersList"));
  for (const device of devices) {
    const name = device.alias || t("label.noAlias");
    console.log(`${device.id.slice(0, 8)}  ${name}`);
    console.log(`  ${device.metadata?.browser || t("label.unknownBrowser")} / ${device.metadata?.os || device.metadata?.platform || t("label.unknownOS")} / ${device.metadata?.architecture || t("label.unknownArch")}`);
    console.log(t("label.ua", { ua: device.metadata?.userAgent || t("label.unknownUA") }));
    if (device.note) console.log(t("label.note", { note: device.note }));
    console.log(t("label.lastSeen", { time: new Date(device.lastSeenAt).toISOString() }));
  }
}

async function setBrowserProfile(selector, alias, note) {
  const device = await resolveBrowser(selector);
  const { code, readToken } = pairCredentials();
  await request(`/v1/devices/${encodeURIComponent(device.id)}/profile`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${readToken}` },
    body: JSON.stringify({ code, ...(alias !== undefined ? { alias } : {}), ...(note !== undefined ? { note } : {}) })
  });
  console.log(t("info.browserUpdated", { id: device.id.slice(0, 8) }));
}

async function requestBrowserAccess(browser, domains, reason) {
  const { code, readToken } = pairCredentials();
  const access = await request("/v1/access-requests", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${readToken}` },
    body: JSON.stringify({
      code, deviceId: browser.id, domains, reason,
      client: { hostname: os.hostname(), platform: os.platform(), release: os.release(), architecture: os.arch(), cliVersion: CLI_VERSION }
    })
  });
  if (access.status === "approved") return access.id;
  console.log(t("info.waitingApproval", { browser: browser.alias || browser.id.slice(0, 8) }));
  const wsUrl = new URL("/v1/ws", relay);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
  wsUrl.searchParams.set("code", code);
  wsUrl.searchParams.set("token", readToken);
  let wake;
  let socket;
  try {
    socket = new WebSocket(wsUrl);
    socket.on("message", (data) => {
      try {
        const event = JSON.parse(data.toString());
        if (event.type === "access-decision" && event.requestId === access.id) wake?.();
      } catch {}
    });
  } catch {}
  while (Date.now() < access.expiresAt) {
    const current = await request(`/v1/access-requests/${encodeURIComponent(access.id)}?code=${encodeURIComponent(code)}`, {
      headers: { authorization: `Bearer ${readToken}` }
    });
    if (current.status === "approved") { socket?.close(); return access.id; }
    if (current.status === "denied") { socket?.close(); throw new Error(t("error.accessDenied")); }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      wake = () => { clearTimeout(timer); resolve(); };
    });
  }
  socket?.close();
  throw new Error(t("error.approvalTimeout"));
}

async function createPairCredentials() {
  const identity = credentials();
  const pair = await request("/v1/pairs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ publicKey: identity.publicKey })
  });
  writePrivateJson("pair.json", pair);
  return pair;
}

async function createPair() {
  const pair = await createPairCredentials();
  const pairUrl = `${relay}/?pair=${encodeURIComponent(pair.code)}`;
  console.log(t("info.pairCode", { code: pair.code }));
  console.log(t("info.relay", { relay }));
  console.log(t("info.expires", { time: new Date(pair.expiresAt).toISOString() }));
  console.log(t("info.pairUrl", { url: pairUrl }));
  console.log(t("info.pairHint"));
}

async function pull(domain, browserSelector, reason) {
  domain = normalizeDomain(domain);
  reason = reason || t("reason.pull", { domain });
  const identity = credentials();
  const { code, readToken } = pairCredentials();
  const browser = await resolveBrowser(browserSelector);
  const accessRequestId = await requestBrowserAccess(browser, [domain], reason);
  const message = await request(`/v1/messages?code=${encodeURIComponent(code)}&domain=${encodeURIComponent(domain)}&deviceId=${encodeURIComponent(browser.id)}&accessRequestId=${encodeURIComponent(accessRequestId)}`, {
    headers: { authorization: `Bearer ${readToken}` }
  });
  const snapshot = decryptFrom(identity.privateKey, message.envelope);
  if (snapshot.domain !== domain || !Array.isArray(snapshot.cookies)) throw new Error(t("error.invalidSnapshot"));
  writePrivateJson(`cookies-${browser.id}-${domain}.json`, snapshot);
  await request(`/v1/messages/${encodeURIComponent(message.id)}`, {
    method: "DELETE", headers: { authorization: `Bearer ${readToken}` }
  });
  console.log(t("info.savedCookies", { count: snapshot.cookies.length, domain, browser: browser.alias || browser.id.slice(0, 8) }));
}

async function pullAll(browserSelector, reason) {
  reason = reason || t("reason.pullAll");
  const identity = credentials();
  const { code, readToken } = pairCredentials();
  const browser = await resolveBrowser(browserSelector);
  const accessRequestId = await requestBrowserAccess(browser, ["*"], reason);
  const { messages } = await request(`/v1/messages?code=${encodeURIComponent(code)}&deviceId=${encodeURIComponent(browser.id)}&accessRequestId=${encodeURIComponent(accessRequestId)}`, {
    headers: { authorization: `Bearer ${readToken}` }
  });
  if (!messages.length) throw new Error(t("error.noMessages"));
  for (const message of messages) {
    const snapshot = decryptFrom(identity.privateKey, message.envelope);
    const domain = normalizeDomain(snapshot.domain);
    if (!Array.isArray(snapshot.cookies)) throw new Error(t("error.invalidSnapshotFor", { domain }));
    writePrivateJson(`cookies-${browser.id}-${domain}.json`, snapshot);
    await request(`/v1/messages/${encodeURIComponent(message.id)}`, {
      method: "DELETE", headers: { authorization: `Bearer ${readToken}` }
    });
    console.log(t("info.savedCookies", { count: snapshot.cookies.length, domain, browser: browser.alias || browser.id.slice(0, 8) }));
  }
}

async function exportPair(outFile) {
  const identity = credentials();
  const pair = pairCredentials();
  const bundle = { relay, identity, pair };
  const json = JSON.stringify(bundle, null, 2);
  if (outFile) {
    fs.writeFileSync(outFile, `${json}\n`, { mode: 0o600 });
    console.log(t("info.exported", { file: outFile }));
  } else {
    console.log(json);
  }
  console.error(t("warn.exportSecret"));
}

async function importPair(inFile) {
  if (!inFile) throw new Error(t("error.importMissingFile"));
  const bundle = JSON.parse(fs.readFileSync(inFile, "utf8"));
  if (!bundle.identity?.privateKey || !bundle.identity?.publicKey) throw new Error(t("error.importMissingIdentity"));
  if (!bundle.pair?.code || !bundle.pair?.readToken) throw new Error(t("error.importMissingPair"));
  writePrivateJson("identity.json", bundle.identity);
  writePrivateJson("pair.json", bundle.pair);
  console.log(t("info.imported", { code: bundle.pair.code }));
  if (bundle.relay && bundle.relay !== relay) console.log(t("info.importRelayMismatch", { exportedRelay: bundle.relay, relay }));
}

async function revoke() {
  const { code, readToken } = readJson("pair.json");
  await request(`/v1/pairs/${encodeURIComponent(code)}`, {
    method: "DELETE", headers: { authorization: `Bearer ${readToken}` }
  });
  console.log(t("info.revoked"));
}

async function consoleImport(domain, reason) {
  domain = normalizeDomain(domain);
  reason = reason || t("reason.console", { domain });
  const identity = credentials();
  let pair;
  try {
    pair = pairCredentials();
  } catch {
    pair = await createPairCredentials();
  }
  const createSession = ({ code, readToken }) => request("/v1/imports", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${readToken}` },
    body: JSON.stringify({ code, domain, reason })
  });
  const session = await createSession(pair);
  const { code, readToken } = pair;
  const config = { relay, id: session.id, domain, reason: session.reason, uploadToken: session.uploadToken, publicKey: session.publicKey };
  console.log(t("info.consoleOpen", { domain }));
  console.log(consoleImportUrl(config));
  console.log(t("info.consoleReason", { reason: session.reason }));
  console.log(t("info.consoleWaiting"));
  while (Date.now() < session.expiresAt) {
    try {
      const result = await request(`/v1/imports/${encodeURIComponent(session.id)}?code=${encodeURIComponent(code)}`, {
        headers: { authorization: `Bearer ${readToken}` }
      });
      const snapshot = decryptFrom(identity.privateKey, result.envelope);
      if (snapshot.domain !== domain || !Array.isArray(snapshot.cookies)) throw new Error(t("error.invalidConsoleSnapshot"));
      writePrivateJson(`cookies-console-${domain}.json`, snapshot);
      console.log(t("info.consoleSaved", { count: snapshot.cookies.length, domain }));
      return;
    } catch (error) {
      if (!error.message.includes("has not been uploaded")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error(t("error.consoleExpired"));
}

async function waitForSnapshot(domain, timeoutSeconds, browserSelector, reason) {
  domain = normalizeDomain(domain);
  const browser = await resolveBrowser(browserSelector);
  const { code, readToken } = pairCredentials();
  const seconds = Number(timeoutSeconds || 300);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 3600) throw new Error(t("error.timeoutRange"));
  const deadline = Date.now() + seconds * 1000;
  console.log(t("info.waitingFor", { seconds, domain, browser: browser.alias || browser.id.slice(0, 8) }));
  const wsUrl = new URL("/v1/ws", relay);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
  wsUrl.searchParams.set("code", code);
  wsUrl.searchParams.set("token", readToken);
  let wake;
  let socket;
  try {
    socket = new WebSocket(wsUrl);
    socket.on("message", (data) => {
      try {
        const event = JSON.parse(data.toString());
        if (event.type === "cookie-update" && event.browserId === browser.id && event.domain === domain) wake?.();
      } catch {}
    });
  } catch {}
  while (Date.now() < deadline) {
    try {
      await pull(domain, browser.id, reason || t("reason.wait", { domain }));
      socket?.close();
      return;
    } catch (error) {
      if (!error.message.includes("No message found.")) throw error;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 5000);
        wake = () => { clearTimeout(timer); resolve(); };
      });
    }
  }
  socket?.close();
  throw new Error(t("error.waitTimeout", { domain }));
}

async function browse(url, browserSelector, reason) {
  const domain = new URL(url).hostname;
  const browserDevice = browserSelector === "console" ? null : await resolveBrowser(browserSelector);
  if (browserDevice) {
    try {
      await pull(domain, browserDevice.id, reason || t("reason.browse", { url }));
    } catch (error) {
      if (!error.message.includes("No message found")) throw error;
    }
  }
  const snapshot = readJson(browserDevice ? `cookies-${browserDevice.id}-${domain}.json` : `cookies-console-${domain}.json`);
  const executablePath = findChrome();
  if (!executablePath || !fs.existsSync(executablePath)) throw new Error(t("error.chromeNotFound"));
  const browser = await chromium.launch({ executablePath, headless: true, args: chromeLaunchArgs() });
  try {
    const context = await browser.newContext({
      ...(browserDevice?.metadata?.userAgent ? { userAgent: browserDevice.metadata.userAgent } : {}),
      ...(browserDevice?.metadata?.language ? { locale: browserDevice.metadata.language } : {})
    });
    await context.addCookies(snapshot.cookies.map(toPlaywrightCookie));
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    console.log(await page.title());
  } finally {
    await browser.close();
  }
}

async function playwright(domain, outFile, browserSelector, reason) {
  domain = normalizeDomain(domain);
  const browserDevice = browserSelector === "console" ? null : await resolveBrowser(browserSelector);
  if (browserDevice) await pull(domain, browserDevice.id, reason || t("reason.playwright", { domain }));
  const snapshot = readJson(browserDevice ? `cookies-${browserDevice.id}-${domain}.json` : `cookies-console-${domain}.json`);
  if (!Array.isArray(snapshot.cookies)) throw new Error(t("error.invalidSnapshot"));
  const file = outFile || "playwright-state.json";
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(toPlaywrightStorageState(snapshot), null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  console.log(t("info.playwrightSaved", { count: snapshot.cookies.length, file }));
}

async function exportCookies(domain, format, outFile, browserSelector, reason) {
  domain = normalizeDomain(domain);
  const browserDevice = browserSelector === "console" ? null : await resolveBrowser(browserSelector);
  if (browserDevice) await pull(domain, browserDevice.id, reason || t("reason.cookies", { domain }));
  const snapshot = readJson(browserDevice ? `cookies-${browserDevice.id}-${domain}.json` : `cookies-console-${domain}.json`);
  if (!Array.isArray(snapshot.cookies)) throw new Error(t("error.invalidSnapshot"));
  format = format || "json";
  if (!new Set(["json", "txt"]).has(format)) throw new Error(t("error.cookieFormat"));
  const output = format === "txt"
    ? toNetscapeCookies(snapshot.cookies)
    : `${JSON.stringify(snapshot.cookies, null, 2)}\n`;
  if (!outFile) return process.stdout.write(output);
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(outFile, output, { mode: 0o600 });
  fs.chmodSync(outFile, 0o600);
  console.log(t("info.cookiesSaved", { count: snapshot.cookies.length, format, file: outFile }));
}

async function ytDlp(url, executable, browserSelector, reason, domainOverride, passthroughArgs) {
  let target;
  try {
    target = new URL(url);
  } catch {
    throw new Error(t("error.invalidUrl"));
  }
  if (!["http:", "https:"].includes(target.protocol)) throw new Error(t("error.invalidUrl"));
  const domain = normalizeDomain(domainOverride || target.hostname.replace(/^www\./, ""));
  const browserDevice = browserSelector === "console" ? null : await resolveBrowser(browserSelector);
  if (browserDevice) {
    try {
      await pull(domain, browserDevice.id, reason || t("reason.ytDlp", { domain }));
    } catch (error) {
      if (!error.message.includes("No message found")) throw error;
    }
  }
  const snapshot = readJson(browserDevice ? `cookies-${browserDevice.id}-${domain}.json` : `cookies-console-${domain}.json`);
  if (!Array.isArray(snapshot.cookies)) throw new Error(t("error.invalidSnapshot"));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-sync-yt-dlp-"));
  const cookieFile = path.join(directory, "cookies.txt");
  try {
    fs.writeFileSync(cookieFile, toNetscapeCookies(snapshot.cookies), { mode: 0o600 });
    const child = spawn(executable || "yt-dlp", [...passthroughArgs, url, "--cookies", cookieFile], { stdio: "inherit" });
    const result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    if (result.signal) throw new Error(t("error.ytDlpSignal", { signal: result.signal }));
    if (result.code !== 0) throw new Error(t("error.ytDlpExit", { code: result.code }));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function open(url, browserSelector) {
  let target;
  try {
    target = new URL(url);
  } catch {
    throw new Error(t("error.invalidUrl"));
  }
  if (!["http:", "https:"].includes(target.protocol)) throw new Error(t("error.invalidUrl"));
  const browser = await resolveBrowser(browserSelector);
  const { code, readToken } = pairCredentials();
  await request("/v1/device-commands/open", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${readToken}` },
    body: JSON.stringify({ code, deviceId: browser.id, url: target.href })
  });
  console.log(t("info.openedUrl", { url: target.href, browser: browser.alias || browser.id.slice(0, 8) }));
}

function status() {
  console.log(t("info.relay", { relay }));
  console.log(t("info.stateDirectory", { dir: stateDirectory() }));
  try {
    const pair = readJson("pair.json");
    console.log(t("info.pairCode", { code: pair.code }));
    console.log(t("info.pairExpires", { time: new Date(pair.expiresAt).toISOString() }));
  } catch {
    console.log(t("info.noPairCode"));
  }
}

function langCommand(value) {
  if (!value) {
    const { lang, source } = resolveLang();
    console.log(t("info.langCurrent", { lang, source: t(`source.${source}`) }));
    return;
  }
  const applied = setLang(value);
  console.log(t("info.langSet", { lang: applied }));
}

const args = process.argv.slice(2);
const [command, value] = args;
const separator = args.indexOf("--");
const commandArgs = separator >= 0 ? args.slice(0, separator) : args;
const optionValue = (name) => {
  const index = commandArgs.indexOf(name);
  return index >= 0 ? commandArgs[index + 1] : undefined;
};
const passthroughArgs = separator >= 0 ? args.slice(separator + 1) : [];
try {
  if (command === "pair") await createPair();
  else if (command === "console") await consoleImport(value, optionValue("--reason"));
  else if (command === "browsers") await listBrowsers();
  else if (command === "browser" && value === "set") await setBrowserProfile(args[2], optionValue("--alias"), optionValue("--note"));
  else if (command === "pull") await pull(value, optionValue("--browser"), optionValue("--reason"));
  else if (command === "pull-all") await pullAll(optionValue("--browser"), optionValue("--reason"));
  else if (command === "wait") await waitForSnapshot(value, optionValue("--timeout"), optionValue("--browser"), optionValue("--reason"));
  else if (command === "browse") await browse(value, optionValue("--browser"), optionValue("--reason"));
  else if (command === "playwright") await playwright(value, optionValue("--out"), optionValue("--browser"), optionValue("--reason"));
  else if (command === "cookies") await exportCookies(value, optionValue("--format"), optionValue("--out"), optionValue("--browser"), optionValue("--reason"));
  else if (command === "yt-dlp") await ytDlp(value, optionValue("--yt-dlp"), optionValue("--browser"), optionValue("--reason"), optionValue("--domain"), passthroughArgs);
  else if (command === "open") await open(value, optionValue("--browser"));
  else if (command === "revoke") await revoke();
  else if (command === "export") await exportPair(optionValue("--out"));
  else if (command === "import") await importPair(value);
  else if (command === "lang") langCommand(value);
  else if (command === "status") status();
  else throw new Error(t("error.usage"));
} catch (error) {
  console.error(`cookie-sync: ${error.message}`);
  process.exitCode = 1;
}
