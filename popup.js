const toggle = document.getElementById('toggle');
const markAllBtn = document.getElementById('markAll');
const threshold = document.getElementById('threshold');
const display = document.getElementById('threshold-display');
const maxAgeDays = document.getElementById('maxAgeDays');
const maxAgeDisplay = document.getElementById('maxage-display');
const hideMostRelevant = document.getElementById('hideMostRelevant');
const hideLatest = document.getElementById('hideLatest');
const hideShorts = document.getElementById('hideShorts');
const iconOnThumbnail = document.getElementById('iconOnThumbnail');
const cacheCount = document.getElementById('cache-count');
const cacheWarning = document.getElementById('cache-warning');
const cacheBarFill = document.getElementById('cache-bar-fill');
const cacheBarLabel = document.getElementById('cache-bar-label');
const clearBtn = document.getElementById('clear-cache');
const status = document.getElementById('status');

const CACHE_MAX_BYTES = 10_485_760;
const CACHE_WARN_BYTES = 8_000_000;

function formatMaxAge(val) {
  return val === 0 ? 'Off' : val + ' day' + (val !== 1 ? 's' : '');
}

chrome.storage.sync.get({ enabled: true, threshold: 5, maxAgeDays: 0, hideMostRelevant: true, hideLatest: true, hideShorts: false, iconOnThumbnail: false }, (data) => {
  toggle.checked = data.enabled;
  threshold.value = data.threshold;
  display.textContent = data.threshold + '%';
  maxAgeDays.value = data.maxAgeDays;
  maxAgeDisplay.textContent = formatMaxAge(data.maxAgeDays);
  hideMostRelevant.checked = data.hideMostRelevant;
  hideLatest.checked = data.hideLatest;
  hideShorts.checked = data.hideShorts;
  iconOnThumbnail.checked = data.iconOnThumbnail;
});

chrome.storage.local.get({ cache: {} }, (data) => {
  updateCacheCount(Object.keys(data.cache).length);
  updateCacheBar(JSON.stringify(data.cache).length);
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

hideShorts.addEventListener('change', () => {
  chrome.storage.sync.set({ hideShorts: hideShorts.checked });
  flash('Saved');
});

iconOnThumbnail.addEventListener('change', () => {
  chrome.storage.sync.set({ iconOnThumbnail: iconOnThumbnail.checked });
  flash('Saved');
});

clearBtn.addEventListener('click', () => {
  chrome.storage.local.set({ cache: {} });
  updateCacheCount(0);
  updateCacheBar(2);
  flash('Cache cleared');
});

function updateCacheCount(n) {
  cacheCount.textContent = n + ' video' + (n !== 1 ? 's' : '') + ' cached';
}

function updateCacheBar(bytes) {
  const pct = Math.min(100, (bytes / CACHE_MAX_BYTES) * 100);
  const mb = (bytes / 1_048_576).toFixed(1);
  cacheBarFill.style.width = pct + '%';
  cacheBarLabel.textContent = mb + ' / 10 MB';
  if (bytes > CACHE_WARN_BYTES) {
    cacheBarFill.style.background = bytes > 9_500_000 ? '#dc2626' : '#f59e0b';
    cacheWarning.style.display = 'block';
  } else {
    cacheBarFill.style.background = '#16a34a';
    cacheWarning.style.display = 'none';
  }
}

function flash(msg) {
  status.textContent = msg;
  setTimeout(() => { status.textContent = ''; }, 2000);
}
