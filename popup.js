function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function render(data) {
  const total = data.totalDeclined || 0;
  const recent = data.recentActivity || [];

  document.getElementById('counter').textContent = total;

  const list = document.getElementById('activity-list');

  if (recent.length === 0) return; // keep empty state

  list.innerHTML = recent.map(entry => `
    <li>
      <div class="dot-small"></div>
      <span class="activity-host">${entry.host}</span>
      <span class="activity-cmp">${entry.cmp}</span>
      <span class="activity-time">${timeAgo(entry.timestamp)}</span>
    </li>
  `).join('');
}

chrome.storage.local.get(['totalDeclined', 'recentActivity'], render);

document.getElementById('reset-btn').addEventListener('click', () => {
  if (confirm('Reset the counter and activity log?')) {
    chrome.storage.local.set({ totalDeclined: 0, recentActivity: [] }, () => {
      chrome.action.setBadgeText({ text: '' });
      render({ totalDeclined: 0, recentActivity: [] });
    });
  }
});
