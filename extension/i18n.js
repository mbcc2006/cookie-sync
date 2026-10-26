(function (global) {
  const LANGS = ["en", "zh", "ja", "ko"];

  const TRANSLATIONS = {
    "label.relay": { en: "Relay URL", zh: "中继地址", ja: "リレー URL", ko: "릴레이 URL" },
    "label.pairCode": { en: "Pair code", zh: "配对码", ja: "ペアコード", ko: "페어링 코드" },
    "label.policy": { en: "CLI Cookie access", zh: "CLI 读取 Cookie", ja: "CLI による Cookie 読み取り", ko: "CLI의 쿠키 읽기" },
    "label.language": { en: "Language", zh: "语言", ja: "言語", ko: "언어" },
    "policy.notify": { en: "Allow by default, but notify me", zh: "默认允许，但通知提示", ja: "既定で許可するが通知する", ko: "기본적으로 허용하되 알림 표시" },
    "policy.confirm": { en: "Always ask for confirmation", zh: "每次都需要确认", ja: "毎回確認を必須にする", ko: "매번 확인 필요" },
    "button.sync.authorize": { "en": "Pair", "zh": "配对", "ja": "ペアリング", "ko": "페어링" },
    "button.sync.now": { "en": "Sync now", "zh": "立即同步", "ja": "今すぐ同期", "ko": "지금 동기화" },
    "button.revoke": { en: "Revoke authorization", zh: "取消授权", ja: "認可を取り消す", ko: "권한 취소" },
    "audit.title": { en: "Cookie access audit", zh: "Cookie 读取审计", ja: "Cookie アクセス監査", ko: "쿠키 접근 감사" },
    "audit.refresh": { en: "Refresh", zh: "刷新", ja: "更新", ko: "새로고침" },
    "audit.empty": { en: "No access events yet.", zh: "暂无访问记录。", ja: "アクセス記録はまだありません。", ko: "아직 접근 기록이 없습니다." },
    "audit.domainLabel": { en: "Domains: {domains}", zh: "域名：{domains}", ja: "ドメイン：{domains}", ko: "도메인: {domains}" },
    "audit.reasonLabel": { en: "Reason: {reason}", zh: "原因：{reason}", ja: "理由：{reason}", ko: "사유: {reason}" },
    "audit.noReason": { en: "No reason provided", zh: "未提供原因", ja: "理由が示されていません", ko: "사유가 제공되지 않음" },
    "status.missingFields": { en: "Relay URL and pair code are required.", zh: "需要填写中继地址和配对码。", ja: "リレー URL とペアコードの入力が必要です。", ko: "릴레이 URL과 페어링 코드가 필요합니다." },
    "status.httpsRequired": { en: "Use an HTTPS relay outside local development.", zh: "本地开发环境之外必须使用 HTTPS 中继地址。", ja: "ローカル開発以外では HTTPS のリレーを使用してください。", ko: "로컬 개발 환경이 아니면 HTTPS 릴레이를 사용하세요." },
    "status.permissionRequired": { en: "CookieSync needs relay and site permissions to keep cookies synchronized.", zh: "CookieSync 需要中继和站点权限才能持续同步 Cookie。", ja: "Cookie の同期を続けるには、リレーとサイトの権限が必要です。", ko: "쿠키를 계속 동기화하려면 릴레이 및 사이트 권한이 필요합니다." },
    "status.authorizing": { en: "Authorizing this browser...", zh: "正在授权此浏览器……", ja: "このブラウザを認可しています…", ko: "이 브라우저를 승인하는 중..." },
    "status.authorizeFailed": { en: "Authorization failed.", zh: "授权失败。", ja: "認可に失敗しました。", ko: "승인에 실패했습니다." },
    "status.authorized": { en: "Paired. Add the sites you want to sync under \"Sites to sync\".", zh: "已配对。请在「允许同步的网站」中添加要同步的网站。", ja: "ペアリングしました。「同期するサイト」に同期したいサイトを追加してください。", ko: "페어링되었습니다. '동기화할 사이트'에 동기화할 사이트를 추가하세요." },
    "status.authorizedExisting": { en: "This browser is paired. Only the sites below are synced.", zh: "此浏览器已配对，只同步下方列出的网站。", ja: "このブラウザはペアリング済みです。下のサイトのみ同期します。", ko: "이 브라우저는 페어링되었습니다. 아래 사이트만 동기화합니다." },
    "status.policyFailed": { en: "Failed to update access policy.", zh: "更新读取策略失败。", ja: "アクセスポリシーの更新に失敗しました。", ko: "접근 정책 업데이트에 실패했습니다." },
    "status.policyConfirm": { en: "The extension will ask you to confirm before every CLI read.", zh: "每次 CLI 读取前都需要你确认。", ja: "CLI が読み取るたびに確認が必要になります。", ko: "CLI가 읽을 때마다 확인이 필요합니다." },
    "status.policyNotify": { en: "CLI reads will notify you, but are allowed by default.", zh: "CLI 读取时会通知你，但默认不阻塞。", ja: "CLI の読み取りは通知されますが、既定では許可されます。", ko: "CLI 읽기는 알림이 표시되지만 기본적으로 허용됩니다." },
    "status.auditFailed": { en: "Failed to load audit log.", zh: "加载审计记录失败。", ja: "監査ログの読み込みに失敗しました。", ko: "감사 로그를 불러오지 못했습니다." },
    "status.revokeFailed": { en: "Failed to revoke authorization.", zh: "取消授权失败。", ja: "認可の取り消しに失敗しました。", ko: "권한 취소에 실패했습니다." },
    "status.revoked": { en: "Authorization revoked.", zh: "已取消授权。", ja: "認可を取り消しました。", ko: "권한이 취소되었습니다." },
    "status.errorPrefix": { en: "Error: {message}", zh: "错误：{message}", ja: "エラー：{message}", ko: "오류: {message}" },
    "event.requested": { en: "CLI requested a read", zh: "CLI 发起读取", ja: "CLI が読み取りを要求", ko: "CLI가 읽기를 요청함" },
    "event.autoApproved": { en: "Auto-approved by default", zh: "默认自动允许", ja: "既定で自動承認", ko: "기본값으로 자동 승인됨" },
    "event.approved": { en: "You allowed it", zh: "你已允许", ja: "あなたが許可しました", ko: "회원님이 허용함" },
    "event.denied": { en: "You denied it", zh: "你已拒绝", ja: "あなたが拒否しました", ko: "회원님이 거부함" },
    "event.consumed": { en: "Cookie was read", zh: "Cookie 已被读取", ja: "Cookie が読み取られました", ko: "쿠키가 읽혔습니다" },
    "event.expired": { en: "Request expired", zh: "请求已过期", ja: "リクエストの期限切れ", ko: "요청이 만료됨" },
    "notify.titleConfirm": { en: "CookieSync wants to read Cookies", zh: "CookieSync 请求读取 Cookie", ja: "CookieSync が Cookie の読み取りを要求しています", ko: "CookieSync가 쿠키 읽기를 요청합니다" },
    "notify.titleDone": { en: "CookieSync read Cookies", zh: "CookieSync 已读取 Cookie", ja: "CookieSync が Cookie を読み取りました", ko: "CookieSync가 쿠키를 읽었습니다" },
    "notify.allow": { en: "Allow", zh: "允许", ja: "許可", ko: "허용" },
    "notify.deny": { en: "Deny", zh: "拒绝", ja: "拒否", ko: "거부" },
    "error.uploadFailed": { en: "Cookie upload failed.", zh: "上传 Cookie 失败。", ja: "Cookie のアップロードに失敗しました。", ko: "쿠키 업로드에 실패했습니다." },
    "error.decisionFailed": { en: "Decision failed.", zh: "提交决定失败。", ja: "判定の送信に失敗しました。", ko: "결정 제출에 실패했습니다." },
    "consent.required": { en: "Read and accept how CookieSync handles your data before pairing.", zh: "配对前请先阅读并同意 CookieSync 的数据处理说明。", ja: "ペアリングの前に、CookieSync のデータの取り扱いを確認して同意してください。", ko: "페어링하기 전에 CookieSync의 데이터 처리 방식을 확인하고 동의해 주세요." },
    "consent.open": { en: "Open the explanation", zh: "打开说明", ja: "説明を開く", ko: "설명 열기" },
    "domains.title": { en: "Sites to sync", zh: "允许同步的网站", ja: "同期するサイト", ko: "동기화할 사이트" },
    "domains.add": { en: "Allow", zh: "允许", ja: "許可", ko: "허용" },
    "domains.remove": { en: "Remove", zh: "移除", ja: "削除", ko: "삭제" },
    "domains.empty": { en: "No sites yet. Add a site to start syncing its cookies.", zh: "还没有网站。添加网站后才会同步它的 Cookie。", ja: "まだサイトがありません。サイトを追加するとその Cookie を同期します。", ko: "아직 사이트가 없습니다. 사이트를 추가하면 해당 쿠키를 동기화합니다." },
    "domains.invalid": { en: "Enter a domain such as github.com.", zh: "请输入域名，例如 github.com。", ja: "github.com のようなドメインを入力してください。", ko: "github.com 같은 도메인을 입력하세요." },
    "domains.denied": { en: "Chrome did not grant access to {domain}.", zh: "Chrome 没有授予 {domain} 的访问权限。", ja: "Chrome は {domain} へのアクセスを許可しませんでした。", ko: "Chrome이 {domain}에 대한 접근을 허용하지 않았습니다." },
    "domains.added": { en: "{domain} is allowed and synced.", zh: "已允许 {domain} 并完成同步。", ja: "{domain} を許可して同期しました。", ko: "{domain}을(를) 허용하고 동기화했습니다." },
    "domains.removed": { en: "{domain} removed. Its cookies are no longer synced.", zh: "已移除 {domain}，不再同步它的 Cookie。", ja: "{domain} を削除しました。今後この Cookie は同期されません。", ko: "{domain}을(를) 삭제했습니다. 더 이상 쿠키를 동기화하지 않습니다." },
    "domains.requested": { en: "Your CLI asked for {domain}. Click Allow to sync it.", zh: "CLI 请求读取 {domain}，点击「允许」即可同步。", ja: "CLI が {domain} を要求しています。「許可」をクリックすると同期します。", ko: "CLI가 {domain}을(를) 요청했습니다. 허용을 누르면 동기화합니다." },
    "allSites.label": { en: "Sync all sites (not recommended)", zh: "同步所有网站（不推荐）", ja: "すべてのサイトを同期（非推奨）", ko: "모든 사이트 동기화(권장하지 않음)" },
    "allSites.warning": { en: "CookieSync will read the cookies of every site in this browser, encrypt them and upload them to the relay for your CLI. Only turn this on if you need it.", zh: "CookieSync 将读取本浏览器中所有网站的 Cookie，加密后上传到中继供你的 CLI 使用。确实需要时再打开。", ja: "CookieSync はこのブラウザのすべてのサイトの Cookie を読み取り、暗号化して CLI 用にリレーへアップロードします。必要な場合のみ有効にしてください。", ko: "CookieSync가 이 브라우저의 모든 사이트 쿠키를 읽고 암호화하여 CLI용 릴레이에 업로드합니다. 꼭 필요할 때만 켜세요." },
    "allSites.denied": { en: "Chrome did not grant access to all sites.", zh: "Chrome 没有授予所有网站的访问权限。", ja: "Chrome はすべてのサイトへのアクセスを許可しませんでした。", ko: "Chrome이 모든 사이트에 대한 접근을 허용하지 않았습니다." },
    "allSites.on": { en: "All sites are synced.", zh: "已开启同步所有网站。", ja: "すべてのサイトを同期しています。", ko: "모든 사이트를 동기화합니다." },
    "allSites.off": { en: "Only the sites in the list are synced.", zh: "已关闭，只同步列表中的网站。", ja: "リスト内のサイトのみ同期します。", ko: "목록에 있는 사이트만 동기화합니다." },
    "notify.grantTitle": { en: "Your CLI asked for a site you have not allowed", zh: "CLI 请求读取尚未允许的网站", ja: "CLI が未許可のサイトを要求しています", ko: "CLI가 허용되지 않은 사이트를 요청했습니다" },
    "notify.grantMessage": { en: "{domains}\nOpen CookieSync to allow it.", zh: "{domains}\n打开 CookieSync 进行授权。", ja: "{domains}\nCookieSync を開いて許可してください。", ko: "{domains}\nCookieSync를 열어 허용하세요." },
    "notify.grantButton": { en: "Open CookieSync", zh: "打开 CookieSync", ja: "CookieSync を開く", ko: "CookieSync 열기" },
    "link.privacy": { en: "Privacy policy", zh: "隐私政策", ja: "プライバシーポリシー", ko: "개인정보 처리방침" },
    "welcome.title": { en: "Before you pair: how CookieSync handles your data", zh: "配对前请了解：CookieSync 如何处理你的数据", ja: "ペアリングの前に：CookieSync のデータの取り扱い", ko: "페어링 전에: CookieSync의 데이터 처리 방식" },
    "welcome.intro": { en: "CookieSync copies the login cookies of sites you choose from this browser to your own CookieSync CLI on another device, so headless browsers there stay signed in.", zh: "CookieSync 会把你在本浏览器中选定网站的登录 Cookie，复制给你在另一台设备上的 CookieSync CLI，让那里的无头浏览器保持登录。", ja: "CookieSync は、このブラウザで選んだサイトのログイン Cookie を別のデバイス上のあなたの CookieSync CLI にコピーし、そこでヘッドレスブラウザのログイン状態を保ちます。", ko: "CookieSync는 이 브라우저에서 선택한 사이트의 로그인 쿠키를 다른 기기에 있는 CookieSync CLI로 복사하여 그곳의 헤드리스 브라우저가 로그인 상태를 유지하게 합니다." },
    "welcome.read": { en: "What is read: the cookies (name, value, domain, path, expiry and flags) of the sites you allow. Nothing is read until you add a site or turn on “Sync all sites”.", zh: "读取什么：你允许的网站的 Cookie（名称、值、域名、路径、过期时间和属性）。在你添加网站或打开「同步所有网站」之前，不会读取任何内容。", ja: "読み取る内容：許可したサイトの Cookie（名前、値、ドメイン、パス、有効期限、属性）。サイトを追加するか「すべてのサイトを同期」を有効にするまで、何も読み取りません。", ko: "읽는 정보: 허용한 사이트의 쿠키(이름, 값, 도메인, 경로, 만료 시간, 속성). 사이트를 추가하거나 '모든 사이트 동기화'를 켜기 전에는 아무것도 읽지 않습니다." },
    "welcome.protect": { en: "How it is protected: cookies are encrypted in this browser with your CLI's public key (X25519 + AES-256-GCM). The relay cannot decrypt them; only your CLI can.", zh: "如何保护：Cookie 在本浏览器内用你的 CLI 公钥加密（X25519 + AES-256-GCM），中继无法解密，只有你的 CLI 能解密。", ja: "保護方法：Cookie はこのブラウザ内で CLI の公開鍵により暗号化されます（X25519 + AES-256-GCM）。リレーは復号できず、復号できるのはあなたの CLI だけです。", ko: "보호 방식: 쿠키는 이 브라우저에서 CLI의 공개 키로 암호화됩니다(X25519 + AES-256-GCM). 릴레이는 복호화할 수 없고 CLI만 복호화할 수 있습니다." },
    "welcome.relay": { en: "Where it goes: encrypted data passes through relay.ivjn.us, which keeps the latest copy per site for up to 7 days and deletes it once your CLI downloads it. Browser details (user agent, platform, OS version, architecture, browser version and language) are sent unencrypted so you can tell your browsers apart. The relay also sees which site each encrypted snapshot belongs to and when it was uploaded, but never the cookies themselves.", zh: "传到哪里：加密数据经 relay.ivjn.us 中转，每个网站只保留最新一份，最多保存 7 天，CLI 下载后即删除。浏览器信息（User-Agent、平台、系统版本、架构、浏览器版本和语言）以明文发送，用于区分你的不同浏览器。中继还能看到每份加密快照属于哪个网站以及上传时间，但看不到 Cookie 本身。", ja: "送信先：暗号化データは relay.ivjn.us を経由します。サイトごとに最新の 1 件だけを最長 7 日間保存し、CLI がダウンロードすると削除します。ブラウザ情報（ユーザーエージェント、プラットフォーム、OS バージョン、アーキテクチャ、ブラウザのバージョン、言語）はブラウザを区別するため暗号化せずに送信されます。リレーは各暗号化スナップショットがどのサイトのものか、いつアップロードされたかも把握しますが、Cookie そのものは見えません。", ko: "전송 위치: 암호화된 데이터는 relay.ivjn.us를 거치며 사이트별 최신 1건만 최대 7일간 보관되고 CLI가 내려받으면 삭제됩니다. 브라우저 정보(사용자 에이전트, 플랫폼, OS 버전, 아키텍처, 브라우저 버전, 언어)는 브라우저를 구분하기 위해 암호화하지 않고 전송됩니다. 릴레이는 각 암호화 스냅샷이 어느 사이트의 것인지와 업로드 시각도 알 수 있지만 쿠키 자체는 볼 수 없습니다." },
    "welcome.audit": { en: "Access records: each time your CLI reads cookies, the relay keeps a record (sites, reason, CLI host name and IP address) for up to 90 days so you can review it in CookieSync.", zh: "访问记录：CLI 每次读取 Cookie，中继都会保存一条记录（网站、原因、CLI 主机名和 IP 地址），最多保留 90 天，可以在 CookieSync 中查看。", ja: "アクセス記録：CLI が Cookie を読み取るたびに、リレーは記録（サイト、理由、CLI のホスト名と IP アドレス）を最長 90 日間保存し、CookieSync で確認できます。", ko: "접근 기록: CLI가 쿠키를 읽을 때마다 릴레이는 기록(사이트, 사유, CLI 호스트 이름과 IP 주소)을 최대 90일간 보관하며 CookieSync에서 확인할 수 있습니다." },
    "welcome.remote": { en: "Remote actions: your paired CLI can ask this browser to open an http(s) page in a new tab.", zh: "远程操作：已配对的 CLI 可以让本浏览器在新标签页中打开一个 http(s) 网页。", ja: "リモート操作：ペアリングした CLI は、このブラウザに http(s) ページを新しいタブで開くよう要求できます。", ko: "원격 작업: 페어링된 CLI는 이 브라우저에 새 탭에서 http(s) 페이지를 열도록 요청할 수 있습니다." },
    "welcome.control": { en: "Your control: remove a site or revoke the pairing at any time in the CookieSync popup. Revoking deletes this browser's record, pending data and access records on the relay. CookieSync never sells your data or uses it for ads.", zh: "你的控制：随时可以在 CookieSync 弹窗中移除网站或取消授权。取消授权会删除中继上本浏览器的记录、待取数据和访问记录。CookieSync 不会出售你的数据，也不会用于广告。", ja: "あなたの管理：CookieSync のポップアップでいつでもサイトを削除したりペアリングを取り消したりできます。取り消すと、リレー上のこのブラウザの記録、未取得のデータ、アクセス記録が削除されます。CookieSync があなたのデータを販売したり広告に使ったりすることはありません。", ko: "사용자 제어: CookieSync 팝업에서 언제든지 사이트를 삭제하거나 페어링을 취소할 수 있습니다. 취소하면 릴레이에 있는 이 브라우저의 기록, 대기 중인 데이터, 접근 기록이 삭제됩니다. CookieSync는 데이터를 판매하거나 광고에 사용하지 않습니다." },
    "welcome.agree": { en: "I understand and agree", zh: "我已了解并同意", ja: "内容を理解し、同意します", ko: "이해했으며 동의합니다" },
    "welcome.continue": { en: "Agree and continue", zh: "同意并继续", ja: "同意して続行", ko: "동의하고 계속" },
    "welcome.done": { en: "Thanks. Click the CookieSync icon in the toolbar to pair with your CLI.", zh: "谢谢。点击工具栏中的 CookieSync 图标，与你的 CLI 配对。", ja: "ありがとうございます。ツールバーの CookieSync アイコンをクリックして CLI とペアリングしてください。", ko: "감사합니다. 툴바의 CookieSync 아이콘을 클릭해 CLI와 페어링하세요." },
    "welcome.accepted": { en: "You agreed on {date}.", zh: "你已于 {date} 同意。", ja: "{date} に同意済みです。", ko: "{date}에 동의했습니다." }
  };

  function detectLang() {
    const candidates = [];
    if (typeof navigator !== "undefined") {
      if (Array.isArray(navigator.languages)) candidates.push(...navigator.languages);
      if (navigator.language) candidates.push(navigator.language);
    }
    for (const candidate of candidates) {
      const primary = String(candidate).toLowerCase().split(/[-_]/)[0];
      if (LANGS.includes(primary)) return primary;
    }
    return "en";
  }

  function t(lang, key, params) {
    params = params || {};
    const table = TRANSLATIONS[key];
    const template = (table && (table[lang] || table.en)) || key;
    return template.replace(/\{(\w+)\}/g, (_, name) => (Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : `{${name}}`));
  }

  global.CookieSyncI18n = { LANGS, TRANSLATIONS, detectLang, t };
})(typeof self !== "undefined" ? self : this);
