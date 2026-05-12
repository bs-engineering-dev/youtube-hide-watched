(function () {
  'use strict';

  const VIDEO_SELECTOR = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-reel-item-renderer',
  ].join(', ');

  const SECTION_SELECTOR = 'ytd-rich-section-renderer';
  const DEBOUNCE_MS = 300;
  const UNDO_MS = 60000;

  let config = { enabled: true, threshold: 1, maxAgeDays: 0, hideMostRelevant: true, hideLatest: true, iconOnThumbnail: false };
  let cache = {};
  let observer = null;
  let debounceTimer = null;
  let driftInterval = null;
  let scrollCutoff = false;

  async function init() {
    try {
      const [syncData, localData] = await Promise.all([
        chrome.storage.sync.get({ enabled: true, threshold: 1, maxAgeDays: 0, hideMostRelevant: true, hideLatest: true, iconOnThumbnail: false }),
        chrome.storage.local.get({ cache: {} }),
      ]);
      config = { enabled: syncData.enabled, threshold: syncData.threshold, maxAgeDays: syncData.maxAgeDays, hideMostRelevant: syncData.hideMostRelevant, hideLatest: syncData.hideLatest, iconOnThumbnail: syncData.iconOnThumbnail };
      cache = localData.cache;
    } catch (e) {
      // defaults already set
    }

    document.addEventListener('yt-navigate-finish', onNavigate);
    document.addEventListener('yt-page-data-updated', onNavigate);
    chrome.storage.onChanged.addListener(onStorageChange);
    chrome.runtime.onMessage.addListener(onMessage);

    onNavigate();
  }

  function isTargetPage() {
    const path = location.pathname;
    if (path === '/' || path === '') return true;
    if (path === '/feed/subscriptions' || path === '/feed/subscriptions/shorts') return true;
    if (/^\/@[^/]+(\/videos|\/streams)?\/?$/.test(path)) return true;
    if (/^\/(channel|c|user)\/[^/]+(\/videos|\/streams)?\/?$/.test(path)) return true;
    return false;
  }

  function isSubscriptionsPage() {
    return location.pathname.startsWith('/feed/subscriptions');
  }

  function onNavigate() {
    scrollCutoff = false;
    removeAgeCutoffBanner();
    if (isTargetPage()) {
      attachObserver();
      startDriftCheck();
      scheduleScan();
    } else {
      detachObserver();
      stopDriftCheck();
      cleanupDOM();
    }
  }

  function onStorageChange(changes, area) {
    if (area === 'sync') {
      if (changes.enabled) config.enabled = changes.enabled.newValue;
      if (changes.threshold) config.threshold = changes.threshold.newValue;
      if (changes.maxAgeDays) {
        config.maxAgeDays = changes.maxAgeDays.newValue;
        scrollCutoff = false;
        removeAgeCutoffBanner();
      }
      if (changes.hideMostRelevant) config.hideMostRelevant = changes.hideMostRelevant.newValue;
      if (changes.hideLatest) config.hideLatest = changes.hideLatest.newValue;
      if (changes.iconOnThumbnail) {
        config.iconOnThumbnail = changes.iconOnThumbnail.newValue;
        document.querySelectorAll('.hw-mark-btn, .hw-mark-btn-short').forEach(b => b.remove());
      }
      if (isTargetPage()) scheduleScan();
    }
    if (area === 'local' && changes.cache) {
      cache = changes.cache.newValue || {};
      if (isTargetPage()) scheduleScan();
    }
  }

  function attachObserver() {
    detachObserver();
    observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.addedNodes.length) {
          scheduleScan();
          return;
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function detachObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  function isDrifted() {
    const renderers = document.querySelectorAll(VIDEO_SELECTOR);
    for (const el of renderers) {
      if (el.classList.contains('hw-manual-hide')) continue;
      const id = extractVideoId(el);
      const watched = isWatched(el, id);
      const hidden = el.classList.contains('hw-hidden');
      const hasBtn = !!el.querySelector('.hw-mark-btn, .hw-mark-btn-short');

      if (config.enabled && watched && !hidden) return true;
      if (!config.enabled && hidden) return true;
      if (!watched && !hasBtn) return true;
    }
    return false;
  }

  function startDriftCheck() {
    stopDriftCheck();
    driftInterval = setInterval(() => {
      if (isDrifted()) scheduleScan();
    }, 2000);
  }

  function stopDriftCheck() {
    if (driftInterval) {
      clearInterval(driftInterval);
      driftInterval = null;
    }
  }

  function scheduleScan() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scan, DEBOUNCE_MS);
  }

  function scan() {
    if (!isTargetPage()) return;
    if (scrollCutoff) {
      removeContinuation();
      return;
    }
    hideMostRelevantSection();
    document.querySelectorAll(VIDEO_SELECTOR).forEach(processVideo);
    if (config.enabled) expandShortsIfNeeded();
    pruneEmptySections();
    if (config.maxAgeDays && isSubscriptionsPage()) checkAgeCutoff();
  }

  function expandShortsIfNeeded() {
    document.querySelectorAll(SECTION_SELECTOR).forEach((sec) => {
      if (sec.dataset.hwExpanded) return;

      const title = sec.querySelector('h2, #title');
      if (!title || !/shorts/i.test(title.textContent.trim())) return;

      const items = sec.querySelectorAll(VIDEO_SELECTOR);
      const hasHidden = Array.from(items).some((i) =>
        i.classList.contains('hw-hidden')
      );
      if (!hasHidden) return;

      const showMore = sec.querySelector(
        'ytd-button-renderer.expand-collapse-button button[aria-label="Show more"]'
      );
      if (showMore) {
        showMore.click();
        sec.dataset.hwExpanded = '1';
      }
    });
  }

  function hideMostRelevantSection() {
    document.querySelectorAll(SECTION_SELECTOR).forEach((sec) => {
      const title =
        sec.querySelector('h2') ||
        sec.querySelector('#title');
      if (!title) return;
      const text = title.textContent.trim();
      let shouldHide = null;
      if (/most relevant/i.test(text)) shouldHide = config.hideMostRelevant;
      else if (/^latest$/i.test(text)) shouldHide = config.hideLatest;
      if (shouldHide !== null) {
        if (shouldHide) {
          sec.classList.add('hw-section-hidden');
          sec.dataset.hwForceHidden = '1';
        } else {
          sec.classList.remove('hw-section-hidden');
          delete sec.dataset.hwForceHidden;
        }
      }
    });
  }

  function extractVideoId(el) {
    // Try link href first
    const a = el.querySelector('a[href*="/watch?v="], a[href*="/shorts/"]');
    if (a) {
      const href = a.getAttribute('href');
      const m =
        href.match(/[?&]v=([^&#]+)/) || href.match(/\/shorts\/([^?&#]+)/);
      if (m) return m[1];
    }
    // Fallback: content-id class on the lockup host
    const host = el.querySelector('[class*="content-id-"]');
    if (host) {
      const m = host.className.match(/content-id-([^\s]+)/);
      if (m) return m[1];
    }
    return null;
  }

  function getProgressWidth(el) {
    // New DOM (home/subscriptions)
    const newBar = el.querySelector('yt-thumbnail-overlay-progress-bar-view-model');
    if (newBar) {
      const divs = newBar.querySelectorAll('div');
      for (const div of divs) {
        const w = parseFloat(div.style.width);
        if (!isNaN(w) && w > 0) return w;
      }
      return 100;
    }

    // Old DOM (channel pages)
    const oldBar = el.querySelector('ytd-thumbnail-overlay-resume-playback-renderer');
    if (oldBar) {
      const progress = oldBar.querySelector('#progress');
      if (progress) {
        const w = parseFloat(progress.style.width);
        if (!isNaN(w) && w > 0) return w;
      }
      return 100;
    }

    return -1;
  }

  function parseAgeDays(text) {
    if (!text) return -1;
    const t = text.toLowerCase().replace(/^streamed\s+/, '');
    const m = t.match(/(\d+)\s+(second|minute|hour|day|week|month|year)/);
    if (!m) return -1;
    const n = parseInt(m[1], 10);
    switch (m[2]) {
      case 'second':
      case 'minute':
      case 'hour': return 0;
      case 'day': return n;
      case 'week': return n * 7;
      case 'month': return n * 30;
      case 'year': return n * 365;
      default: return -1;
    }
  }

  function getVideoAgeDays(el) {
    const spans = el.querySelectorAll(
      '.ytContentMetadataViewModelMetadataText, #metadata-line span, .inline-metadata-item, ytd-video-meta-block span'
    );
    for (const span of spans) {
      const age = parseAgeDays(span.textContent.trim());
      if (age >= 0) return age;
    }
    return -1;
  }

  function isTooOld(el) {
    if (!config.maxAgeDays || !isSubscriptionsPage()) return false;
    const age = getVideoAgeDays(el);
    return age >= 0 && age > config.maxAgeDays;
  }

  function isWatched(el, id) {
    if (id && cache[id]) return true;

    const progress = getProgressWidth(el);
    if (progress < 0) return false; // no progress bar at all

    if (config.threshold <= 1) return true; // any progress = watched
    return progress >= config.threshold;
  }

  function processVideo(el) {
    if (el.classList.contains('hw-manual-hide')) return;
    const id = extractVideoId(el);

    if (isTooOld(el)) {
      el.classList.add('hw-hidden');
      el.dataset.hwAgeHidden = '1';
      el.querySelectorAll('.hw-mark-btn, .hw-mark-btn-short').forEach(b => b.remove());
      return;
    }

    if (el.dataset.hwAgeHidden) {
      delete el.dataset.hwAgeHidden;
      el.classList.remove('hw-hidden');
    }

    if (isWatched(el, id)) {
      if (config.enabled) {
        el.classList.add('hw-hidden');
      } else {
        el.classList.remove('hw-hidden');
      }
      el.querySelectorAll('.hw-mark-btn, .hw-mark-btn-short').forEach(b => b.remove());
    } else {
      el.classList.remove('hw-hidden');
      ensureMarkButton(el, id);
    }
  }

  function isShortRenderer(el) {
    return !!el.querySelector('ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2');
  }

  function ensureMarkButton(el, id) {
    if (!id || el.querySelector('.hw-mark-btn, .hw-mark-btn-short')) return;

    const isShort = isShortRenderer(el);

    const btn = document.createElement('button');
    btn.title = 'Mark as watched';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      markWatched(el, id);
    });

    const eyeIcon =
      '<svg viewBox="0 0 24 24" width="20" height="20">' +
      '<path fill="currentColor" d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 001 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>' +
      '</svg>';

    if (isShort) {
      const subhead = el.querySelector('.shortsLockupViewModelHostOutsideMetadataSubhead');
      if (subhead) {
        btn.className = 'hw-mark-btn-short';
        btn.innerHTML = eyeIcon;
        subhead.appendChild(btn);
        return;
      }
    }

    if (!config.iconOnThumbnail) {
      let metadataLine = el.querySelector('#metadata-line');
      if (!metadataLine) {
        const metaTexts = el.querySelectorAll('.ytContentMetadataViewModelMetadataText');
        for (const span of metaTexts) {
          if (/view|watching/i.test(span.textContent)) {
            metadataLine = span.closest('.ytContentMetadataViewModelMetadataRow') || span.parentElement;
            break;
          }
        }
      }
      if (!metadataLine) {
        metadataLine =
          el.querySelector('.inline-metadata-item')?.parentElement ||
          el.querySelector('ytd-video-meta-block');
      }
      if (metadataLine) {
        btn.className = 'hw-mark-btn-short';
        btn.innerHTML = eyeIcon;
        metadataLine.appendChild(btn);
        return;
      }
    }

    {
      const container =
        el.querySelector('yt-thumbnail-view-model') ||
        el.querySelector('ytd-thumbnail') ||
        el.querySelector('#thumbnail');
      if (!container) return;
      container.style.position = 'relative';
      btn.className = 'hw-mark-btn';
      btn.innerHTML = eyeIcon;
      container.appendChild(btn);
    }
  }

  function markWatched(el, id) {
    cache[id] = Date.now();
    chrome.storage.local.set({ cache });

    el.querySelectorAll('.hw-mark-btn, .hw-mark-btn-short').forEach(b => b.remove());
    el.classList.add('hw-manual-hide');

    const card = document.createElement('div');
    card.className = 'hw-undo-card';
    card.innerHTML =
      '<span class="hw-undo-text">Video hidden</span>' +
      '<button class="hw-undo-btn">Undo</button>';
    el.appendChild(card);

    let undone = false;

    card.querySelector('.hw-undo-btn').addEventListener('click', () => {
      if (undone) return;
      undone = true;
      delete cache[id];
      chrome.storage.local.set({ cache });
      el.classList.remove('hw-manual-hide');
      card.remove();
      ensureMarkButton(el, id);
      pruneEmptySections();
    });

    setTimeout(() => {
      if (!undone) {
        el.classList.remove('hw-manual-hide');
        el.classList.add('hw-hidden');
        card.remove();
        pruneEmptySections();
      }
    }, UNDO_MS);

    pruneEmptySections();
  }

  function pruneEmptySections() {
    document.querySelectorAll(SECTION_SELECTOR).forEach((sec) => {
      if (sec.dataset.hwForceHidden) return;
      const items = sec.querySelectorAll(VIDEO_SELECTOR);
      if (!items.length) return;
      const allHidden = Array.from(items).every((i) =>
        i.classList.contains('hw-hidden')
      );
      sec.classList.toggle('hw-section-hidden', allHidden);
    });
  }

  function checkAgeCutoff() {
    const ageHidden = document.querySelectorAll('[data-hw-age-hidden]').length;
    if (ageHidden >= 15) {
      scrollCutoff = true;
      removeContinuation();
      showAgeCutoffBanner();
    }
  }

  function removeContinuation() {
    document.querySelectorAll('ytd-continuation-item-renderer').forEach((el) => {
      el.remove();
    });
  }

  function showAgeCutoffBanner() {
    removeAgeCutoffBanner();
    const grid = document.querySelector('ytd-rich-grid-renderer, ytd-section-list-renderer');
    if (!grid) return;
    const banner = document.createElement('div');
    banner.className = 'hw-age-cutoff-banner';
    banner.textContent = `Only showing videos from the last ${config.maxAgeDays} day${config.maxAgeDays !== 1 ? 's' : ''}`;
    grid.parentElement.insertBefore(banner, grid.nextSibling);
  }

  function removeAgeCutoffBanner() {
    document.querySelectorAll('.hw-age-cutoff-banner').forEach((e) => e.remove());
  }

  function onMessage(msg, _sender, sendResponse) {
    if (msg.action === 'markAllWatched') {
      const count = markAllVisible();
      sendResponse({ count });
    }
    return false;
  }

  function markAllVisible() {
    let count = 0;
    document.querySelectorAll(VIDEO_SELECTOR).forEach((el) => {
      if (el.classList.contains('hw-hidden') || el.classList.contains('hw-manual-hide')) return;
      const id = extractVideoId(el);
      if (!id || isWatched(el, id)) return;
      cache[id] = Date.now();
      el.querySelectorAll('.hw-mark-btn, .hw-mark-btn-short').forEach(b => b.remove());
      el.classList.add('hw-hidden');
      count++;
    });
    if (count > 0) {
      chrome.storage.local.set({ cache });
      pruneEmptySections();
    }
    return count;
  }

  function cleanupDOM() {
    document.querySelectorAll('.hw-hidden').forEach((e) =>
      e.classList.remove('hw-hidden')
    );
    document.querySelectorAll('[data-hw-age-hidden]').forEach((e) =>
      delete e.dataset.hwAgeHidden
    );
    document.querySelectorAll('.hw-section-hidden').forEach((e) => {
      if (e.dataset.hwForceHidden) return;
      e.classList.remove('hw-section-hidden');
    });
    document.querySelectorAll('.hw-mark-btn, .hw-mark-btn-short, .hw-undo-card').forEach((e) =>
      e.remove()
    );
    scrollCutoff = false;
    removeAgeCutoffBanner();
  }

  init();
})();
