(function (global) {
  const LANGS = ["en", "zh", "ja", "ko"];

  const TRANSLATIONS = {
    "meta.title": {
      en: "CookieSync - Authorize once, stay signed in everywhere",
      zh: "CookieSync - 一次授权，持续同步登录状态",
      ja: "CookieSync - 一度の認可で、ログイン状態を常に同期",
      ko: "CookieSync - 한 번 승인하면 로그인 상태가 계속 동기화됩니다"
    },
    "meta.description": {
      en: "CookieSync end-to-end encrypts and syncs browser cookies across devices, so a CLI or headless browser can keep reusing a signed-in session.",
      zh: "CookieSync 在不同设备间端到端加密同步浏览器 Cookie，让 CLI 和无头浏览器持续复用登录状态。",
      ja: "CookieSync はデバイス間でブラウザの Cookie を端から端まで暗号化して同期し、CLI やヘッドレスブラウザがログイン状態を使い続けられるようにします。",
      ko: "CookieSync는 기기 간 브라우저 쿠키를 종단 간 암호화하여 동기화함으로써 CLI와 헤드리스 브라우저가 로그인 상태를 계속 재사용할 수 있게 합니다."
    },
    "nav.ariaLabel": { en: "Main navigation", zh: "主导航", ja: "メインナビゲーション", ko: "주 내비게이션" },
    "nav.workflow": { en: "Workflow", zh: "工作方式", ja: "仕組み", ko: "작동 방식" },
    "nav.security": { en: "Security", zh: "安全设计", ja: "セキュリティ設計", ko: "보안 설계" },
    "nav.quickstart": { en: "Quick start", zh: "快速开始", ja: "クイックスタート", ko: "빠른 시작" },
    "hero.title1": { en: "Keep headless browsers", zh: "让无头浏览器", ja: "ヘッドレスブラウザを", ko: "헤드리스 브라우저가" },
    "hero.title2": { en: "signed in.", zh: "保持登录。", ja: "ログイン状態のままに。", ko: "로그인 상태를 유지하게." },
    "hero.lead": {
      en: "Authorize your browser once and CookieSync end-to-end encrypts cookies for every permitted domain, syncing them to a CLI and headless Chrome on another device.",
      zh: "浏览器只需授权一次，CookieSync 就会将所有允许域名的 Cookie 端到端加密，同步给另一台设备上的 CLI 和无头 Chrome。",
      ja: "ブラウザを一度認可するだけで、CookieSync は許可したすべてのドメインの Cookie を端から端まで暗号化し、別のデバイス上の CLI やヘッドレス Chrome に同期します。",
      ko: "브라우저를 한 번만 승인하면 CookieSync가 허용된 모든 도메인의 쿠키를 종단 간 암호화하여 다른 기기의 CLI와 헤드리스 Chrome에 동기화합니다."
    },
    "hero.ctaPrimary": { en: "Get started", zh: "开始配置", ja: "セットアップを始める", ko: "설정 시작하기" },
    "hero.ctaCopy": { en: "Copy install command", zh: "复制安装命令", ja: "インストールコマンドをコピー", ko: "설치 명령어 복사" },
    "terminal.ariaLabel": { en: "CookieSync terminal demo", zh: "CookieSync 终端演示", ja: "CookieSync ターミナルデモ", ko: "CookieSync 터미널 데모" },
    "terminal.relayOnline": { en: "relay online", zh: "中继在线", ja: "リレー稼働中", ko: "릴레이 온라인" },
    "terminal.pairCodeLabel": { en: "Pair code", zh: "配对码", ja: "ペアコード", ko: "페어링 코드" },
    "terminal.relayLabel": { en: "Relay", zh: "中继", ja: "リレー", ko: "릴레이" },
    "terminal.cookies14": { en: "14 cookies", zh: "14 个 Cookie", ja: "Cookie 14 件", ko: "쿠키 14개" },
    "terminal.cookies8": { en: "8 cookies", zh: "8 个 Cookie", ja: "Cookie 8 件", ko: "쿠키 8개" },
    "terminal.cookies3": { en: "3 cookies", zh: "3 个 Cookie", ja: "Cookie 3 件", ko: "쿠키 3개" },
    "stats.once": { en: "One-time authorization", zh: "只需授权一次", ja: "認可は最初の一度だけ", ko: "한 번만 승인하면 됨" },
    "stats.domains": { en: "Sync unlimited domains", zh: "同步多个域名", ja: "複数ドメインを同期", ko: "여러 도메인 동기화" },
    "stats.e2ee": { en: "Relay can't decrypt", zh: "中继无法解密", ja: "リレーは復号できない", ko: "릴레이는 복호화 불가" },
    "stats.wss": { en: "Realtime update alerts", zh: "实时更新通知", ja: "リアルタイム更新通知", ko: "실시간 업데이트 알림" },
    "workflow.title": { en: "Three steps bridge two worlds", zh: "三步连接两个世界", ja: "3 ステップで 2 つの世界をつなぐ", ko: "세 단계로 두 세계를 연결" },
    "workflow.lead": {
      en: "The desktop browser handles authentication; the remote device handles automation. CookieSync only carries the session state needed to get the job done.",
      zh: "桌面浏览器负责认证，远程设备负责自动化。CookieSync 只传递完成任务所需的登录状态。",
      ja: "デスクトップのブラウザが認証を担当し、リモートデバイスが自動化を担当します。CookieSync はタスクの遂行に必要なログイン状態だけを運びます。",
      ko: "데스크톱 브라우저가 인증을 담당하고 원격 기기가 자동화를 담당합니다. CookieSync는 작업 수행에 필요한 로그인 상태만 전달합니다."
    },
    "workflow.step1.title": { en: "CLI creates a pairing", zh: "CLI 创建配对", ja: "CLI がペアリングを作成", ko: "CLI가 페어링 생성" },
    "workflow.step1.body": {
      en: "Run the pairing command on the remote device to generate a one-time code valid for 10 minutes.",
      zh: "在无头设备运行配对命令，生成 10 分钟有效的一次性验证码。",
      ja: "リモートデバイスでペアリングコマンドを実行し、10 分間有効なワンタイムコードを生成します。",
      ko: "원격 기기에서 페어링 명령을 실행하여 10분간 유효한 1회용 코드를 생성합니다."
    },
    "workflow.step2.title": { en: "Authorize the extension once", zh: "扩展授权一次", ja: "拡張機能を一度認可", ko: "확장 프로그램을 한 번 승인" },
    "workflow.step2.body": {
      en: "Enter the code in the Chrome extension. It claims an upload-only device token that can never read data back.",
      zh: "在 Chrome 扩展输入验证码。扩展领取只能上传、不能读取的设备令牌。",
      ja: "Chrome 拡張機能にコードを入力します。拡張機能はアップロード専用のデバイストークンを取得し、データを読み返すことはできません。",
      ko: "Chrome 확장 프로그램에 코드를 입력합니다. 확장 프로그램은 업로드 전용 기기 토큰을 발급받으며, 데이터를 다시 읽을 수는 없습니다."
    },
    "workflow.step3.title": { en: "Stays synced automatically", zh: "持续自动同步", ja: "自動で同期し続ける", ko: "지속적으로 자동 동기화" },
    "workflow.step3.body": {
      en: "Cookie changes, browser launches, and scheduled jobs all trigger an encrypted sync — no repeated steps.",
      zh: "Cookie 变化、浏览器启动及定时任务都会触发加密同步，无需重复操作。",
      ja: "Cookie の変化、ブラウザの起動、定期ジョブがすべて暗号化同期のトリガーとなり、手順を繰り返す必要はありません。",
      ko: "쿠키 변경, 브라우저 실행, 예약된 작업이 모두 암호화 동기화를 트리거하므로 반복 작업이 필요 없습니다."
    },
    "security.title": { en: "The relay only ever sees ciphertext.", zh: "中继只看见密文。", ja: "リレーが目にするのは暗号文だけ。", ko: "릴레이는 암호문만 볼 수 있습니다." },
    "security.lead": {
      en: "Every snapshot is encrypted inside the browser. The CLI's X25519 private key never leaves the target device, so the relay can never recover cookie contents.",
      zh: "每个快照在浏览器中完成加密。CLI 的 X25519 私钥永不离开目标设备，中继服务无法恢复 Cookie 内容。",
      ja: "すべてのスナップショットはブラウザ内で暗号化されます。CLI の X25519 秘密鍵は対象デバイスの外に出ることがないため、リレーが Cookie の内容を復元することはできません。",
      ko: "모든 스냅샷은 브라우저 내부에서 암호화됩니다. CLI의 X25519 개인 키는 대상 기기를 벗어나지 않으므로 릴레이는 쿠키 내용을 복원할 수 없습니다."
    },
    "security.li1.strong": { en: "End-to-end encryption", zh: "端到端加密", ja: "エンドツーエンド暗号化", ko: "종단 간 암호화" },
    "security.li1.text": { en: " X25519 key agreement, HKDF, and AES-256-GCM.", zh: "X25519 密钥协商、HKDF 与 AES-256-GCM。", ja: " X25519 鍵交換、HKDF、AES-256-GCM を使用。", ko: " X25519 키 교환, HKDF, AES-256-GCM 사용." },
    "security.li2.strong": { en: "Privilege separation", zh: "权限分离", ja: "権限の分離", ko: "권한 분리" },
    "security.li2.text": { en: " The extension holds only an upload token; the CLI alone holds the read token.", zh: "扩展只有上传令牌，CLI 独占读取令牌。", ja: " 拡張機能はアップロードトークンのみ、CLI だけが読み取りトークンを保持します。", ko: " 확장 프로그램은 업로드 토큰만 가지고, CLI만 읽기 토큰을 가집니다." },
    "security.li3.strong": { en: "Instantly revocable", zh: "可立即撤销", ja: "即座に取り消し可能", ko: "즉시 취소 가능" },
    "security.li3.text": { en: " If a device is lost, one command revokes every authorized browser.", zh: "设备丢失时，一条命令撤销所有浏览器授权。", ja: " デバイスを紛失しても、コマンド一つですべての認可済みブラウザを取り消せます。", ko: " 기기를 분실해도 명령어 하나로 승인된 모든 브라우저를 취소할 수 있습니다." },
    "security.li4.strong": { en: "Multi-browser isolation", zh: "多浏览器隔离", ja: "マルチブラウザの分離", ko: "다중 브라우저 격리" },
    "security.li4.text": { en: " Aliases, notes, UA, system info, and independent cookie snapshots per browser.", zh: "支持别名、备注、UA、系统信息与独立 Cookie 快照。", ja: " エイリアス、メモ、UA、システム情報、ブラウザごとの独立した Cookie スナップショットに対応。", ko: " 별칭, 메모, UA, 시스템 정보, 브라우저별 독립적인 쿠키 스냅샷을 지원합니다." },
    "crypto.pipe1": { en: "encrypted envelope", zh: "加密信封", ja: "暗号化エンベロープ", ko: "암호화된 봉투" },
    "crypto.node2.desc": { en: "ciphertext only", zh: "仅密文", ja: "暗号文のみ", ko: "암호문만" },
    "crypto.pipe2": { en: "read token", zh: "读取令牌", ja: "読み取りトークン", ko: "읽기 토큰" },
    "crypto.node3.desc": { en: "isolated context", zh: "隔离上下文", ja: "分離されたコンテキスト", ko: "격리된 컨텍스트" },
    "features.title": { en: "More than a cookie copier", zh: "不只是复制 Cookie", ja: "単なる Cookie コピーではない", ko: "단순한 쿠키 복사 그 이상" },
    "features.lead": {
      en: "From multi-browser identity management to realtime notifications, CookieSync provides the full pipeline for long-running remote automation.",
      zh: "从浏览器身份管理到实时通知，CookieSync 为持续运行的远程自动化提供完整链路。",
      ja: "ブラウザのアイデンティティ管理からリアルタイム通知まで、CookieSync は継続稼働するリモート自動化のための一連の仕組みを提供します。",
      ko: "브라우저 아이덴티티 관리부터 실시간 알림까지, CookieSync는 지속적으로 실행되는 원격 자동화를 위한 완전한 파이프라인을 제공합니다."
    },
    "feature1.title": { en: "Multi-browser management", zh: "多浏览器管理", ja: "マルチブラウザ管理", ko: "다중 브라우저 관리" },
    "feature1.body": {
      en: "Every Chrome profile is stored independently. The CLI can view browser ID, UA, OS, architecture, and last-seen time, and set aliases and notes.",
      zh: "每个 Chrome 配置文件独立保存。CLI 可查看浏览器 ID、UA、系统、架构和最后在线时间，并设置别名与备注。",
      ja: "各 Chrome プロファイルは独立して保存されます。CLI はブラウザ ID、UA、OS、アーキテクチャ、最終確認時刻を確認し、エイリアスやメモを設定できます。",
      ko: "각 Chrome 프로필은 독립적으로 저장됩니다. CLI에서 브라우저 ID, UA, OS, 아키텍처, 마지막 접속 시간을 확인하고 별칭과 메모를 설정할 수 있습니다."
    },
    "feature2.title": { en: "Realtime WebSocket alerts", zh: "WebSocket 实时通知", ja: "WebSocket によるリアルタイム通知", ko: "WebSocket 실시간 알림" },
    "feature2.body": {
      en: "A waiting CLI wakes up the instant a cookie updates, falling back to polling if the connection drops. Web Push sends only non-sensitive update metadata.",
      zh: "Cookie 更新后立即唤醒正在等待的 CLI；连接中断时自动回退轮询。Web Push 只发送无敏感内容的更新元数据。",
      ja: "Cookie が更新されると待機中の CLI が即座に起こされ、接続が切れた場合はポーリングにフォールバックします。Web Push は機密性のない更新メタデータのみを送信します。",
      ko: "쿠키가 업데이트되면 대기 중인 CLI가 즉시 깨어나며, 연결이 끊기면 폴링으로 대체됩니다. Web Push는 민감하지 않은 업데이트 메타데이터만 전송합니다."
    },
    "feature3.title": { en: "One-time Console import", zh: "一次性 Console 导入", ja: "一度限りのコンソールインポート", ko: "1회성 콘솔 가져오기" },
    "feature3.body": {
      en: "When the extension can't be installed, create a five-minute single-use session that encrypts and imports the currently visible cookies from the page Console.",
      zh: "无法安装扩展时，创建五分钟单次会话，从页面 Console 加密导入当前可见 Cookie。",
      ja: "拡張機能をインストールできない場合、5 分間有効な一度限りのセッションを作成し、ページのコンソールから現在見えている Cookie を暗号化してインポートします。",
      ko: "확장 프로그램을 설치할 수 없을 때는 5분간 유효한 1회성 세션을 생성하여 페이지 콘솔에서 현재 보이는 쿠키를 암호화하여 가져옵니다."
    },
    "feature4.title": { en: "Rate limiting & least privilege", zh: "限流与最小权限", ja: "レート制限と最小権限", ko: "속도 제한 및 최소 권한" },
    "feature4.body": {
      en: "Pairing, device claiming, and imports each have independent rate limits; upload tokens can't read data, and the relay only stores token hashes and encrypted snapshots.",
      zh: "配对、设备认领和导入使用独立限流；上传令牌不能读取数据，中继仅保存令牌哈希与加密快照。",
      ja: "ペアリング、デバイスの取得、インポートはそれぞれ独立したレート制限を持ちます。アップロードトークンはデータを読み取れず、リレーはトークンのハッシュと暗号化されたスナップショットのみを保存します。",
      ko: "페어링, 기기 등록, 가져오기는 각각 독립적인 속도 제한이 적용됩니다. 업로드 토큰은 데이터를 읽을 수 없으며, 릴레이는 토큰 해시와 암호화된 스냅샷만 저장합니다."
    },
    "feature5.title": { en: "Notify or confirm on read", zh: "读取通知与确认", ja: "読み取り時の通知・確認", ko: "읽기 시 알림 또는 확인" },
    "feature5.body": {
      en: "CLI reads are allowed by default with a system notification, or you can require explicit approval in Chrome for every read. Approved requests can be used only once.",
      zh: "默认允许 CLI 读取但发送系统通知；也可切换为每次读取都必须在 Chrome 中明确允许。批准请求仅可使用一次。",
      ja: "既定では CLI の読み取りを許可しつつシステム通知を送信します。すべての読み取りに Chrome での明示的な承認を必須にすることもできます。承認済みリクエストは一度しか使用できません。",
      ko: "기본적으로 CLI 읽기는 허용되며 시스템 알림이 전송됩니다. 매번 Chrome에서 명시적으로 승인하도록 전환할 수도 있습니다. 승인된 요청은 한 번만 사용할 수 있습니다."
    },
    "feature6.title": { en: "Domain-scoped access", zh: "域名级访问范围", ja: "ドメイン単位のアクセス範囲", ko: "도메인 단위 접근 범위" },
    "feature6.body": {
      en: "Read requests are bound to a browser and domain for up to two minutes. Denied, expired, or already-consumed requests can never retrieve the encrypted snapshot again.",
      zh: "读取请求绑定浏览器和域名，最长两分钟。拒绝、过期或已消费的请求无法再次获得加密快照。",
      ja: "読み取りリクエストはブラウザとドメインに紐づき、最長 2 分間有効です。拒否・期限切れ・消費済みのリクエストが暗号化スナップショットを再取得することはできません。",
      ko: "읽기 요청은 브라우저와 도메인에 최대 2분간 바인딩됩니다. 거부, 만료 또는 이미 소비된 요청은 암호화된 스냅샷을 다시 가져올 수 없습니다."
    },
    "feature7.title": { en: "Browser-side access audit", zh: "浏览器端读取审计", ja: "ブラウザ側のアクセス監査", ko: "브라우저 측 접근 감사" },
    "feature7.body": {
      en: "The extension can view requests, approvals, denials, expirations, and actual consumption, plus CLI host, system, and source IP. The audit never contains cookie data.",
      zh: "扩展可查看请求、批准、拒绝、过期和实际消费记录，以及 CLI 主机、系统和来源 IP。审计不包含 Cookie 数据。",
      ja: "拡張機能ではリクエスト、承認、拒否、期限切れ、実際の消費記録に加え、CLI のホスト名・システム情報・送信元 IP を確認できます。監査ログに Cookie データは含まれません。",
      ko: "확장 프로그램에서 요청, 승인, 거부, 만료, 실제 소비 기록과 함께 CLI 호스트, 시스템, 발신 IP를 확인할 수 있습니다. 감사 기록에는 쿠키 데이터가 포함되지 않습니다."
    },
    "feature8.title": { en: "A reason for every read", zh: "每次读取说明用途", ja: "読み取りごとに理由を明示", ko: "읽을 때마다 사유 명시" },
    "feature8.body": {
      en: "The CLI can explain why it needs cookies via --reason. The reason shows up in Chrome notifications, the audit log, and one-time Console import output.",
      zh: "CLI 可通过 --reason 说明为什么需要 Cookie。原因会显示在 Chrome 通知、审计记录和一次性 Console 导入输出中。",
      ja: "CLI は --reason で Cookie が必要な理由を説明できます。理由は Chrome の通知、監査ログ、一度限りのコンソールインポート出力に表示されます。",
      ko: "CLI는 --reason으로 쿠키가 필요한 이유를 설명할 수 있습니다. 사유는 Chrome 알림, 감사 로그, 1회성 콘솔 가져오기 출력에 표시됩니다."
    },
    "quickstart.title": { en: "Start syncing now", zh: "现在开始同步", ja: "今すぐ同期を始める", ko: "지금 동기화 시작하기" },
    "tabs.install": { en: "Install", zh: "安装", ja: "インストール", ko: "설치" },
    "tabs.pair": { en: "Pair", zh: "配对", ja: "ペアリング", ko: "페어링" },
    "tabs.use": { en: "Use", zh: "使用", ja: "使用", ko: "사용" },
    "tabs.revoke": { en: "Revoke", zh: "撤销", ja: "取り消し", ko: "취소" },
    "copy.button": { en: "Copy", zh: "复制", ja: "コピー", ko: "복사" },
    "copy.copied": { en: "Copied", zh: "已复制", ja: "コピーしました", ko: "복사됨" },
    "qs.install.c1": { en: "# Requires Node.js 20+", zh: "# 需要 Node.js 20+", ja: "# Node.js 20 以上が必要", ko: "# Node.js 20 이상 필요" },
    "qs.install.c2": { en: "# Check the default relay and data directory", zh: "# 检查默认 relay 和数据目录", ja: "# デフォルトのリレーとデータディレクトリを確認", ko: "# 기본 릴레이와 데이터 디렉터리 확인" },
    "qs.pair.c1": { en: "# Create a ten-minute pairing code", zh: "# 创建十分钟有效的配对码", ja: "# 10 分間有効なペアコードを作成", ko: "# 10분간 유효한 페어링 코드 생성" },
    "qs.pair.c2": { en: "# Enter the pairing code in the Chrome extension and authorize once", zh: "# 在 Chrome 扩展中输入配对码并授权一次", ja: "# Chrome 拡張機能にペアコードを入力し、一度認可", ko: "# Chrome 확장 프로그램에 페어링 코드를 입력하고 한 번 승인" },
    "qs.pair.c3": { en: "# Future cookie changes sync automatically, encrypted", zh: "# 后续 Cookie 变化会自动加密同步", ja: "# 以降の Cookie の変化は暗号化されて自動同期", ko: "# 이후 쿠키 변경은 암호화되어 자동 동기화됨" },
    "qs.use.c1": { en: "# View browser identity, UA, and system info", zh: "# 查看浏览器身份、UA 和系统信息", ja: "# ブラウザのアイデンティティ、UA、システム情報を確認", ko: "# 브라우저 아이덴티티, UA, 시스템 정보 확인" },
    "qs.use.c2": { en: "# Set an alias for a browser", zh: "# 为浏览器设置别名", ja: "# ブラウザにエイリアスを設定", ko: "# 브라우저에 별칭 설정" },
    "qs.use.c3": { en: "# Pull and use cookies from a specific browser", zh: "# 拉取并使用指定浏览器的 Cookie", ja: "# 特定のブラウザの Cookie を取得して使用", ko: "# 특정 브라우저의 쿠키를 가져와 사용" },
    "qs.console.c1": { en: "# Create a five-minute single-use import and print the Console script", zh: "# 创建五分钟一次性导入并打印 Console 脚本", ja: "# 5 分間有効な一度限りのインポートを作成し、コンソールスクリプトを出力", ko: "# 5분간 유효한 1회성 가져오기를 생성하고 콘솔 스크립트 출력" },
    "qs.console.c2": { en: "# Only page-visible, non-HttpOnly cookies are supported", zh: "# 仅支持页面可见的非 HttpOnly Cookie", ja: "# ページ上に見える HttpOnly 以外の Cookie のみ対応", ko: "# 페이지에 보이는 HttpOnly가 아닌 쿠키만 지원" },
    "qs.revoke.c1": { en: "# Revoke every browser and live subscription under this pairing", zh: "# 撤销当前配对下的所有浏览器和实时订阅", ja: "# このペアリングに属するすべてのブラウザとライブ購読を取り消し", ko: "# 이 페어링에 속한 모든 브라우저와 실시간 구독 취소" },
    "qs.revoke.c2": { en: "# Run this immediately if a browser is lost or an authorization leaks", zh: "# 浏览器丢失或授权泄漏时立即执行", ja: "# ブラウザを紛失した、または認可が漏洩した場合は直ちに実行", ko: "# 브라우저를 분실하거나 승인이 유출되면 즉시 실행" },
    "limitations.badge": { en: "Important", zh: "重要", ja: "重要", ko: "중요" },
    "limitations.title": { en: "Console mode is not a substitute for the extension.", zh: "Console 模式不是扩展的替代品。", ja: "コンソールモードは拡張機能の代わりにはなりません。", ko: "콘솔 모드는 확장 프로그램을 대체할 수 없습니다." },
    "limitations.body1": {
      en: "Page JavaScript can't read ",
      zh: "页面 JavaScript 无法读取 ",
      ja: "ページの JavaScript は ",
      ko: "페이지 JavaScript는 "
    },
    "limitations.body2": {
      en: " cookies, and can't recover the full Path, SameSite, or partition attributes. Use the Chrome extension when you need to reliably reuse a session — Console mode is only a temporary fallback.",
      zh: " Cookie，也无法恢复完整 Path、SameSite 和分区属性。需要稳定复用登录状态时，请使用 Chrome 扩展；Console 模式仅用于临时兼容。",
      ja: " Cookie を読み取れず、Path、SameSite、パーティション属性も完全には復元できません。ログイン状態を安定して再利用したい場合は Chrome 拡張機能を使用してください。Console モードは一時的な代替手段にすぎません。",
      ko: " 쿠키를 읽을 수 없고 전체 Path, SameSite, 파티션 속성도 복원할 수 없습니다. 로그인 상태를 안정적으로 재사용해야 한다면 Chrome 확장 프로그램을 사용하세요. Console 모드는 임시 대체 수단일 뿐입니다."
    },
    "footer.tagline": { en: "Sessions should flow — but never leak.", zh: "登录状态应该流动，但不应该暴露。", ja: "ログイン状態は流れるべきだが、漏れてはならない。", ko: "로그인 상태는 흘러야 하지만, 노출되어서는 안 됩니다." }
  };

  function detectLang() {
    const candidates = Array.isArray(navigator.languages) ? navigator.languages.slice() : [];
    if (navigator.language) candidates.push(navigator.language);
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
})(window);
