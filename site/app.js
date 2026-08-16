const I18N = window.CookieSyncI18n;
let lang = "en";
const t = (key, params) => I18N.t(lang, key, params);

function resolveLang() {
  const saved = localStorage.getItem("cs-lang");
  if (saved && I18N.LANGS.includes(saved)) return saved;
  return I18N.detectLang();
}

function applyTranslations() {
  document.documentElement.lang = lang;
  document.title = t("meta.title");
  document.getElementById("meta-description").setAttribute("content", t("meta.description"));
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });
}

function setLang(next) {
  lang = next;
  document.getElementById("lang-switch").value = next;
  applyTranslations();
  localStorage.setItem("cs-lang", next);
}

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(button.dataset.copy);
    const original = button.textContent;
    button.textContent = t("copy.copied");
    setTimeout(() => { button.textContent = original; }, 1400);
  });
});

document.querySelectorAll(".tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll(".command-panel").forEach((panel) => panel.classList.toggle("hidden", panel.id !== button.dataset.tab));
  });
});

document.getElementById("lang-switch").addEventListener("change", (event) => setLang(event.target.value));

lang = resolveLang();
document.getElementById("lang-switch").value = lang;
applyTranslations();
