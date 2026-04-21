// Background service worker — tracks decline stats

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'DECLINED') {
    chrome.storage.local.get(['totalDeclined', 'recentActivity'], (data) => {
      const total = (data.totalDeclined || 0) + 1;
      const recent = data.recentActivity || [];
      recent.unshift({
        host: message.host,
        cmp: message.cmp,
        timestamp: message.timestamp
      });
      // Keep last 50 entries
      if (recent.length > 50) recent.pop();

      chrome.storage.local.set({ totalDeclined: total, recentActivity: recent });

      // Update badge
      chrome.action.setBadgeText({ text: total > 999 ? '999+' : String(total) });
      chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
    });
  }
});

// Init badge on install/update
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get('totalDeclined', (data) => {
    const total = data.totalDeclined || 0;
    chrome.action.setBadgeText({ text: total > 0 ? String(total) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
  });
});
