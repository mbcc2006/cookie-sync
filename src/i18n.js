import { readJson, writePrivateJson } from "./store.js";

export const LANGS = ["en", "zh", "ja", "ko"];

const TRANSLATIONS = {
  "error.invalidDomain": {
    en: "Provide a valid domain such as github.com.",
    zh: "请提供有效域名，例如 github.com。",
    ja: "github.com のような有効なドメインを指定してください。",
    ko: "github.com과 같은 유효한 도메인을 입력하세요."
  },
  "error.requestFailed": {
    en: "Request failed: {status}",
    zh: "请求失败：{status}",
    ja: "リクエストが失敗しました：{status}",
    ko: "요청이 실패했습니다: {status}"
  },
  "error.noBrowsers": {
    en: "No authorized browsers found.",
    zh: "未找到已授权的浏览器。",
    ja: "認可されたブラウザが見つかりません。",
    ko: "승인된 브라우저를 찾을 수 없습니다."
  },
  "error.multipleBrowsers": {
    en: "Multiple browsers found. Use --browser <ID or alias>.",
    zh: "找到多个浏览器，请使用 --browser <ID 或别名> 指定。",
    ja: "複数のブラウザが見つかりました。--browser <ID またはエイリアス> を指定してください。",
    ko: "여러 브라우저가 발견되었습니다. --browser <ID 또는 별칭>을 사용하세요."
  },
  "error.browserAmbiguous": {
    en: "Browser selector is ambiguous.",
    zh: "浏览器选择条件不唯一。",
    ja: "ブラウザの指定が曖昧です。",
    ko: "브라우저 선택 조건이 모호합니다."
  },
  "error.browserNotFound": {
    en: "Browser not found: {selector}",
    zh: "未找到浏览器：{selector}",
    ja: "ブラウザが見つかりません：{selector}",
    ko: "브라우저를 찾을 수 없습니다: {selector}"
  },
  "info.noBrowsersList": {
    en: "No authorized browsers.",
    zh: "暂无已授权的浏览器。",
    ja: "認可されたブラウザはありません。",
    ko: "승인된 브라우저가 없습니다."
  },
  "label.noAlias": {
    en: "(no alias)",
    zh: "（无别名）",
    ja: "（エイリアスなし）",
    ko: "(별칭 없음)"
  },
  "label.unknownBrowser": {
    en: "Unknown browser",
    zh: "未知浏览器",
    ja: "不明なブラウザ",
    ko: "알 수 없는 브라우저"
  },
  "label.unknownOS": {
    en: "Unknown OS",
    zh: "未知系统",
    ja: "不明な OS",
    ko: "알 수 없는 OS"
  },
  "label.unknownArch": {
    en: "unknown arch",
    zh: "未知架构",
    ja: "不明なアーキテクチャ",
    ko: "알 수 없는 아키텍처"
  },
  "label.ua": {
    en: "  UA: {ua}",
    zh: "  UA：{ua}",
    ja: "  UA：{ua}",
    ko: "  UA: {ua}"
  },
  "label.unknownUA": {
    en: "unknown",
    zh: "未知",
    ja: "不明",
    ko: "알 수 없음"
  },
  "label.note": {
    en: "  Note: {note}",
    zh: "  备注：{note}",
    ja: "  メモ：{note}",
    ko: "  메모: {note}"
  },
  "label.lastSeen": {
    en: "  Last seen: {time}",
    zh: "  最后在线：{time}",
    ja: "  最終確認：{time}",
    ko: "  마지막 접속: {time}"
  },
  "info.browserUpdated": {
    en: "Updated browser {id}.",
    zh: "已更新浏览器 {id}。",
    ja: "ブラウザ {id} を更新しました。",
    ko: "브라우저 {id}를 업데이트했습니다."
  },
  "info.waitingApproval": {
    en: "Waiting for {browser} to approve Cookie access...",
    zh: "正在等待 {browser} 批准 Cookie 访问……",
    ja: "{browser} が Cookie アクセスを承認するのを待っています…",
    ko: "{browser}가 쿠키 접근을 승인하기를 기다리는 중..."
  },
  "error.accessDenied": {
    en: "Browser denied Cookie access.",
    zh: "浏览器已拒绝 Cookie 访问。",
    ja: "ブラウザが Cookie アクセスを拒否しました。",
    ko: "브라우저가 쿠키 접근을 거부했습니다."
  },
  "error.approvalTimeout": {
    en: "Browser approval timed out.",
    zh: "等待浏览器批准超时。",
    ja: "ブラウザの承認待ちがタイムアウトしました。",
    ko: "브라우저 승인 대기 시간이 초과되었습니다."
  },
  "info.pairCode": {
    en: "Pair code: {code}",
    zh: "配对码：{code}",
    ja: "ペアコード：{code}",
    ko: "페어링 코드: {code}"
  },
  "info.relay": {
    en: "Relay: {relay}",
    zh: "中继：{relay}",
    ja: "リレー：{relay}",
    ko: "릴레이: {relay}"
  },
  "info.expires": {
    en: "Expires: {time}",
    zh: "过期时间：{time}",
    ja: "有効期限：{time}",
    ko: "만료 시간: {time}"
  },
  "info.pairUrl": {
    en: "Pair URL: {url}",
    zh: "配对链接：{url}",
    ja: "ペア URL：{url}",
    ko: "페어링 URL: {url}"
  },
  "info.pairHint": {
    en: "Open the Pair URL in Chrome to prefill and open the CookieSync extension.",
    zh: "在 Chrome 中打开该配对链接，即可自动填充并打开 CookieSync 扩展。",
    ja: "ペア URL を Chrome で開くと、CookieSync 拡張機能に自動入力されて開きます。",
    ko: "Chrome에서 페어링 URL을 열면 CookieSync 확장 프로그램이 자동으로 채워져 열립니다."
  },
  "info.savedCookies": {
    en: "Saved {count} cookies for {domain} from {browser}.",
    zh: "已从 {browser} 保存 {domain} 的 {count} 个 Cookie。",
    ja: "{browser} から {domain} の Cookie を {count} 件保存しました。",
    ko: "{browser}에서 {domain}의 쿠키 {count}개를 저장했습니다."
  },
  "error.invalidSnapshot": {
    en: "Invalid cookie snapshot.",
    zh: "Cookie 快照无效。",
    ja: "Cookie スナップショットが無効です。",
    ko: "쿠키 스냅샷이 유효하지 않습니다."
  },
  "error.noMessages": {
    en: "No messages found.",
    zh: "未找到消息。",
    ja: "メッセージが見つかりません。",
    ko: "메시지를 찾을 수 없습니다."
  },
  "error.invalidSnapshotFor": {
    en: "Invalid cookie snapshot for {domain}.",
    zh: "{domain} 的 Cookie 快照无效。",
    ja: "{domain} の Cookie スナップショットが無効です。",
    ko: "{domain}의 쿠키 스냅샷이 유효하지 않습니다."
  },
  "info.revoked": {
    en: "Revoked all browser upload devices for this pairing.",
    zh: "已撤销该配对下所有浏览器的上传设备权限。",
    ja: "このペアリングに属するすべてのブラウザのアップロード権限を取り消しました。",
    ko: "이 페어링에 속한 모든 브라우저의 업로드 권한을 취소했습니다."
  },
  "info.exported": {
    en: "Exported pair and identity to {file}.",
    zh: "已将配对信息和密钥导出到 {file}。",
    ja: "ペア情報と鍵を {file} にエクスポートしました。",
    ko: "페어링 정보와 키를 {file}에 내보냈습니다."
  },
  "warn.exportSecret": {
    en: "Warning: this grants full read access to synced cookies. Keep it secret and transfer it securely.",
    zh: "警告：该文件拥有同步 Cookie 的完整读取权限，请妥善保密并通过安全渠道传输。",
    ja: "警告：このファイルは同期された Cookie への完全な読み取り権限を持ちます。厳重に保管し、安全な方法で転送してください。",
    ko: "경고: 이 파일은 동기화된 쿠키에 대한 전체 읽기 권한을 부여합니다. 안전하게 보관하고 안전한 방법으로 전달하세요."
  },
  "error.importMissingFile": {
    en: "Provide a file path exported with `cookie-sync export`.",
    zh: "请提供由 `cookie-sync export` 导出的文件路径。",
    ja: "`cookie-sync export` で出力したファイルのパスを指定してください。",
    ko: "`cookie-sync export`로 내보낸 파일 경로를 입력하세요."
  },
  "error.importMissingIdentity": {
    en: "Invalid export file: missing identity.",
    zh: "导出文件无效：缺少密钥信息。",
    ja: "無効なエクスポートファイルです：鍵情報がありません。",
    ko: "잘못된 내보내기 파일: 키 정보가 없습니다."
  },
  "error.importMissingPair": {
    en: "Invalid export file: missing pair credentials.",
    zh: "导出文件无效：缺少配对凭据。",
    ja: "無効なエクスポートファイルです：ペア資格情報がありません。",
    ko: "잘못된 내보내기 파일: 페어링 자격 증명이 없습니다."
  },
  "info.imported": {
    en: "Imported pairing for code {code}.",
    zh: "已导入配对码 {code} 的配对信息。",
    ja: "コード {code} のペアリングをインポートしました。",
    ko: "코드 {code}의 페어링을 가져왔습니다."
  },
  "info.importRelayMismatch": {
    en: "Note: exported relay was {exportedRelay}; this CLI is using {relay}.",
    zh: "提示：导出时使用的中继为 {exportedRelay}，当前 CLI 使用的是 {relay}。",
    ja: "注：エクスポート時のリレーは {exportedRelay} でしたが、この CLI は {relay} を使用しています。",
    ko: "참고: 내보낼 때 릴레이는 {exportedRelay}였지만, 이 CLI는 {relay}를 사용 중입니다."
  },
  "info.consoleOpen": {
    en: "Open https://{domain}/, then paste this URL into DevTools Console or the address bar:\n",
    zh: "打开 https://{domain}/，然后将以下 URL 粘贴到 DevTools 控制台或地址栏：\n",
    ja: "https://{domain}/ を開き、次の URL を DevTools コンソールまたはアドレスバーに貼り付けてください：\n",
    ko: "https://{domain}/ 를 연 다음 아래 URL을 DevTools 콘솔 또는 주소 표시줄에 붙여넣으세요:\n"
  },
  "info.consoleReason": {
    en: "\nReason: {reason}",
    zh: "\n原因：{reason}",
    ja: "\n理由：{reason}",
    ko: "\n사유: {reason}"
  },
  "info.consoleWaiting": {
    en: "Waiting for one-time upload (non-HttpOnly cookies only)...",
    zh: "正在等待一次性上传（仅限非 HttpOnly Cookie）……",
    ja: "一度限りのアップロードを待っています（HttpOnly 以外の Cookie のみ）…",
    ko: "1회성 업로드를 기다리는 중입니다 (HttpOnly가 아닌 쿠키만 해당)..."
  },
  "info.consoleSaved": {
    en: "Saved {count} non-HttpOnly cookies for {domain}.",
    zh: "已保存 {domain} 的 {count} 个非 HttpOnly Cookie。",
    ja: "{domain} の HttpOnly 以外の Cookie を {count} 件保存しました。",
    ko: "{domain}의 HttpOnly가 아닌 쿠키 {count}개를 저장했습니다."
  },
  "error.invalidConsoleSnapshot": {
    en: "Invalid console cookie snapshot.",
    zh: "Console 导入的 Cookie 快照无效。",
    ja: "コンソールの Cookie スナップショットが無効です。",
    ko: "콘솔 쿠키 스냅샷이 유효하지 않습니다."
  },
  "error.consoleExpired": {
    en: "Console import session expired.",
    zh: "Console 导入会话已过期。",
    ja: "コンソールインポートセッションの有効期限が切れました。",
    ko: "콘솔 가져오기 세션이 만료되었습니다."
  },
  "error.timeoutRange": {
    en: "Timeout must be between 1 and 3600 seconds.",
    zh: "超时时间必须在 1 到 3600 秒之间。",
    ja: "タイムアウトは 1〜3600 秒の範囲で指定してください。",
    ko: "제한 시간은 1~3600초 사이여야 합니다."
  },
  "info.waitingFor": {
    en: "Waiting up to {seconds}s for {domain} from {browser}...",
    zh: "最长等待 {seconds} 秒，等待 {browser} 提供 {domain} 的 Cookie……",
    ja: "{browser} からの {domain} の Cookie を最大 {seconds} 秒待っています…",
    ko: "{browser}에서 {domain}의 쿠키를 최대 {seconds}초 동안 기다리는 중..."
  },
  "error.waitTimeout": {
    en: "Timed out waiting for {domain}.",
    zh: "等待 {domain} 超时。",
    ja: "{domain} の待機がタイムアウトしました。",
    ko: "{domain} 대기 시간이 초과되었습니다."
  },
  "error.chromeNotFound": {
    en: "Chrome or Chromium was not found. Set CHROME_PATH to its executable path.",
    zh: "未找到 Chrome 或 Chromium，请通过 CHROME_PATH 指定可执行文件路径。",
    ja: "Chrome または Chromium が見つかりません。CHROME_PATH に実行ファイルのパスを設定してください。",
    ko: "Chrome 또는 Chromium을 찾을 수 없습니다. CHROME_PATH에 실행 파일 경로를 설정하세요."
  },
  "info.stateDirectory": {
    en: "State directory: {dir}",
    zh: "状态目录：{dir}",
    ja: "状態ディレクトリ：{dir}",
    ko: "상태 디렉터리: {dir}"
  },
  "info.pairExpires": {
    en: "Pair expires: {time}",
    zh: "配对过期时间：{time}",
    ja: "ペアの有効期限：{time}",
    ko: "페어링 만료 시간: {time}"
  },
  "info.noPairCode": {
    en: "Pair code: none",
    zh: "配对码：无",
    ja: "ペアコード：なし",
    ko: "페어링 코드: 없음"
  },
  "info.langCurrent": {
    en: "Language: {lang} ({source})",
    zh: "语言：{lang}（{source}）",
    ja: "言語：{lang}（{source}）",
    ko: "언어: {lang} ({source})"
  },
  "info.langSet": {
    en: "Language set to {lang}.",
    zh: "语言已设置为 {lang}。",
    ja: "言語を {lang} に設定しました。",
    ko: "언어가 {lang}(으)로 설정되었습니다."
  },
  "error.langUnsupported": {
    en: "Unsupported language: {value}. Use en, zh, ja, or ko.",
    zh: "不支持的语言：{value}。请使用 en、zh、ja 或 ko。",
    ja: "サポートされていない言語です：{value}。en、zh、ja、ko のいずれかを指定してください。",
    ko: "지원되지 않는 언어입니다: {value}. en, zh, ja, ko 중 하나를 사용하세요."
  },
  "source.env": {
    en: "environment override",
    zh: "环境变量覆盖",
    ja: "環境変数による上書き",
    ko: "환경 변수 재정의"
  },
  "source.saved": {
    en: "saved preference",
    zh: "已保存的偏好设置",
    ja: "保存済みの設定",
    ko: "저장된 환경설정"
  },
  "source.auto": {
    en: "auto-detected",
    zh: "自动检测",
    ja: "自動検出",
    ko: "자동 감지"
  },
  "reason.pull": {
    en: "Pull Cookie snapshot for {domain}",
    zh: "拉取 {domain} 的 Cookie 快照",
    ja: "{domain} の Cookie スナップショットを取得",
    ko: "{domain}의 쿠키 스냅샷 가져오기"
  },
  "reason.pullAll": {
    en: "Pull all available Cookie snapshots",
    zh: "拉取所有可用的 Cookie 快照",
    ja: "利用可能なすべての Cookie スナップショットを取得",
    ko: "사용 가능한 모든 쿠키 스냅샷 가져오기"
  },
  "reason.console": {
    en: "One-time Console Cookie import for {domain}",
    zh: "为 {domain} 执行一次性 Console Cookie 导入",
    ja: "{domain} 向けの一度限りのコンソール Cookie インポート",
    ko: "{domain}에 대한 1회성 콘솔 쿠키 가져오기"
  },
  "reason.wait": {
    en: "Wait for and pull Cookie snapshot for {domain}",
    zh: "等待并拉取 {domain} 的 Cookie 快照",
    ja: "{domain} の Cookie スナップショットを待機して取得",
    ko: "{domain}의 쿠키 스냅샷을 기다렸다가 가져오기"
  },
  "reason.browse": {
    en: "Launch headless browser for {url}",
    zh: "为 {url} 启动无头浏览器",
    ja: "{url} 向けにヘッドレスブラウザを起動",
    ko: "{url}용 헤드리스 브라우저 실행"
  },
  "reason.playwright": {
    en: "Export Cookie snapshot for Playwright for {domain}",
    zh: "为 Playwright 导出 {domain} 的 Cookie 快照",
    ja: "Playwright 向けに {domain} の Cookie スナップショットをエクスポート",
    ko: "Playwright용 {domain} 쿠키 스냅샷 내보내기"
  },
  "info.playwrightSaved": {
    en: "Saved {count} cookies to Playwright storage state {file}.",
    zh: "已将 {count} 个 Cookie 保存到 Playwright storage state：{file}。",
    ja: "Cookie {count} 件を Playwright storage state {file} に保存しました。",
    ko: "쿠키 {count}개를 Playwright storage state {file}에 저장했습니다."
  },
  "reason.cookies": {
    en: "Export Cookie snapshot for {domain}",
    zh: "导出 {domain} 的 Cookie 快照",
    ja: "{domain} の Cookie スナップショットをエクスポート",
    ko: "{domain} 쿠키 스냅샷 내보내기"
  },
  "error.cookieFormat": {
    en: "Cookie format must be json or txt.",
    zh: "Cookie 格式必须为 json 或 txt。",
    ja: "Cookie 形式は json または txt で指定してください。",
    ko: "쿠키 형식은 json 또는 txt여야 합니다."
  },
  "info.cookiesSaved": {
    en: "Saved {count} cookies as {format} to {file}.",
    zh: "已将 {count} 个 Cookie 以 {format} 格式保存到 {file}。",
    ja: "Cookie {count} 件を {format} 形式で {file} に保存しました。",
    ko: "쿠키 {count}개를 {format} 형식으로 {file}에 저장했습니다."
  },
  "reason.ytDlp": {
    en: "Run yt-dlp with synchronized Cookies for {domain}",
    zh: "使用已同步的 {domain} Cookie 运行 yt-dlp",
    ja: "同期した {domain} の Cookie で yt-dlp を実行",
    ko: "동기화된 {domain} 쿠키로 yt-dlp 실행"
  },
  "error.ytDlpExit": {
    en: "yt-dlp exited with code {code}.",
    zh: "yt-dlp 退出，状态码为 {code}。",
    ja: "yt-dlp がコード {code} で終了しました。",
    ko: "yt-dlp가 코드 {code}(으)로 종료되었습니다."
  },
  "error.ytDlpSignal": {
    en: "yt-dlp was terminated by signal {signal}.",
    zh: "yt-dlp 被信号 {signal} 终止。",
    ja: "yt-dlp がシグナル {signal} で終了しました。",
    ko: "yt-dlp가 신호 {signal}에 의해 종료되었습니다."
  },
  "error.invalidUrl": {
    en: "Provide a valid HTTP or HTTPS URL.",
    zh: "请提供有效的 HTTP 或 HTTPS URL。",
    ja: "有効な HTTP または HTTPS URL を指定してください。",
    ko: "유효한 HTTP 또는 HTTPS URL을 입력하세요."
  },
  "info.openedUrl": {
    en: "Opened {url} in {browser}.",
    zh: "已在 {browser} 中打开 {url}。",
    ja: "{browser} で {url} を開きました。",
    ko: "{browser}에서 {url}을(를) 열었습니다."
  },
  "error.usage": {
    en: "Usage: cookie-sync <pair|console <domain> [--reason text]|browsers|browser set <ID> [--alias name] [--note text]|pull <domain> [--browser ID] [--reason text]|pull-all [--browser ID] [--reason text]|browse <url> [--browser ID|console] [--reason text]|open <url> [--browser ID]|playwright <domain> [--out file] [--browser ID|console] [--reason text]|cookies <domain> [--format json|txt] [--out file] [--browser ID|console] [--reason text]|yt-dlp <url> [--browser ID|console] [--domain domain] [--yt-dlp path] [--reason text] [-- yt-dlp args]|revoke|export [--out file]|import <file>|lang [en|zh|ja|ko]|status>",
    zh: "Usage: cookie-sync <pair|console <domain> [--reason text]|browsers|browser set <ID> [--alias name] [--note text]|pull <domain> [--browser ID] [--reason text]|pull-all [--browser ID] [--reason text]|browse <url> [--browser ID|console] [--reason text]|open <url> [--browser ID]|playwright <domain> [--out file] [--browser ID|console] [--reason text]|cookies <domain> [--format json|txt] [--out file] [--browser ID|console] [--reason text]|yt-dlp <url> [--browser ID|console] [--domain domain] [--yt-dlp path] [--reason text] [-- yt-dlp args]|revoke|export [--out file]|import <file>|lang [en|zh|ja|ko]|status>",
    ja: "Usage: cookie-sync <pair|console <domain> [--reason text]|browsers|browser set <ID> [--alias name] [--note text]|pull <domain> [--browser ID] [--reason text]|pull-all [--browser ID] [--reason text]|browse <url> [--browser ID|console] [--reason text]|open <url> [--browser ID]|playwright <domain> [--out file] [--browser ID|console] [--reason text]|cookies <domain> [--format json|txt] [--out file] [--browser ID|console] [--reason text]|yt-dlp <url> [--browser ID|console] [--domain domain] [--yt-dlp path] [--reason text] [-- yt-dlp args]|revoke|export [--out file]|import <file>|lang [en|zh|ja|ko]|status>",
    ko: "Usage: cookie-sync <pair|console <domain> [--reason text]|browsers|browser set <ID> [--alias name] [--note text]|pull <domain> [--browser ID] [--reason text]|pull-all [--browser ID] [--reason text]|browse <url> [--browser ID|console] [--reason text]|open <url> [--browser ID]|playwright <domain> [--out file] [--browser ID|console] [--reason text]|cookies <domain> [--format json|txt] [--out file] [--browser ID|console] [--reason text]|yt-dlp <url> [--browser ID|console] [--domain domain] [--yt-dlp path] [--reason text] [-- yt-dlp args]|revoke|export [--out file]|import <file>|lang [en|zh|ja|ko]|status>"
  }
};

