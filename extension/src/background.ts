const ANALYZE_SELECTED_FILE_MENU_ID = "rg-review-guide-analyze-selected-file";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: ANALYZE_SELECTED_FILE_MENU_ID,
      title: "Analyze selected file",
      contexts: ["selection"],
      documentUrlPatterns: ["https://github.com/*"]
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== ANALYZE_SELECTED_FILE_MENU_ID || !tab?.id) {
    return;
  }

  chrome.tabs.sendMessage(tab.id, {
    type: "RG_ANALYZE_SELECTED_FILE",
    selectedText: info.selectionText ?? ""
  });
});
