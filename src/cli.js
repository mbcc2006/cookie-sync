#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";
import { chromium } from "playwright-core";
import { decryptFrom, generateKeyPair } from "./crypto.js";
import { readJson, stateDirectory, writePrivateJson } from "./store.js";

const relay = process.env.COOKIE_SYNC_RELAY || "http://127.0.0.1:8787";

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

async function pull(domain) {
  domain = normalizeDomain(domain);
  const identity = credentials();
  const { code, readToken } = readJson("pair.json");
  const message = await request(`/v1/messages?code=${encodeURIComponent(code)}&domain=${encodeURIComponent(domain)}`, {
    headers: { authorization: `Bearer ${readToken}` }
  });
  const snapshot = decryptFrom(identity.privateKey, message.envelope);
  if (snapshot.domain !== domain || !Array.isArray(snapshot.cookies)) throw new Error("Invalid cookie snapshot.");
  writePrivateJson(`cookies-${domain}.json`, snapshot);
  await request(`/v1/messages/${encodeURIComponent(message.id)}`, {
    method: "DELETE", headers: { authorization: `Bearer ${readToken}` }
  });
  console.log(`Saved ${snapshot.cookies.length} cookies for ${domain}.`);
}

async function waitForSnapshot(domain, timeoutSeconds) {
  domain = normalizeDomain(domain);
  const seconds = Number(timeoutSeconds || 300);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 3600) throw new Error("Timeout must be between 1 and 3600 seconds.");
  const deadline = Date.now() + seconds * 1000;
  console.log(`Waiting up to ${seconds}s for ${domain}...`);
  while (Date.now() < deadline) {
    try {
      await pull(domain);
      return;
    } catch (error) {
      if (!error.message.includes("No message found.")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error(`Timed out waiting for ${domain}.`);
}

async function browse(url) {
  const domain = new URL(url).hostname;
  const snapshot = readJson(`cookies-${domain}.json`);
  const executablePath = process.env.CHROME_PATH || "/usr/bin/google-chrome";
  if (!fs.existsSync(executablePath)) throw new Error(`Chrome not found at ${executablePath}. Set CHROME_PATH.`);
  const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext();
    await context.addCookies(snapshot.cookies.map(toPlaywrightCookie));
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    console.log(await page.title());
  } finally {
    await browser.close();
  }
}

function status() {
  console.log(`State directory: ${stateDirectory()}`);
  try {
    const pair = readJson("pair.json");
    console.log(`Pair code: ${pair.code}`);
    console.log(`Pair expires: ${new Date(pair.expiresAt).toISOString()}`);
  } catch {
    console.log("Pair code: none");
  }
}

const [command, value, option, optionValue] = process.argv.slice(2);
try {
  if (command === "pair") await createPair();
  else if (command === "pull") await pull(value);
  else if (command === "wait") await waitForSnapshot(value, option === "--timeout" ? optionValue : undefined);
  else if (command === "browse") await browse(value);
  else if (command === "status") status();
  else throw new Error("Usage: cookiesync <pair|pull <domain>|wait <domain> [--timeout seconds]|browse <url>|status>");
} catch (error) {
  console.error(`cookiesync: ${error.message}`);
  process.exitCode = 1;
}
