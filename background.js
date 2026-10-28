// Keeps the toolbar badge in sync with the ON/OFF state.
function updateBadge(enabled) {
  chrome.action.setBadgeText({ text: enabled ? "ON" : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#10B981" });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get("sciEnabled", (res) => {
    if (typeof res.sciEnabled === "undefined") {
      chrome.storage.local.set({ sciEnabled: false });
    }
    updateBadge(!!res.sciEnabled);
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get("sciEnabled", (res) => updateBadge(!!res.sciEnabled));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.sciEnabled) {
    updateBadge(!!changes.sciEnabled.newValue);
  }
});
