# CookieSync

CookieSync transfers selected browser cookies from a Chrome extension on one device to a CLI on another device. The relay stores only encrypted message envelopes; the CLI owns the X25519 private key and is the only device able to decrypt a snapshot.

## Project links

- Website and usage guide: https://cookie-sync.ivjn.us
- Hosted relay and browser pairing: https://relay.ivjn.us
- Relay health check: https://relay.ivjn.us/healthz
- Source repository: https://github.com/mbcc2006/cookie-sync

The CLI and extension use the hosted relay by default. Run `npx @ivjnus/cookie-sync pair`, then open the generated `https://relay.ivjn.us/?pair=...` URL in Chrome to prefill the extension.

## Run the CLI

CookieSync requires Node.js 20 or newer. Run it directly with `npx`; no global installation is required, and state persists in the normal CookieSync state directory between runs:

```bash
npx @ivjnus/cookie-sync status
```

For frequent use, global installation remains optional:

```bash
npm install -g @ivjnus/cookie-sync
cookie-sync status
```

## Run the relay

The relay must be reachable by both the Chrome device and the CLI machine. Put it behind HTTPS in production. It persists encrypted messages in `./data` for up to seven days and deletes a message after a successful CLI pull.

```bash
npm install
npm start
```

Set `PORT` to change the listener port and `COOKIE_SYNC_RELAY_DATA` to change the encrypted-message directory. The CLI and extension default to `https://relay.ivjn.us`; set `COOKIE_SYNC_RELAY` only to use another relay.

The default CORS policy permits every extension origin so unpacked extensions work during development. In production, set the Chrome extension ID after loading it once:

```bash
COOKIE_SYNC_ALLOWED_ORIGINS=chrome-extension://YOUR_EXTENSION_ID npm start
```

## Pair and sync

On the CLI machine:

```bash
npx @ivjnus/cookie-sync pair
```

The command prints a clickable `Pair URL`, for example `https://relay.ivjn.us/?pair=...`. Open it in Chrome to validate the short-lived code, prefill the installed CookieSync extension, and attempt to open its popup. If Chrome blocks automatic popup opening, click the CookieSync toolbar icon; the pair code remains prefilled.

Load `extension/` as an unpacked extension in `chrome://extensions`, enter the relay URL and pair code, then authorize it once. Chrome asks for cookie access to all sites. The extension receives a dedicated upload-only token and continuously syncs every cookie domain on changes, browser startup, and a 15-minute fallback interval. The relay stores only the latest encrypted snapshot for each domain.

Fetch the encrypted snapshot on the CLI machine:

```bash
npx @ivjnus/cookie-sync pull github.com
npx @ivjnus/cookie-sync browse https://github.com/
```

Fetch every domain currently waiting on the relay:

```bash
npx @ivjnus/cookie-sync pull-all
```

Open a URL in the paired Chrome browser from the CLI:

```bash
npx @ivjnus/cookie-sync open https://cookie-sync.ivjn.us/
npx @ivjnus/cookie-sync open https://cookie-sync.ivjn.us/#quickstart --browser "Work laptop"
```

The target browser must be online with the extension running. Only `http://` and `https://` URLs are accepted. The relay forwards the command over the authenticated device WebSocket without storing the URL and waits for the extension to confirm that it created the tab.

Export cookies as a Playwright `storageState` file and use it in a test or config:

```bash
npx @ivjnus/cookie-sync playwright github.com --out playwright/.auth/github.json
npx playwright test --project chromium
```

```js
import { defineConfig } from "@playwright/test";

export default defineConfig({
  use: { storageState: "playwright/.auth/github.json" }
});
```

The output defaults to `playwright-state.json`. It contains authentication credentials and is written with owner-only permissions; exclude it from version control.

Export the raw Cookie array as JSON or a Netscape-compatible `cookies.txt` file for curl, wget, and other tools:

```bash
npx @ivjnus/cookie-sync cookies github.com --format json --out cookies.json
npx @ivjnus/cookie-sync cookies github.com --format txt --out cookies.txt
curl --cookie cookies.txt https://github.com/
```

Omit `--out` to print the result to stdout. The format defaults to `json`; `--browser` and `--reason` work the same way as with `pull`.

## Manage multiple browsers

Each authorized Chrome profile is an independent browser. Snapshots from different browsers do not overwrite one another, even for the same domain.

```bash
# Show browser ID, alias, UA, OS, architecture, and last-seen time
npx @ivjnus/cookie-sync browsers

# Add an alias and operator note
npx @ivjnus/cookie-sync browser set 8f31a2c0 --alias "Work laptop" --note "Primary Chrome profile"

# Select a browser by ID prefix or alias
npx @ivjnus/cookie-sync pull github.com --browser "Work laptop"
npx @ivjnus/cookie-sync pull-all --browser "Work laptop"
npx @ivjnus/cookie-sync browse https://github.com/ --browser "Work laptop"
```

The extension reports User-Agent Client Hints when available, including browser version, operating system, platform, architecture, bitness, and language. It falls back to `navigator.userAgent` and `navigator.platform` on older Chromium versions. The `browse` command applies the selected source browser's UA and language to its isolated headless context.

Each browser has an independent CLI access policy:

- `notify` (default): retrieval proceeds immediately, but the extension displays a system notification containing the requested domains.
- `confirm`: retrieval remains blocked until the extension user explicitly clicks Allow. Denied and expired requests never expose the encrypted snapshot.

