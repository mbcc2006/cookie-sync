const I18N = window.CookieSyncI18n;
// Pages are prerendered per language ("/" is English, "/<code>/" the others); the switcher moves between them.
const lang = document.documentElement.dataset.lang || "en";
const t = (key, params) => I18N.t(lang, key, params);
const pathFor = (code) => (code === "en" ? "/" : `/${code}/`);

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

const select = document.getElementById("lang-switch");
select.replaceChildren(...I18N.LANGS.map((code) => new Option(I18N.NAMES[code], code)));
select.value = lang;
select.addEventListener("change", () => location.assign(pathFor(select.value) + location.hash));