function matchLang(candidate) {
  if (!candidate) return null;
  const primary = String(candidate).toLowerCase().split(/[-_.]/)[0];
  return LANGS.includes(primary) ? primary : null;
}

function savedLang() {
  try {
    return matchLang(readJson("lang.json").lang);
  } catch {
    return null;
  }
}

function detectLang() {
  for (const candidate of [process.env.LANGUAGE, process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG]) {
    const match = matchLang(candidate);
    if (match) return match;
  }
  try {
    const match = matchLang(Intl.DateTimeFormat().resolvedOptions().locale);
    if (match) return match;
  } catch {}
  return "en";
}

export function resolveLang() {
  const envLang = matchLang(process.env.COOKIE_SYNC_LANG);
  if (envLang) return { lang: envLang, source: "env" };
  const saved = savedLang();
  if (saved) return { lang: saved, source: "saved" };
  return { lang: detectLang(), source: "auto" };
}

let current = resolveLang().lang;

export function getLang() {
  return current;
}

export function setLang(lang) {
  const match = matchLang(lang);
  if (!match) throw new Error(t("error.langUnsupported", { value: lang }));
  writePrivateJson("lang.json", { lang: match });
  current = match;
  return match;
}

export function t(key, params = {}) {
  const table = TRANSLATIONS[key];
  const template = (table && (table[current] || table.en)) || key;
  return template.replace(/\{(\w+)\}/g, (_, name) => (name in params ? String(params[name]) : `{${name}}`));
}
