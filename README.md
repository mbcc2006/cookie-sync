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

To wait for a person to press the extension's sync button before continuing an automation job:

```bash
cookie-sync wait github.com --timeout 300
```

The CLI runs on Windows, macOS, and Linux with Node.js 20 or newer. Install it with `npm install -g .`, then use `cookie-sync`. State is held in the native user-data directory: `$XDG_STATE_HOME/cookie-sync` (Linux), `~/Library/Application Support/cookie-sync` (macOS), or `%APPDATA%\\cookie-sync` (Windows). `browse` discovers Chrome/Chromium on each platform and injects the stored Cookie snapshot into an isolated Playwright context. Set `CHROME_PATH` when Chrome is installed elsewhere. The CLI read token is never sent to the browser extension; it authorizes only the CLI to download and delete messages.

Revoke all browsers authorized by the current pairing:

```bash
cookie-sync revoke
```

## Security limitations

- Cookies are authentication credentials. Treat the CLI machine as trusted.
- A high-entropy, 10-minute pair code authorizes a one-time browser upload. The CLI receives a separate read token that is required to retrieve the encrypted snapshot.
- After the one-time claim, the extension keeps an upload-only token in Chrome local extension storage. The relay stores only its SHA-256 hash. Use `cookie-sync revoke` if the browser or profile is lost.
- The relay persists ciphertext, not plaintext. It does not provide user accounts, device revocation, rate limiting, or audit logs yet. Use TLS and deploy it on a private network or VPN.
- Only cookies are synchronized. Local storage, IndexedDB, WebAuthn, and device-bound logins are not transferred.
- The Chrome extension must be served from an HTTPS relay in real deployments because extension requests can otherwise expose traffic on hostile networks.
