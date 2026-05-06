const threshold = document.getElementById('threshold');
const display = document.getElementById('threshold-display');
const hideMostRelevant = document.getElementById('hideMostRelevant');
const cacheCount = document.getElementById('cache-count');
const clearBtn = document.getElementById('clear-cache');
const status = document.getElementById('status');

chrome.storage.sync.get({ threshold: 1, hideMostRelevant: true }, (data) => {
  threshold.value = data.threshold;
  display.textContent = data.threshold + '%';
  hideMostRelevant.checked = data.hideMostRelevant;
});

chrome.storage.local.get({ cache: {} }, (data) => {
  updateCacheCount(Object.keys(data.cache).length);
});

threshold.addEventListener('input', () => {
  display.textContent = threshold.value + '%';
});

threshold.addEventListener('change', () => {
  chrome.storage.sync.set({ threshold: parseInt(threshold.value) });
  flash('Saved');
});

hideMostRelevant.addEventListener('change', () => {
  chrome.storage.sync.set({ hideMostRelevant: hideMostRelevant.checked });
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
