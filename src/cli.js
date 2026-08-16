#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";
import { chromium } from "playwright-core";
import WebSocket from "ws";
import { decryptFrom, generateKeyPair } from "./crypto.js";
import { chromeLaunchArgs, findChrome } from "./platform.js";
import { readJson, stateDirectory, writePrivateJson } from "./store.js";

const relay = process.env.COOKIE_SYNC_RELAY || "https://relay.ivjn.us";

function normalizeDomain(domain) {
  const value = domain?.trim().toLowerCase();
  if (!value || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value)) {
    throw new Error("Provide a valid domain such as github.com.");
  }
  return value;
}

async function request(path, options = {}) {
  const response = await fetch(`${relay}${path}`, options);
  const value = response.status === 204 ? undefined : await response.json();
  if (!response.ok) throw new Error(value?.error || `Request failed: ${response.status}`);
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
  if (!devices.length) throw new Error("No authorized browsers found.");
  if (!selector && devices.length === 1) return devices[0];
  if (!selector) throw new Error("Multiple browsers found. Use --browser <ID or alias>.");
  const matches = devices.filter((device) => device.id === selector || device.id.startsWith(selector) || device.alias === selector);
  if (matches.length !== 1) throw new Error(matches.length ? "Browser selector is ambiguous." : `Browser not found: ${selector}`);
  return matches[0];
}

async function listBrowsers() {
  const { devices } = await browsers();
  if (!devices.length) return console.log("No authorized browsers.");
  for (const device of devices) {
    const name = device.alias || "(no alias)";
    console.log(`${device.id.slice(0, 8)}  ${name}`);
    console.log(`  ${device.metadata?.browser || "Unknown browser"} / ${device.metadata?.os || device.metadata?.platform || "Unknown OS"} / ${device.metadata?.architecture || "unknown arch"}`);
    console.log(`  UA: ${device.metadata?.userAgent || "unknown"}`);
    if (device.note) console.log(`  Note: ${device.note}`);
    console.log(`  Last seen: ${new Date(device.lastSeenAt).toISOString()}`);
  }
}

