// Keeps the toolbar badge in sync with the ON/OFF state.
function updateBadge(enabled) {
  chrome.action.setBadgeText({ text: enabled ? "ON" : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#FFF8E7" });
  if (chrome.action.setBadgeTextColor) chrome.action.setBadgeTextColor({ color: "#05552F" });
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

// Lets the content script read stylesheets hosted on other domains (CDNs, fonts, etc.)
// so hover/focus/animation rules can be copied. Only http(s) URLs, only from our own content script.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "sci-fetch-css") return;
  if (!sender || !sender.tab) {
    sendResponse({ ok: false, error: "not from a content script" });
    return;
  }
  let url;
  try {
    url = new URL(msg.url);
  } catch (e) {
    sendResponse({ ok: false, error: "bad url" });
    return;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    sendResponse({ ok: false, error: "unsupported protocol" });
    return;
  }
  fetch(url.href, { credentials: "omit" })
    .then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    })
    .then(
      (text) => sendResponse({ ok: true, text: text.length > 3000000 ? "" : text }),
      (err) => sendResponse({ ok: false, error: String(err) })
    );
  return true; // keep the message channel open for the async response
});
