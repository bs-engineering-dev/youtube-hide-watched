const toggle = document.getElementById('toggle');
const markAllBtn = document.getElementById('markAll');
const threshold = document.getElementById('threshold');
const display = document.getElementById('threshold-display');
const maxAgeDays = document.getElementById('maxAgeDays');
const maxAgeDisplay = document.getElementById('maxage-display');
const hideMostRelevant = document.getElementById('hideMostRelevant');
const hideLatest = document.getElementById('hideLatest');
const iconOnThumbnail = document.getElementById('iconOnThumbnail');
const cacheCount = document.getElementById('cache-count');
const clearBtn = document.getElementById('clear-cache');
const status = document.getElementById('status');

function formatMaxAge(val) {
  return val === 0 ? 'Off' : val + ' day' + (val !== 1 ? 's' : '');
}

chrome.storage.sync.get({ enabled: true, threshold: 1, maxAgeDays: 0, hideMostRelevant: true, hideLatest: true, iconOnThumbnail: false }, (data) => {
  toggle.checked = data.enabled;
  threshold.value = data.threshold;
  display.textContent = data.threshold + '%';
  maxAgeDays.value = data.maxAgeDays;
  maxAgeDisplay.textContent = formatMaxAge(data.maxAgeDays);
  hideMostRelevant.checked = data.hideMostRelevant;
  hideLatest.checked = data.hideLatest;
  iconOnThumbnail.checked = data.iconOnThumbnail;
});

chrome.storage.local.get({ cache: {} }, (data) => {
  updateCacheCount(Object.keys(data.cache).length);
});

toggle.addEventListener('change', () => {
  chrome.storage.sync.set({ enabled: toggle.checked });
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

threshold.addEventListener('input', () => {
  display.textContent = threshold.value + '%';
});

threshold.addEventListener('change', () => {
  chrome.storage.sync.set({ threshold: parseInt(threshold.value) });
  flash('Saved');
});

maxAgeDays.addEventListener('input', () => {
  maxAgeDisplay.textContent = formatMaxAge(parseInt(maxAgeDays.value));
});

maxAgeDays.addEventListener('change', () => {
  chrome.storage.sync.set({ maxAgeDays: parseInt(maxAgeDays.value) });
  flash('Saved');
});

hideMostRelevant.addEventListener('change', () => {
  chrome.storage.sync.set({ hideMostRelevant: hideMostRelevant.checked });
  flash('Saved');
});

hideLatest.addEventListener('change', () => {
  chrome.storage.sync.set({ hideLatest: hideLatest.checked });
  flash('Saved');
});

iconOnThumbnail.addEventListener('change', () => {
  chrome.storage.sync.set({ iconOnThumbnail: iconOnThumbnail.checked });
  flash('Saved');
});

clearBtn.addEventListener('click', () => {
  chrome.storage.local.set({ cache: {} });
  updateCacheCount(0);
  flash('Cache cleared');
});

function updateCacheCount(n) {
  cacheCount.textContent = n + ' video' + (n !== 1 ? 's' : '') + ' cached';
}

function flash(msg) {
  status.textContent = msg;
  setTimeout(() => { status.textContent = ''; }, 2000);
}