async function setBrowserProfile(selector, alias, note) {
  const device = await resolveBrowser(selector);
  const { code, readToken } = pairCredentials();
  await request(`/v1/devices/${encodeURIComponent(device.id)}/profile`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${readToken}` },
    body: JSON.stringify({ code, ...(alias !== undefined ? { alias } : {}), ...(note !== undefined ? { note } : {}) })
  });
  console.log(`Updated browser ${device.id.slice(0, 8)}.`);
}

function toPlaywrightCookie(cookie) {
  const sameSite = {
    no_restriction: "None",
    lax: "Lax",
    strict: "Strict",
    unspecified: undefined
  }[cookie.sameSite];
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path || "/",
    expires: cookie.expirationDate || -1,
    httpOnly: Boolean(cookie.httpOnly),
    secure: Boolean(cookie.secure),
    ...(sameSite ? { sameSite } : {})
  };
}

async function createPair() {
  const identity = credentials();
  const pair = await request("/v1/pairs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ publicKey: identity.publicKey })
  });
  writePrivateJson("pair.json", pair);
  console.log(`Pair code: ${pair.code}`);
  console.log(`Relay: ${relay}`);
  console.log(`Expires: ${new Date(pair.expiresAt).toISOString()}`);
}

async function pull(domain, browserSelector) {
  domain = normalizeDomain(domain);
  const identity = credentials();
  const { code, readToken } = pairCredentials();
  const browser = await resolveBrowser(browserSelector);
  const message = await request(`/v1/messages?code=${encodeURIComponent(code)}&domain=${encodeURIComponent(domain)}&deviceId=${encodeURIComponent(browser.id)}`, {
    headers: { authorization: `Bearer ${readToken}` }
  });
  const snapshot = decryptFrom(identity.privateKey, message.envelope);
  if (snapshot.domain !== domain || !Array.isArray(snapshot.cookies)) throw new Error("Invalid cookie snapshot.");
  writePrivateJson(`cookies-${browser.id}-${domain}.json`, snapshot);
  await request(`/v1/messages/${encodeURIComponent(message.id)}`, {
    method: "DELETE", headers: { authorization: `Bearer ${readToken}` }
  });
  console.log(`Saved ${snapshot.cookies.length} cookies for ${domain} from ${browser.alias || browser.id.slice(0, 8)}.`);
}

async function pullAll(browserSelector) {
  const identity = credentials();
  const { code, readToken } = pairCredentials();
  const browser = await resolveBrowser(browserSelector);
  const { messages } = await request(`/v1/messages?code=${encodeURIComponent(code)}&deviceId=${encodeURIComponent(browser.id)}`, {
    headers: { authorization: `Bearer ${readToken}` }
  });
  if (!messages.length) throw new Error("No messages found.");
  for (const message of messages) {
    const snapshot = decryptFrom(identity.privateKey, message.envelope);
    const domain = normalizeDomain(snapshot.domain);
    if (!Array.isArray(snapshot.cookies)) throw new Error(`Invalid cookie snapshot for ${domain}.`);
    writePrivateJson(`cookies-${browser.id}-${domain}.json`, snapshot);
    await request(`/v1/messages/${encodeURIComponent(message.id)}`, {
      method: "DELETE", headers: { authorization: `Bearer ${readToken}` }
    });
    console.log(`Saved ${snapshot.cookies.length} cookies for ${domain} from ${browser.alias || browser.id.slice(0, 8)}.`);
  }
}

async function revoke() {
  const { code, readToken } = readJson("pair.json");
  await request(`/v1/pairs/${encodeURIComponent(code)}`, {
    method: "DELETE", headers: { authorization: `Bearer ${readToken}` }
  });
  console.log("Revoked all browser upload devices for this pairing.");
}

async function consoleImport(domain) {
  domain = normalizeDomain(domain);
  const identity = credentials();
  const { code, readToken } = pairCredentials();
  const session = await request("/v1/imports", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${readToken}` },
    body: JSON.stringify({ code, domain })
  });
  const config = { relay, id: session.id, domain, uploadToken: session.uploadToken, publicKey: session.publicKey };
  const scriptUrl = `${relay}/console-import.js#${encodeURIComponent(JSON.stringify(config))}`;
  const snippet = `const s=document.createElement('script');s.src=${JSON.stringify(scriptUrl)};document.documentElement.appendChild(s);`;
  console.log(`Open https://${domain}/, open DevTools Console, then paste this script:\n`);
  console.log(snippet);
  console.log("\nWaiting for one-time upload (non-HttpOnly cookies only)...");
  while (Date.now() < session.expiresAt) {
    try {
      const result = await request(`/v1/imports/${encodeURIComponent(session.id)}?code=${encodeURIComponent(code)}`, {
        headers: { authorization: `Bearer ${readToken}` }
      });
      const snapshot = decryptFrom(identity.privateKey, result.envelope);
      if (snapshot.domain !== domain || !Array.isArray(snapshot.cookies)) throw new Error("Invalid console cookie snapshot.");
      writePrivateJson(`cookies-console-${domain}.json`, snapshot);
      console.log(`Saved ${snapshot.cookies.length} non-HttpOnly cookies for ${domain}.`);
      return;
    } catch (error) {
      if (!error.message.includes("has not been uploaded")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error("Console import session expired.");
}

async function waitForSnapshot(domain, timeoutSeconds, browserSelector) {
  domain = normalizeDomain(domain);
  const browser = await resolveBrowser(browserSelector);
  const { code, readToken } = pairCredentials();
  const seconds = Number(timeoutSeconds || 300);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 3600) throw new Error("Timeout must be between 1 and 3600 seconds.");
  const deadline = Date.now() + seconds * 1000;
  console.log(`Waiting up to ${seconds}s for ${domain} from ${browser.alias || browser.id.slice(0, 8)}...`);
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
      await pull(domain, browser.id);
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
  throw new Error(`Timed out waiting for ${domain}.`);
}

async function browse(url, browserSelector) {
  const domain = new URL(url).hostname;
  const browserDevice = browserSelector === "console" ? null : await resolveBrowser(browserSelector);
  const snapshot = readJson(browserDevice ? `cookies-${browserDevice.id}-${domain}.json` : `cookies-console-${domain}.json`);
  const executablePath = findChrome();
  if (!executablePath || !fs.existsSync(executablePath)) throw new Error("Chrome or Chromium was not found. Set CHROME_PATH to its executable path.");
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

function status() {
  console.log(`Relay: ${relay}`);
  console.log(`State directory: ${stateDirectory()}`);
  try {
    const pair = readJson("pair.json");
    console.log(`Pair code: ${pair.code}`);
    console.log(`Pair expires: ${new Date(pair.expiresAt).toISOString()}`);
  } catch {
    console.log("Pair code: none");
  }
}

const args = process.argv.slice(2);
const [command, value] = args;
const optionValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
try {
  if (command === "pair") await createPair();
  else if (command === "console") await consoleImport(value);
  else if (command === "browsers") await listBrowsers();
  else if (command === "browser" && value === "set") await setBrowserProfile(args[2], optionValue("--alias"), optionValue("--note"));
  else if (command === "pull") await pull(value, optionValue("--browser"));
  else if (command === "pull-all") await pullAll(optionValue("--browser"));
  else if (command === "wait") await waitForSnapshot(value, optionValue("--timeout"), optionValue("--browser"));
  else if (command === "browse") await browse(value, optionValue("--browser"));
  else if (command === "revoke") await revoke();
  else if (command === "status") status();
  else throw new Error("Usage: cookie-sync <pair|console <domain>|browsers|browser set <ID> [--alias name] [--note text]|pull <domain> [--browser ID]|pull-all [--browser ID]|browse <url> [--browser ID|console]|revoke|status>");
} catch (error) {
  console.error(`cookie-sync: ${error.message}`);
  process.exitCode = 1;
}
