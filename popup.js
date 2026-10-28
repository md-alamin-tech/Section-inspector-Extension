const toggle = document.getElementById("toggle");
const statusEl = document.getElementById("status");

function render(enabled) {
  toggle.checked = enabled;
  statusEl.textContent = enabled ? "ON" : "OFF";
  statusEl.style.color = enabled ? "#10B981" : "#6b7280";
}

chrome.storage.local.get("sciEnabled", (res) => render(!!res.sciEnabled));

toggle.addEventListener("change", () => {
  const enabled = toggle.checked;
  chrome.storage.local.set({ sciEnabled: enabled }, () => render(enabled));
});
