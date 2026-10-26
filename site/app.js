// Pages are prerendered per language; the language menu is plain links, so this file only adds conveniences.
document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(button.dataset.copy);
    const original = button.textContent;
    button.textContent = button.dataset.copied;
    setTimeout(() => { button.textContent = original; }, 1400);
  });
});

document.querySelectorAll(".tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll(".command-panel").forEach((panel) => panel.classList.toggle("hidden", panel.id !== button.dataset.tab));
  });
});

// Close the language menu when clicking elsewhere or pressing Escape.
const menu = document.querySelector(".lang-menu");
document.addEventListener("click", (event) => { if (menu && !menu.contains(event.target)) menu.open = false; });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && menu) menu.open = false; });