Every retrieval creates a two-minute, browser- and domain-scoped access request. An approved request can be consumed only once. Change the policy from the extension popup at any time.

Cookie access commands accept an explicit operator reason. The reason appears in Chrome notifications, the browser audit log, and one-time Console import output:

```bash
npx @ivjnus/cookie-sync pull github.com --browser "Work laptop" --reason "Refresh deployment credentials"
npx @ivjnus/cookie-sync pull-all --browser "Work laptop" --reason "Nightly account verification"
npx @ivjnus/cookie-sync browse https://github.com/ --browser "Work laptop" --reason "Open profile settings for smoke test"
npx @ivjnus/cookie-sync console github.com --reason "Temporary CI migration"
```

When `--reason` is omitted, the CLI generates a contextual default such as `Launch headless browser for https://github.com/`. Reasons are plain text, trimmed to 300 characters by the relay, and do not change the request's browser or domain scope.

The extension popup also includes a per-browser Cookie access audit. It records requested domains, notify/confirm policy, approval, denial, expiration, actual consumption time, CLI hostname/platform/architecture/version, and the source IP observed by the relay. Audit events never contain Cookie names, values, encrypted envelopes, upload tokens, or CLI read tokens. Each browser can view only its own latest 100 events; the relay retains up to 500 events per browser for 90 days.

To wait for a person to press the extension's sync button before continuing an automation job:

```bash
npx @ivjnus/cookie-sync wait github.com --timeout 300
```

`wait` uses an authenticated WebSocket for immediate cookie-update notifications and falls back to polling if the socket disconnects. The relay can also send metadata-only Web Push notifications when VAPID keys and a push subscription are configured. Neither notification channel contains Cookie values or encrypted snapshots.

## One-time Console import

For a browser where the extension cannot be installed, create a five-minute, single-use import session. This command creates its own CLI pairing credentials when none exist, so a separate pair command is not required first:

```bash
npx @ivjnus/cookie-sync console github.com
```

The command prints one self-contained `javascript:` URL. Open the target site, select the top-page execution context in DevTools Console (not an extension or iframe context), paste the URL, and keep the CLI running. It verifies the current hostname and encrypts visible cookies locally, then navigates to the relay's same-origin upload page to submit the ciphertext exactly once. No external script or cross-origin request is made from the target site, so strict `script-src` and `connect-src` policies do not block the import. A domain mismatch error reports both the expected and current hostname. The CLI consumes and deletes the envelope immediately.

Use the imported snapshot with:

```bash
npx @ivjnus/cookie-sync browse https://github.com/ --browser console
```

Console JavaScript cannot access `HttpOnly` cookies, Cookie path attributes, or cookies hidden from the current page. Many authentication sessions depend on `HttpOnly`, so this is a limited fallback rather than a replacement for the extension. The self-contained URL avoids external script and cross-origin request restrictions, but a site may still disable JavaScript URLs or Console execution through browser or enterprise policy.

The CLI runs on Windows, macOS, and Linux. State is held in the native user-data directory: `$XDG_STATE_HOME/cookie-sync` (Linux), `~/Library/Application Support/cookie-sync` (macOS), or `%APPDATA%\\cookie-sync` (Windows). `browse` discovers Chrome/Chromium on each platform and injects the stored Cookie snapshot into an isolated Playwright context. Set `CHROME_PATH` when Chrome is installed elsewhere. The CLI read token is never sent to the browser extension; it authorizes only the CLI to download and delete messages.

Revoke all browsers authorized by the current pairing:

```bash
npx @ivjnus/cookie-sync revoke
```

## Reuse a pairing on another machine

To run the CLI from a second machine without pairing a new browser, export the current identity and pair credentials and import them there:

```bash
npx @ivjnus/cookie-sync export --out cookie-sync-export.json
# copy the file to the other machine over a secure channel, then:
npx @ivjnus/cookie-sync import cookie-sync-export.json
```

Omitting `--out` prints the JSON to stdout instead. The exported file contains the CLI's private key and pair read token, so it grants the same Cookie read access as the original machine — handle it like any other credential and delete it once imported.

## Security limitations

- Cookies are authentication credentials. Treat the CLI machine as trusted.
- A high-entropy, 10-minute pair code authorizes a one-time browser upload. The CLI receives a separate read token that is required to retrieve the encrypted snapshot.
- After the one-time claim, the extension keeps an upload-only token in Chrome local extension storage. The relay stores only its SHA-256 hash. Use `npx @ivjnus/cookie-sync revoke` if the browser or profile is lost.
- The relay persists ciphertext, not plaintext. It does not provide user accounts or audit logs yet. Use TLS and deploy it on a private network or VPN.
- Relay endpoints are rate limited per client IP. Pair creation and browser claims use stricter limits to reduce enumeration and resource-exhaustion attacks.
- Never paste a Console import URL from an untrusted source. The URL contains a short-lived upload capability and should navigate only to `https://relay.ivjn.us/console-upload` after encrypting the snapshot locally.
- Only cookies are synchronized. Local storage, IndexedDB, WebAuthn, and device-bound logins are not transferred.
- The Chrome extension must be served from an HTTPS relay in real deployments because extension requests can otherwise expose traffic on hostile networks.
