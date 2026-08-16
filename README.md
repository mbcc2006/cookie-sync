# CookieSync

CookieSync transfers selected browser cookies from a Chrome extension on one device to a CLI on another device. The relay stores only encrypted message envelopes; the CLI owns the X25519 private key and is the only device able to decrypt a snapshot.

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
cookie-sync pair
```

Load `extension/` as an unpacked extension in `chrome://extensions`, enter the relay URL and pair code, then authorize it once. Chrome asks for cookie access to all sites. The extension receives a dedicated upload-only token and continuously syncs every cookie domain on changes, browser startup, and a 15-minute fallback interval. The relay stores only the latest encrypted snapshot for each domain.

Fetch the encrypted snapshot on the CLI machine:

```bash
cookie-sync pull github.com
cookie-sync browse https://github.com/
```

Fetch every domain currently waiting on the relay:

```bash
cookie-sync pull-all
```

## Manage multiple browsers

Each authorized Chrome profile is an independent browser. Snapshots from different browsers do not overwrite one another, even for the same domain.

```bash
# Show browser ID, alias, UA, OS, architecture, and last-seen time
cookie-sync browsers

# Add an alias and operator note
cookie-sync browser set 8f31a2c0 --alias "Work laptop" --note "Primary Chrome profile"

# Select a browser by ID prefix or alias
cookie-sync pull github.com --browser "Work laptop"
cookie-sync pull-all --browser "Work laptop"
cookie-sync browse https://github.com/ --browser "Work laptop"
```

The extension reports User-Agent Client Hints when available, including browser version, operating system, platform, architecture, bitness, and language. It falls back to `navigator.userAgent` and `navigator.platform` on older Chromium versions. The `browse` command applies the selected source browser's UA and language to its isolated headless context.

To wait for a person to press the extension's sync button before continuing an automation job:

```bash
cookie-sync wait github.com --timeout 300
```

`wait` uses an authenticated WebSocket for immediate cookie-update notifications and falls back to polling if the socket disconnects. The relay can also send metadata-only Web Push notifications when VAPID keys and a push subscription are configured. Neither notification channel contains Cookie values or encrypted snapshots.

The CLI runs on Windows, macOS, and Linux with Node.js 20 or newer. Install it with `npm install -g .`, then use `cookie-sync`. State is held in the native user-data directory: `$XDG_STATE_HOME/cookie-sync` (Linux), `~/Library/Application Support/cookie-sync` (macOS), or `%APPDATA%\\cookie-sync` (Windows). `browse` discovers Chrome/Chromium on each platform and injects the stored Cookie snapshot into an isolated Playwright context. Set `CHROME_PATH` when Chrome is installed elsewhere. The CLI read token is never sent to the browser extension; it authorizes only the CLI to download and delete messages.

Revoke all browsers authorized by the current pairing:

```bash
cookie-sync revoke
```

## Security limitations

- Cookies are authentication credentials. Treat the CLI machine as trusted.
- A high-entropy, 10-minute pair code authorizes a one-time browser upload. The CLI receives a separate read token that is required to retrieve the encrypted snapshot.
- After the one-time claim, the extension keeps an upload-only token in Chrome local extension storage. The relay stores only its SHA-256 hash. Use `cookie-sync revoke` if the browser or profile is lost.
- The relay persists ciphertext, not plaintext. It does not provide user accounts or audit logs yet. Use TLS and deploy it on a private network or VPN.
- Relay endpoints are rate limited per client IP. Pair creation and browser claims use stricter limits to reduce enumeration and resource-exhaustion attacks.
- Only cookies are synchronized. Local storage, IndexedDB, WebAuthn, and device-bound logins are not transferred.
- The Chrome extension must be served from an HTTPS relay in real deployments because extension requests can otherwise expose traffic on hostile networks.
