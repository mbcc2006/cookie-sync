document.addEventListener("cookie-sync-pair", async (event) => {
  const pair = event.detail?.pair;
  const relay = event.detail?.relay;
  if (!pair || relay !== "https://relay.ivjn.us") return;
  await chrome.storage.local.set({ pendingPair: pair, relay });
  chrome.runtime.sendMessage({ type: "open-pair", pair }).catch(() => {});
});
