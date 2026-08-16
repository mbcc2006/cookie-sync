import fs from "node:fs";
import path from "node:path";

export function defaultStateDirectory({ platform = process.platform, env = process.env, home = env.HOME || "." } = {}) {
  if (platform === "win32") return path.win32.join(env.APPDATA || path.win32.join(home, "AppData", "Roaming"), "cookie-sync");
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "cookie-sync");
  return path.join(env.XDG_STATE_HOME || path.join(home, ".local", "state"), "cookie-sync");
}

export function findChrome({ platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  if (env.CHROME_PATH) return env.CHROME_PATH;
  const candidates = platform === "win32"
    ? [
        path.win32.join(env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
        path.win32.join(env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
        path.win32.join(env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe")
      ]
    : platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  return candidates.find((candidate) => candidate && exists(candidate));
}

export function chromeLaunchArgs({ platform = process.platform, getuid = process.getuid } = {}) {
  return platform === "linux" && typeof getuid === "function" && getuid() === 0 ? ["--no-sandbox"] : [];
}
