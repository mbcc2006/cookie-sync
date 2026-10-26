# Chrome Web Store submission kit (CookieSync 0.9.0)

Everything the Developer Dashboard asks for, in the order it asks. Keep this file, the extension behaviour and the privacy policy in agreement: the store removes items whose Privacy tab contradicts either.

- Package: `npm run pack:extension` → `dist/cookie-sync-extension-0.9.0.zip`
- Privacy policy: https://ivjn.us/cookie-sync/privacy/ (source: `ivjnus/src/privacy-cookie-sync.mjs`)
- Images: `store/images/` (rebuild with `python store/make_assets.py` after an end-to-end capture)

## 1. Package

Upload the zip. The manifest has no `key`; the store assigns the extension ID.

## 2. Store listing

| Field | Value |
|---|---|
| Category | Developer Tools |
| Language | English (default); add Chinese (Simplified), Japanese, Korean as localized listings |
| Store icon | `extension/icon.png` (128×128) |
| Screenshots (1280×800) | `images/en-1-disclosure.png`, `images/en-2-sites.png`, `images/en-3-cli.png` (Chinese listing: the `zh-*` files) |
| Small promo tile (440×280) | `images/promo-small-440x280.png` |
| Homepage URL | https://cookie-sync.ivjn.us/ |
| Support URL | https://github.com/mbcc2006/cookie-sync/issues |

### Summary (from the manifest, 122 characters)

Keep headless browsers signed in: end-to-end encrypt the cookies of sites you choose and sync them to your CookieSync CLI.

### Description — English

CookieSync keeps headless browsers and scripts on another machine signed in, without copying passwords around.

Install the extension in the Chrome profile you already use, pair it once with the CookieSync command-line tool (`npx @ivjnus/cookie-sync pair`), and choose the sites you want to share. CookieSync encrypts those sites' cookies in your browser with your CLI's public key and passes them through a relay that cannot read them. Your CLI decrypts them and hands them to Playwright, curl or yt-dlp.

• You choose the sites. Nothing is read until you allow a site; "Sync all sites" exists but is off by default and asks again before it turns on.
• End-to-end encrypted: X25519 + AES-256-GCM. Only your CLI holds the private key.
• You stay informed. Every CLI read is recorded and can require your confirmation.
• Revoke any time. Revoking deletes this browser's data on the relay.
• Open source (MIT): https://github.com/mbcc2006/cookie-sync. You can run your own relay.

Privacy policy: https://ivjn.us/cookie-sync/privacy/

### Description — 简体中文

CookieSync 让另一台机器上的无头浏览器和脚本保持登录，无需到处复制密码。

在你平时使用的 Chrome 配置文件中安装扩展，用 CookieSync 命令行工具配对一次（`npx @ivjnus/cookie-sync pair`），再选择要共享的网站。CookieSync 会在浏览器内用你的 CLI 公钥加密这些网站的 Cookie，经由无法解读内容的中继传给你的 CLI，再交给 Playwright、curl 或 yt-dlp 使用。

• 网站由你选择：在你允许之前不会读取任何网站；「同步所有网站」默认关闭，打开前会再次确认。
• 端到端加密：X25519 + AES-256-GCM，只有你的 CLI 持有私钥。
• 全程可见：CLI 每次读取都有记录，也可以设置为每次都需要你确认。
• 随时撤销：取消授权会删除中继上本浏览器的数据。
• 开源（MIT）：https://github.com/mbcc2006/cookie-sync ，也可以自建中继。

隐私政策：https://ivjn.us/cookie-sync/privacy/

### Description — 日本語

CookieSync は、パスワードをコピーして回ることなく、別のマシンのヘッドレスブラウザやスクリプトのログイン状態を保ちます。

普段使っている Chrome プロファイルに拡張機能をインストールし、CookieSync コマンドラインツールと一度ペアリング（`npx @ivjnus/cookie-sync pair`）して、共有したいサイトを選びます。CookieSync はそのサイトの Cookie をブラウザ内で CLI の公開鍵により暗号化し、内容を読めないリレーを経由して CLI に届けます。CLI が復号して Playwright、curl、yt-dlp に渡します。

• サイトはあなたが選択：許可するまで何も読み取りません。「すべてのサイトを同期」は既定で無効で、有効にする前に再確認します。
• エンドツーエンド暗号化：X25519 + AES-256-GCM。秘密鍵を持つのはあなたの CLI だけです。
• 常に把握できる：CLI による読み取りはすべて記録され、毎回の確認を必須にすることもできます。
• いつでも取り消し可能：取り消すとリレー上のこのブラウザのデータが削除されます。
• オープンソース（MIT）：https://github.com/mbcc2006/cookie-sync 。リレーを自分で運用することもできます。

プライバシーポリシー：https://ivjn.us/cookie-sync/privacy/

### Description — 한국어

