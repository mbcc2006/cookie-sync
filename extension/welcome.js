const $ = (id) => document.getElementById(id);
const D = self.CookieSyncDomains;
let lang = "en";
const t = (key, params) => self.CookieSyncI18n.t(lang, key, params);

function render(consentAt) {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  if (!consentAt) return;
  $("agree").checked = true;
  $("agree").disabled = true;
  $("continue").hidden = true;
  $("done").hidden = false;
  $("done").textContent = `${t("welcome.accepted", { date: new Date(consentAt).toLocaleString() })} ${t("welcome.done")}`;
}

(async () => {
  const saved = await chrome.storage.local.get(["lang", "consentVersion", "consentAt"]);
  lang = saved.lang && self.CookieSyncI18n.LANGS.includes(saved.lang) ? saved.lang : self.CookieSyncI18n.detectLang();
  $("lang").value = lang;
  render(saved.consentVersion >= D.CONSENT_VERSION ? saved.consentAt : null);

  $("lang").addEventListener("change", async () => {
    lang = $("lang").value;
    await chrome.storage.local.set({ lang });
    const { consentVersion, consentAt } = await chrome.storage.local.get(["consentVersion", "consentAt"]);
    render(consentVersion >= D.CONSENT_VERSION ? consentAt : null);
  });
  $("agree").addEventListener("change", () => { $("continue").disabled = !$("agree").checked; });
  $("continue").addEventListener("click", async () => {
    const consentAt = new Date().toISOString();
    await chrome.storage.local.set({ consentVersion: D.CONSENT_VERSION, consentAt });
    render(consentAt);
    // Users updating from 0.8.x were already paired; resume syncing now that they agreed.
    chrome.runtime.sendMessage({ type: "sync-all" }).catch(() => {});
  });
})();
