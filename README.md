# CookieSync

CookieSync transfers selected browser cookies from a Chrome extension on one device to a CLI on another device. The relay stores only encrypted message envelopes; the CLI owns the X25519 private key and is the only device able to decrypt a snapshot.

## Run the relay

The relay must be reachable by both the Chrome device and the CLI machine. Put it behind HTTPS in production. It persists encrypted messages in `./data` for up to seven days and deletes a message after a successful CLI pull.

```bash
npm install
npm start
```

Set `PORT` to change the listener port and `COOKIE_SYNC_RELAY_DATA` to change the encrypted-message directory. For a remote relay, use a reverse proxy with TLS and set `COOKIE_SYNC_RELAY=https://relay.example.com` on the CLI machine.

The default CORS policy permits every extension origin so unpacked extensions work during development. In production, set the Chrome extension ID after loading it once:

```bash
COOKIE_SYNC_ALLOWED_ORIGINS=chrome-extension://YOUR_EXTENSION_ID npm start
```

## Pair and sync

On the CLI machine:

```bash
COOKIE_SYNC_RELAY=https://relay.example.com npm run cli -- pair
```

Load `extension/` as an unpacked extension in `chrome://extensions`, enter the relay URL, pair code, and a single domain, then click the sync button. The extension asks Chrome for only that domain's cookie permission.

Fetch the encrypted snapshot on the CLI machine:

```bash
COOKIE_SYNC_RELAY=https://relay.example.com npm run cli -- pull github.com
npm run cli -- browse https://github.com/
```

To wait for a person to press the extension's sync button before continuing an automation job:

```bash
COOKIE_SYNC_RELAY=https://relay.example.com npm run cli -- wait github.com --timeout 300
```

State is held in `~/.local/share/cookie-sync` with private-file permissions. `browse` uses the installed Google Chrome binary and injects the stored Cookie snapshot into an isolated Playwright context. The CLI read token is never sent to the browser extension; it authorizes only the CLI to download and delete messages.

## Security limitations

- Cookies are authentication credentials. Treat the CLI machine as trusted.
- A high-entropy, 10-minute pair code authorizes a one-time browser upload. The CLI receives a separate read token that is required to retrieve the encrypted snapshot.
- The relay persists ciphertext, not plaintext. It does not provide user accounts, device revocation, rate limiting, or audit logs yet. Use TLS and deploy it on a private network or VPN.
- Only cookies are synchronized. Local storage, IndexedDB, WebAuthn, and device-bound logins are not transferred.
- The Chrome extension must be served from an HTTPS relay in real deployments because extension requests can otherwise expose traffic on hostile networks.