CookieSync는 비밀번호를 여기저기 복사하지 않고도 다른 컴퓨터의 헤드리스 브라우저와 스크립트가 로그인 상태를 유지하게 합니다.

평소 사용하는 Chrome 프로필에 확장 프로그램을 설치하고 CookieSync 명령줄 도구와 한 번 페어링(`npx @ivjnus/cookie-sync pair`)한 뒤 공유할 사이트를 선택하세요. CookieSync는 해당 사이트의 쿠키를 브라우저에서 CLI 공개 키로 암호화하여 내용을 읽을 수 없는 릴레이를 거쳐 CLI로 전달합니다. CLI가 복호화하여 Playwright, curl, yt-dlp에 넘겨줍니다.

• 사이트는 사용자가 선택: 허용하기 전에는 아무것도 읽지 않습니다. '모든 사이트 동기화'는 기본적으로 꺼져 있으며 켜기 전에 다시 확인합니다.
• 종단 간 암호화: X25519 + AES-256-GCM. 개인 키는 CLI만 가지고 있습니다.
• 항상 확인 가능: CLI의 모든 읽기가 기록되며 매번 확인을 요구하도록 설정할 수 있습니다.
• 언제든지 취소: 취소하면 릴레이에 있는 이 브라우저의 데이터가 삭제됩니다.
• 오픈 소스(MIT): https://github.com/mbcc2006/cookie-sync . 릴레이를 직접 운영할 수도 있습니다.

개인정보 처리방침: https://ivjn.us/cookie-sync/privacy/

## 3. Privacy practices tab

### Single purpose

Sync the cookies of websites the user chooses, end-to-end encrypted, to the user's own CookieSync command-line tool so that headless browsers and scripts on another device stay signed in.

### Permission justifications

| Permission | Justification |
|---|---|
| `cookies` | Core feature: read the cookies of the sites the user allows so they can be encrypted and synced to the user's CLI, and react to cookie changes so the CLI copy stays current. |
| `storage` | Store the pairing (relay address, device ID, upload token, CLI public key), the list of allowed sites, the access policy, language and the time the user accepted the disclosure. |
| `alarms` | Re-sync allowed sites every 15 minutes and check every minute for pending CLI access requests that need the user's confirmation. |
| `notifications` | Tell the user when their CLI reads cookies, let them approve or deny reads in "Always ask" mode, and ask them to allow a site the CLI requested. |
| Host permissions (optional: `https://*/*`, `http://*/*`) | Declared as optional so nothing is granted at install. They are requested one site at a time (`https://*.example.com/*` and `http://*.example.com/*`) when the user allows a site, or all at once only if the user turns on "Sync all sites" (off by default, with a warning shown next to the switch). Chrome requires host access to read a site's cookies. |
| Content script on `https://relay.ivjn.us/*` | When the user opens the pairing link printed by their CLI, the script passes the one-time pair code to the extension so the user does not have to type it. It reads nothing else. |

### Remote code

No, I am not using remote code. All JavaScript is in the package; the extension fetches only JSON from the relay.

### Data usage

Check:

- **Authentication information** — the extension handles cookies, which include session cookies.
- **Web history** — recommended to check as well: the relay sees the domain name of each synced site, and with "Sync all sites" on that list covers every site with cookies. Over-declaring is safe; under-declaring gets items removed.

Leave unchecked: personally identifiable information, health, financial and payment, personal communications, location, user activity, website content. (Browser details such as user agent and OS version are technical data, not one of these categories.)

Certify all three:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

Privacy policy URL: https://ivjn.us/cookie-sync/privacy/

## 4. Distribution

- Visibility: start with **Unlisted** if you want to try the store build with real users before it appears in search, then switch to Public.
- Regions: all.

## 5. Test instructions for the reviewer

```
1. Install the extension. A page explaining data handling opens; tick "I understand and agree" and click "Agree and continue".
2. On any computer with Node.js 20+, run: npx @ivjnus/cookie-sync pair
   It prints a Pair URL. Open it in the browser with the extension (or copy the pair code into the extension popup) and click "Pair".
3. In the popup, under "Sites to sync", enter example.com and click "Allow". Chrome asks for access to that site only.
4. Back in the terminal: npx @ivjnus/cookie-sync pull example.com
   The CLI saves the cookies for example.com. Sites that were not allowed are not readable (try example.org).
5. "Revoke authorization" in the popup deletes the pairing and its data on the relay.
```

## 6. After the store assigns the ID

1. Add `chrome-extension://<store ID>` to the relay's `COOKIE_SYNC_ALLOWED_ORIGINS` (relay host 147.78.245.160; needs a separate go-ahead to log in).
2. Copy the public key from Dashboard → Package → "View public key" into `extension/manifest.json` as `"key"` so the unpacked development build gets the same ID. The pack script strips it from uploads.
3. Publish CLI 0.9.0 to npm so `pull` shows the "allow this site" hint.
4. Link the privacy policy from the cookie-sync.ivjn.us footer.
