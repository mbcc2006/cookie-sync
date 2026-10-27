---
name: cookie-sync
description: Reuse a user's signed-in browser session in automation with the CookieSync CLI. Cookies of sites the user allowed are synced end-to-end encrypted from their Chrome to this machine and exported for Playwright, curl, wget or yt-dlp. Use when a headless browser or script must act as the user on a site they are already signed in to, or when a download needs their cookies.
---

# CookieSync

CookieSync moves login cookies from the user's own Chrome (CookieSync extension) to this machine (CookieSync CLI) so automation can reuse their session. Snapshots are encrypted in the browser with the CLI's public key; the relay at https://relay.ivjn.us cannot read them.

Run the CLI with `npx @ivjnus/cookie-sync <command>` (Node.js 20+), or `cookie-sync <command>` if it is installed globally. Examples below use `cookie-sync`.

## Ground rules

- **Cookies are credentials.** Never print cookie values, paste them into chat, logs, issues or commits, or send them anywhere except the tool that needs them. Prefer `yt-dlp` and `playwright` commands, which keep files private; delete exported files when the task is done.
- **Always pass an honest `--reason`.** The user sees it in browser notifications and in the extension's access log, and may be asked to approve each read.
- **The user decides which sites are shared.** Only sites the user allowed in the extension (or every site, if they turned on "Sync all sites") can be read. Ask the user to allow a site; never ask them to turn on "Sync all sites" just to save a step.
- **Respect a denial.** If a read is denied or times out, stop and tell the user; do not retry in a loop.

## Check the setup

```bash
cookie-sync status      # relay, state directory, pairing
cookie-sync browsers    # paired browsers: ID, alias, OS, last seen
```

If there is no pairing, ask the user to install the extension (Chrome Web Store: https://chromewebstore.google.com/detail/bijlomfalfpalpmjnlkimmoeehjpbgfn) and run:

```bash
cookie-sync pair        # prints a Pair URL; the user opens it in Chrome and clicks Pair
```

With several browsers paired, add `--browser <ID prefix or alias>` to every command that reads cookies.

## Get cookies for a site

```bash
cookie-sync pull github.com --reason "Run the nightly report as the user"
```

If it fails with `No message found`, the site is not allowed yet. Ask the user to open the extension, allow the site under "Sites to sync" (the extension may already show a notification for it), then wait for the upload:

```bash
cookie-sync wait github.com --timeout 300 --reason "Run the nightly report as the user"
```

## Use the cookies

| Goal | Command |
|---|---|
| Playwright `storageState` | `cookie-sync playwright github.com --out playwright/.auth/github.json --reason "..."` |
| curl / wget | `cookie-sync cookies github.com --format txt --out cookies.txt --reason "..."` then `curl --cookie cookies.txt https://github.com/` |
| Raw JSON | `cookie-sync cookies github.com --format json --out cookies.json --reason "..."` |
| yt-dlp | `cookie-sync yt-dlp "https://www.youtube.com/watch?v=ID" --reason "..." -- --no-playlist` (temporary cookie file, removed afterwards) |
| Quick sign-in check | `cookie-sync browse https://github.com/ --reason "..."` prints the page title from headless Chrome |
| Open a page in the user's Chrome | `cookie-sync open https://example.com/` |

Exported files contain credentials and are written owner-only; keep them out of version control (for example `playwright/.auth/` in `.gitignore`).

These commands pull a fresh snapshot when the relay has one. Right after an earlier pull the relay copy is gone, so they reuse the locally saved snapshot and print `using the one saved locally (synced ...)` on stderr; that is expected, not an error. Without `--out`, `cookies` prints only the cookies on stdout, so it can be piped.

## Troubleshooting

| Message | What to do |
|---|---|
| `No message found` | Site not allowed or not uploaded yet: ask the user to allow it, then `cookie-sync wait <domain>` |
| `No authorized browsers found` | Pair the extension: `cookie-sync pair` |
| `Relay storage is temporarily unavailable` | Relay-side outage: retry after a few seconds |
| `Multiple browsers found` | Add `--browser <ID prefix or alias>`; see `cookie-sync browsers` |
| Access denied / approval timed out | The user declined or did not answer; stop and report |
| `fetch failed` | Relay unreachable; check the network or `COOKIE_SYNC_RELAY` |

## Reference

- Website: https://cookie-sync.ivjn.us/
- Full CLI reference for agents: https://cookie-sync.ivjn.us/llms-full.txt
- Privacy policy: https://ivjn.us/cookie-sync/privacy/
- Source: https://github.com/mbcc2006/cookie-sync
- Update this skill: `cookie-sync skill --force`
