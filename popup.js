const toggle = document.getElementById('toggle');
const options = document.getElementById('options');
const markAllBtn = document.getElementById('markAll');

chrome.storage.sync.get({ enabled: true }, (data) => {
  toggle.checked = data.enabled;
});

toggle.addEventListener('change', () => {
  chrome.storage.sync.set({ enabled: toggle.checked });
});

options.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

markAllBtn.addEventListener('click', async () => {
  markAllBtn.disabled = true;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { action: 'markAllWatched' });
      markAllBtn.textContent = `Marked ${resp?.count ?? 0}`;
    } catch {
      markAllBtn.textContent = 'No videos found';
    }
  }
  setTimeout(() => {
    markAllBtn.textContent = 'Mark All Watched';
    markAllBtn.disabled = false;
  }, 2000);
});
