const toggle = document.getElementById('toggle');
const markAllBtn = document.getElementById('markAll');
const threshold = document.getElementById('threshold');
const display = document.getElementById('threshold-display');
const maxAgeDays = document.getElementById('maxAgeDays');
const maxAgeDisplay = document.getElementById('maxage-display');
const hideMostRelevant = document.getElementById('hideMostRelevant');
const hideShorts = document.getElementById('hideShorts');
const hideScheduled = document.getElementById('hideScheduled');
const hidePlayables = document.getElementById('hidePlayables');
const iconOnThumbnail = document.getElementById('iconOnThumbnail');
const cacheCount = document.getElementById('cache-count');
const cacheWarning = document.getElementById('cache-warning');
const cacheBarFill = document.getElementById('cache-bar-fill');
const cacheBarLabel = document.getElementById('cache-bar-label');
const clearBtn = document.getElementById('clear-cache');
const status = document.getElementById('status');
const hiddenCount = document.getElementById('hidden-count');

const CACHE_MAX_BYTES = 10_485_760;
const CACHE_WARN_BYTES = 8_000_000;

const msg = chrome.i18n.getMessage.bind(chrome.i18n);

document.querySelectorAll('[data-i18n]').forEach(el => {
  const translated = msg(el.dataset.i18n);
  if (translated) el.textContent = translated;
});

function pluralUnit(count, singularKey, pluralKey) {
  return count === 1 ? msg(singularKey) : msg(pluralKey);
}

function formatMaxAge(val) {
  if (val === 0) return msg('maxAgeOff');
  return msg('maxAgeDays', [String(val), pluralUnit(val, 'dayUnit', 'daysUnit')]);
}

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { action: 'getHiddenCount' });
      if (resp?.count > 0) {
        hiddenCount.textContent = msg('hiddenCount', [String(resp.count), pluralUnit(resp.count, 'videoUnit', 'videosUnit')]);
      }
    } catch {}
  }
})();

chrome.storage.sync.get({ enabled: true, threshold: 15, maxAgeDays: 0, hideMostRelevant: true, hideShorts: false, hideScheduled: false, hidePlayables: false, iconOnThumbnail: false }, (data) => {
  toggle.checked = data.enabled;
  threshold.value = data.threshold;
  display.textContent = data.threshold + '%';
  maxAgeDays.value = data.maxAgeDays;
  maxAgeDisplay.textContent = formatMaxAge(data.maxAgeDays);
  hideMostRelevant.checked = data.hideMostRelevant;
  hideShorts.checked = data.hideShorts;
  hideScheduled.checked = data.hideScheduled;
  hidePlayables.checked = data.hidePlayables;
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
      markAllBtn.textContent = msg('markedCount', [String(resp?.count ?? 0)]);
    } catch {
      markAllBtn.textContent = msg('noVideosFound');
    }
  }
  setTimeout(() => {
    markAllBtn.textContent = msg('markAllWatched');
    markAllBtn.disabled = false;
  }, 2000);
});

threshold.addEventListener('input', () => {
  display.textContent = threshold.value + '%';
});

threshold.addEventListener('change', () => {
  chrome.storage.sync.set({ threshold: parseInt(threshold.value) });
  flash(msg('saved'));
});

maxAgeDays.addEventListener('input', () => {
  maxAgeDisplay.textContent = formatMaxAge(parseInt(maxAgeDays.value));
});

maxAgeDays.addEventListener('change', () => {
  chrome.storage.sync.set({ maxAgeDays: parseInt(maxAgeDays.value) });
  flash(msg('saved'));
});

hideMostRelevant.addEventListener('change', () => {
  chrome.storage.sync.set({ hideMostRelevant: hideMostRelevant.checked });
  flash(msg('saved'));
});

hideShorts.addEventListener('change', () => {
  chrome.storage.sync.set({ hideShorts: hideShorts.checked });
  flash(msg('saved'));
});

hideScheduled.addEventListener('change', () => {
  chrome.storage.sync.set({ hideScheduled: hideScheduled.checked });
  flash(msg('saved'));
});

hidePlayables.addEventListener('change', () => {
  chrome.storage.sync.set({ hidePlayables: hidePlayables.checked });
  flash(msg('saved'));
});

iconOnThumbnail.addEventListener('change', () => {
  chrome.storage.sync.set({ iconOnThumbnail: iconOnThumbnail.checked });
  flash(msg('saved'));
});

clearBtn.addEventListener('click', () => {
  chrome.storage.local.set({ cache: {} });
  updateCacheCount(0);
  updateCacheBar(2);
  flash(msg('cacheCleared'));
});

function updateCacheCount(n) {
  cacheCount.textContent = msg('videosCached', [String(n), pluralUnit(n, 'videoUnit', 'videosUnit')]);
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

function flash(text) {
  status.textContent = text;
  setTimeout(() => { status.textContent = ''; }, 2000);
}
