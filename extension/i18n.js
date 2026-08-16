(function (global) {
  const LANGS = ["en", "zh", "ja", "ko"];

  const TRANSLATIONS = {
    "label.relay": { en: "Relay URL", zh: "中继地址", ja: "リレー URL", ko: "릴레이 URL" },
    "label.pairCode": { en: "Pair code", zh: "配对码", ja: "ペアコード", ko: "페어링 코드" },
    "label.policy": { en: "CLI Cookie access", zh: "CLI 读取 Cookie", ja: "CLI による Cookie 読み取り", ko: "CLI의 쿠키 읽기" },
    "label.language": { en: "Language", zh: "语言", ja: "言語", ko: "언어" },
    "policy.notify": { en: "Allow by default, but notify me", zh: "默认允许，但通知提示", ja: "既定で許可するが通知する", ko: "기본적으로 허용하되 알림 표시" },
    "policy.confirm": { en: "Always ask for confirmation", zh: "每次都需要确认", ja: "毎回確認を必須にする", ko: "매번 확인 필요" },
    "button.sync.authorize": { en: "Authorize and sync all permitted domains", zh: "授权并同步所有允许的域名", ja: "認可してすべての許可ドメインを同期", ko: "승인하고 허용된 모든 도메인 동기화" },
    "button.sync.now": { en: "Sync all permitted domains now", zh: "立即同步所有允许的域名", ja: "今すぐすべての許可ドメインを同期", ko: "지금 허용된 모든 도메인 동기화" },
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
    "status.authorized": { en: "Authorized. CookieSync will continuously sync all permitted domains.", zh: "已授权。CookieSync 将持续同步所有允许的域名。", ja: "認可されました。CookieSync はすべての許可ドメインを継続的に同期します。", ko: "승인되었습니다. CookieSync가 허용된 모든 도메인을 지속적으로 동기화합니다." },
    "status.authorizedExisting": { en: "This browser is authorized for continuous synchronization.", zh: "此浏览器已授权，将持续同步。", ja: "このブラウザは認可済みで、継続的に同期されます。", ko: "이 브라우저는 승인되어 지속적으로 동기화됩니다." },
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
    "error.decisionFailed": { en: "Decision failed.", zh: "提交决定失败。", ja: "判定の送信に失敗しました。", ko: "결정 제출에 실패했습니다." }
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
