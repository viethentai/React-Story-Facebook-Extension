chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get({
    showInPageUI: true,
    recentEmojis: []
  });

  chrome.storage.local.set({
    showInPageUI: typeof existing.showInPageUI === "boolean" ? existing.showInPageUI : true,
    recentEmojis: Array.isArray(existing.recentEmojis) ? existing.recentEmojis : []
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") {
    return;
  }

  if (!tab.url || !tab.url.startsWith("https://www.facebook.com/")) {
    return;
  }

  chrome.tabs.sendMessage(tabId, { action: "PING" }, () => {
    if (chrome.runtime.lastError) {
      // Ignore: content script may not be ready yet on some navigations.
    }
  });
});
