(function () {
  'use strict';

  const VIDEO_SELECTOR = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-reel-item-renderer',
  ].join(', ');

  // Both forms appear on real feeds; matching only the first missed shelves
  // entirely, which left pruneEmptySections() unable to collapse a shelf whose
  // videos were all hidden. ytd-item-section-renderer is deliberately excluded:
  // it is the generic feed wrapper, has no title, and pruning it would hide the
  // whole page.
  const SECTION_SELECTOR = 'ytd-rich-section-renderer, ytd-shelf-renderer';
  const DEBOUNCE_MS = 300;
  const UNDO_MS = 60000;
  // A fallback, not the driver: timeupdate does the real work. Shorts reuse one
  // <video> across swipes (measured: a single bind served two consecutive
  // Shorts), so this is not needed to follow navigation — its remaining job is
  // the FIRST bind, because at document_idle the player often does not exist
  // yet. Kept short so a Short opened cold is tracked from near its start; the
  // tick is two querySelectors and one sample, and writes are rate-limited
  // independently.
  const WATCH_POLL_MS = 1000;
  const CACHE_EVICT_BYTES = 9_500_000;
  const CACHE_TARGET_BYTES = 7_000_000;
  const CACHE_CHECK_COUNT = 200_000;

  let config = { enabled: true, threshold: 15, maxAgeDays: 0, hideMostRelevant: true, hideShorts: false, hideScheduled: false, hidePlayables: false, iconOnThumbnail: false };
  let cache = {};
  let observer = null;
  let debounceTimer = null;
  let driftInterval = null;
  let scrollCutoff = false;
  let selfCacheWrite = false;
  let initialScanDone = false;
  let watchInterval = null;
  const dismissed = new Map();

  // ── Locale patterns ──────────────────────────────────────────
  // Maps language codes to YouTube UI text (case-insensitive substring match).
  // When adding a locale: add entries here and in _locales/{code}/messages.json.

  function localeRE(map, wrap = s => s) {
    return new RegExp(wrap(Object.values(map).flat().join('|')), 'i');
  }

  const MOST_RELEVANT_RE = localeRE({
    en: 'most relevant',    es: 'más relevantes',       fr: 'les plus pertinentes',
    de: 'Relevanteste',     id: 'paling relevan',       pt: 'mais relevantes',
    tr: 'en alakalı',       sv: 'mest relevant',        vi: 'Phù hợp nhất',
    ja: '関連が強い',       ko: '관련성',               zh: '最相关',
    ar: 'الأكثر صلة',      ru: 'Самые актуальные',
    hi: 'काम के वीडियो',   bn: 'প্রাসঙ্গিক',          mr: 'सर्वात सुसंबद्ध',
    th: 'เกี่ยวข้องที่สุด', ta: 'மிகவும் தொடர்புடையவை', te: 'మరింత సందర్భోచితమైనవి',
  });

  const SHORTS_RE = localeRE({ en: 'shorts', ja: 'ショート' });

  const STREAMED_RE = localeRE({
    en: 'streamed',         es: 'emitido',              fr: 'diffusé',
    de: 'gestreamt',        id: 'disiarkan',            pt: 'transmitido',
    tr: 'canlı yayın',     sv: 'strömmade',
    ja: 'ライブ配信',       ko: ['실시간 스트리밍', '스트리밍 시간'],      zh: '直播',
    ar: 'بث مباشر',         ru: 'трансляция',
    hi: 'लाइव स्ट्रीम',    bn: 'লাইভ স্ট্রিম',        mr: 'लाइव्ह स्ट्रीम',
    th: 'ถ่ายทอดสด',        ta: 'நேரலை',                te: 'ప్రత్యక్ష ప్రసారం',
  }, s => `^(${s})\\s*`);

  const AGO_RE = localeRE({
    en: 'ago',      es: 'hace',     fr: 'il y a',   de: 'vor',      id: 'yang lalu',
    pt: 'há',       tr: 'önce',     sv: 'sedan',    vi: 'trước',
    ja: '前',       ko: '전',       zh: '前',
    ar: 'قبل',      ru: 'назад',
    hi: 'पहले',     bn: 'আগে',      mr: 'पूर्वी',
    th: 'ที่ผ่านมา', ta: 'முன்',     te: 'క్రితం',
  });

  const TIME_UNITS = [
    // seconds
    { days: 0, re: localeRE({
      en: 'second',   es: 'segund',   fr: 'seconde',  de: 'Sekunde',  id: 'detik',
      tr: 'saniye',   sv: 'sekund',
      ja: '秒',       ko: '초',       zh: '秒',
      ar: 'ثاني',     ru: 'секунд',
      hi: 'सेकंड',    bn: 'সেকেন্ড',  mr: 'सेकंद',
      th: 'วินาที',   ta: 'நொடி',     te: 'సెకన్',
    })},
    // minutes
    { days: 0, re: localeRE({
      en: 'minute',   es: 'minuto',   fr: ['minute', '\\bmin\\b'],   de: ['Minute', 'Min\\.'],   id: 'menit',
      pt: ['minuto', 'min\\.'],   tr: ['dakika', 'dk\\.'],   sv: 'minut',    vi: 'phút',
      ja: '分',       ko: '분',
      ar: 'دق',       ru: ['минут', 'мин\\.'],
      hi: ['मिनट', 'मि॰'],     bn: 'মিনিট',    mr: ['मिनिट', 'मिनि\\.'],
      th: 'นาที',     ta: ['நிமிட', 'நிமி\\.'],    te: ['నిమిషా', 'నిమి'],
    })},
    // hours
    { days: 0, re: localeRE({
      en: ['hour', '\\dh'],     es: ['hora', '\\sh\\b'],     fr: ['heure', '\\sh\\b'],    de: ['Stunde', 'Std\\.'],   id: 'jam', pt: ['hora', '\\sh\\b'],
      tr: ['saat', 'sa\\.'],     sv: ['timm', '\\btim\\b'],     vi: 'giờ',
      ja: '時間',     ko: '시간',     zh: '小时',
      ar: 'ساع',      ru: ['час', 'ч'],
      hi: ['घंट', 'घं'],      bn: 'ঘণ্টা',    mr: 'तास',
      th: 'ชั่วโมง',  ta: ['மணி', 'ம\\.'],      te: ['గంట', 'గం'],
    })},
    // days
    { days: 1, re: localeRE({
      en: ['day', '\\dd'],      es: ['día', '\\bd\\b'],      fr: 'jour',     de: 'Tag',      id: 'hari',
      pt: 'dia',      tr: 'gün',      sv: 'dag',
      ja: '日',       ko: '일',
      ar: 'يوم',      ru: 'дн',
      hi: 'दिन',      bn: 'দিন',      mr: 'दिवस',
      th: 'วัน',      ta: 'நாள்',     te: 'రోజు',
    })},
    // weeks
    { days: 7, re: localeRE({
      en: 'week',     es: 'semana',   fr: 'semaine',  de: 'Woche',    id: 'minggu',
      pt: 'semana',   tr: 'hafta',    sv: 'veck',
      ja: '週',       ko: '주',
      ar: 'أسبوع',    ru: 'недел',
      hi: 'हफ़्त',     bn: 'সপ্তাহ',   mr: 'आठवडा',
      th: 'สัปดาห์',  ta: 'வாரம்',    te: 'వారం',
    })},
    // months
    { days: 30, re: localeRE({
      en: 'month',    es: 'mes',      fr: 'mois',     de: 'Monat',    id: 'bulan',
      pt: 'mês',      tr: 'ay',       sv: 'månad',
      ja: 'か月',     ko: '개월',
      ar: 'شهر',      ru: 'месяц',
      hi: 'महीन',     bn: 'মাস',      mr: 'महिना',
      th: 'เดือน',    ta: 'மாதம்',    te: 'నెల',
    })},
    // years
    { days: 365, re: localeRE({
      en: 'year',     es: 'año',      fr: 'an ',      de: 'Jahr',     id: 'tahun',
      pt: 'ano',      tr: 'yıl',      sv: 'år',       vi: 'năm',
      ja: '年',       ko: '년',
      ar: 'سنة',      ru: 'год',
      hi: 'साल',      bn: 'বছর',      mr: 'वर्ष',
      th: 'ปี',       ta: 'ஆண்டு',    te: 'సంవత్సరం',
    })},
  ];

  const VIEW_WATCHING_RE = localeRE({
    en: ['view', 'watching', 'scheduled'],
    es: ['visualizaci', 'usuarios'],    fr: ['vues', 'spectateur'],
    de: ['Aufrufe', 'Zuschauer'],       id: ['ditonton', 'menonton'],
    pt: ['visualizaç', 'assistindo'],   tr: ['görüntüleme', 'izliyor'],
    sv: ['visning', 'tittare'],         vi: 'xem',
    ja: '視聴',     ko: ['시청', '조회'],   zh: '观看',
    ar: 'مشاهد',    ru: ['просмотр', 'Зрител'],
    hi: ['व्यू', 'दर्शक'],              bn: ['ভিউ', 'দেখছেন'],     mr: ['व्ह्यू', 'पाहत'],
    th: ['การดู', 'ดูอยู่'],            ta: ['பார்வை', 'பார்க்கிறார்'],
    te: ['వీక్షణ', 'చూస్తున్నారు'],
  });


  function isContextValid() {
    return !!chrome.runtime?.id;
  }

  async function init() {
    try {
      const [syncData, localData] = await Promise.all([
        chrome.storage.sync.get({ enabled: true, threshold: 15, maxAgeDays: 0, hideMostRelevant: true, hideShorts: false, hideScheduled: false, hidePlayables: false, iconOnThumbnail: false }),
        chrome.storage.local.get({ cache: {} }),
      ]);
      config = { enabled: syncData.enabled, threshold: syncData.threshold, maxAgeDays: syncData.maxAgeDays, hideMostRelevant: syncData.hideMostRelevant, hideShorts: syncData.hideShorts, hideScheduled: syncData.hideScheduled, hidePlayables: syncData.hidePlayables, iconOnThumbnail: syncData.iconOnThumbnail };
      cache = localData.cache;
      manageCacheSize();
    } catch (e) {
      // defaults already set
    }

    document.addEventListener('yt-navigate-finish', onNavigate);
    document.addEventListener('yt-page-data-updated', onNavigate);
    // Closing a watch tab fires no yt-navigate event, so the last position would
    // otherwise be lost. Best effort — the write may not flush before teardown,
    // but the threshold crossing was already recorded by the poll.
    window.addEventListener('pagehide', () => flushWatchProgress());
    chrome.storage.onChanged.addListener(onStorageChange);
    chrome.runtime.onMessage.addListener(onMessage);

    onNavigate();
  }

  function isTargetPage() {
    const path = location.pathname;
    if (path === '/' || path === '') return true;
    if (/^\/feed\/subscriptions(\/shorts)?\/?$/.test(path)) return true;
    if (/^\/@[^/]+(\/videos|\/streams|\/shorts)?\/?$/.test(path)) return true;
    if (/^\/(channel|c|user)\/[^/]+(\/videos|\/streams|\/shorts)?\/?$/.test(path)) return true;
    return false;
  }

  function isSubscriptionsPage() {
    return location.pathname.startsWith('/feed/subscriptions');
  }

  function isShortsWatchPage() {
    return /^\/shorts\/[^/]+\/?$/.test(location.pathname);
  }

  function isWatchPage() {
    return /^\/watch\/?$/.test(location.pathname) || isShortsWatchPage();
  }

  function onNavigate() {
    scrollCutoff = false;
    initialScanDone = false;
    dismissed.clear();
    removeAgeCutoffBanner();
    // Credit the video being left. This reads the accumulator, not the URL, so
    // it still names the outgoing video even though the URL already changed.
    flushWatchProgress();
    if (isTargetPage()) {
      stopWatchReporter();
      attachObserver();
      startDriftCheck();
      scheduleScan();
    } else if (isWatchPage()) {
      detachObserver();
      stopDriftCheck();
      startWatchReporter();
      // Bind to the new player now rather than waiting up to a poll interval —
      // a 15s Short can be half over by then.
      syncWatchTracker();
    } else {
      detachObserver();
      stopDriftCheck();
      stopWatchReporter();
      cleanupDOM();
    }
  }

  function onStorageChange(changes, area) {
    if (area === 'sync') {
      if (changes.enabled) {
        config.enabled = changes.enabled.newValue;
        // Drop the age cutoff too, or infinite scroll stays severed while off.
        if (!config.enabled) {
          scrollCutoff = false;
          removeAgeCutoffBanner();
        }
      }
      if (changes.threshold) config.threshold = changes.threshold.newValue;
      if (changes.maxAgeDays) {
        config.maxAgeDays = changes.maxAgeDays.newValue;
        scrollCutoff = false;
        removeAgeCutoffBanner();
      }
      if (changes.hideMostRelevant) config.hideMostRelevant = changes.hideMostRelevant.newValue;
      if (changes.hideShorts) config.hideShorts = changes.hideShorts.newValue;
      if (changes.hideScheduled) config.hideScheduled = changes.hideScheduled.newValue;
      if (changes.hidePlayables) config.hidePlayables = changes.hidePlayables.newValue;
      if (changes.iconOnThumbnail) {
        config.iconOnThumbnail = changes.iconOnThumbnail.newValue;
        document.querySelectorAll('.hw-mark-btn, .hw-mark-btn-short').forEach(b => b.remove());
      }
      if (isTargetPage()) scheduleScan();
    }
    if (area === 'local' && changes.cache) {
      if (selfCacheWrite) {
        selfCacheWrite = false;
      } else {
        const incoming = changes.cache.newValue || {};
        let preserved = false;
        for (const id in cache) {
          if (typeof cache[id] === 'number' && typeof incoming[id] !== 'number') {
            incoming[id] = cache[id];
            preserved = true;
          }
        }
        cache = incoming;
        if (preserved) {
          selfCacheWrite = true;
          chrome.storage.local.set({ cache });
        }
        if (isTargetPage()) scheduleScan();
      }
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
      // Only a visible, unwatched video is missing a button it could actually
      // take. Items hidden for another reason (age, scheduled, playables) have
      // theirs stripped on purpose, and some renderers can never mount one.
      if (!watched && !hidden && !hasBtn && canMountMarkButton(el, id)) return true;
    }
    return false;
  }

  function checkInlinePreview() {
    if (!config.enabled || !initialScanDone) return;
    const video = document.querySelector('#inline-preview-player video');
    if (!video || !video.duration || isNaN(video.duration) || !isFinite(video.duration) || video.paused) return;
    const pct = (video.currentTime / video.duration) * 100;
    if (pct <= 0 || (config.threshold > 1 && pct < config.threshold)) return;

    const link = document.querySelector('#media-container-link');
    const href = link?.getAttribute('href');
    const m = href?.match(/[?&]v=([^&#]+)/) || href?.match(/\/shorts\/([^?&#]+)/);
    const id = m?.[1];
    if (!id || typeof cache[id] === 'number') return;
    if (dismissed.has(id) && pct <= dismissed.get(id) + 5) return;

    const renderer = document.querySelector(`a[href*="${id}"]`)?.closest(VIDEO_SELECTOR);
    if (!renderer || renderer.classList.contains('hw-hidden') || renderer.classList.contains('hw-manual-hide')) return;

    const badge = renderer.querySelector('.ytBadgeShapeText');
    if (badge && !/^\d[\d:.]*$/.test(badge.textContent.trim())) return;

    dismissed.delete(id);
    cache[id] = { t: Date.now(), p: pct };
    selfCacheWrite = true;
    chrome.storage.local.set({ cache });
    showUndoCard(renderer, id, () => {
      delete cache[id];
      selfCacheWrite = true;
      chrome.storage.local.set({ cache });
      dismissed.set(id, pct);
    });
  }

  // ── Watch-page progress reporter ────────────────────────────
  // The feed only learns "watched" from progress bars present at scan time, so a
  // video watched on a watch page (especially in another tab) never reaches it —
  // measured on a live feed: after watching 71% of a video, the open feed's
  // thumbnail gained no progress bar at all, so there is nothing for scan() to
  // observe. Writing to the cache here is the only mechanism; the existing
  // chrome.storage.onChanged handler then rescans every open feed tab.

  function watchPageVideoId() {
    const m = location.pathname.match(/^\/shorts\/([^/?&#]+)/);
    if (m) return m[1];
    return new URLSearchParams(location.search).get('v');
  }

  // ORDER IS LOAD-BEARING. A signed-in Shorts page carries BOTH players at once:
  // #shorts-player, holding the real video, and #movie_player, holding a decoy
  // that is permanently paused at t=0 with duration NaN, readyState 0 and no
  // source. Querying #movie_player first therefore finds an element, reads NaN
  // for duration, and returns -1 forever — the whole feature silently does
  // nothing, which is exactly what shipped. Measured on a live signed-in Short
  // via verify-shorts.js.
  //
  // #movie_player stays as the fallback because it is the real player on /watch.
  // Not worth matching ytd-reel-video-renderer[is-active]: that attribute was
  // absent on every sample (activeReels: 0), and only one #shorts-player exists
  // at a time, so it would be a branch that never fires.
  function watchPlayerVideo() {
    return document.querySelector('#shorts-player video')
        || document.querySelector('#movie_player video');
  }

  // Returns percent watched, or -1 when it cannot be trusted.
  function watchPagePercent() {
    const video = watchPlayerVideo();
    if (!video) return -1;
    // During an ad the <video> element IS the ad, with the ad's own short
    // duration — polling it would mark the video watched seconds in. Ask the
    // player that owns this video, not a fixed id that may not be the one
    // playing.
    const player = video.closest('.html5-video-player');
    if (player && player.classList.contains('ad-showing')) return -1;
    const d = video.duration;
    // Live streams report Infinity/NaN; percent watched is meaningless there.
    if (!d || isNaN(d) || !isFinite(d)) return -1;
    if (!video.currentTime) return -1;
    return (video.currentTime / d) * 100;
  }

  // The stored percentage is the dedupe: the first crossing writes, and after
  // that only a materially higher position does. Without this, onNavigate fires
  // on every yt-page-data-updated (many times per watch page) and each poll
  // would issue a storage write, which every open tab then reacts to.
  const WATCH_REFINE_STEP = 10;

  // Shorts loop, so position is not monotonic and a 5s poll cannot see a
  // crossing at all: a 15s Short sampled every 5s reads 33%, 66%, then 0% again
  // forever, never the 80% the threshold wants. So progress is accumulated as a
  // high-water mark driven by timeupdate (~4Hz) rather than sampled, and a lap
  // of the loop is recorded as a complete view no matter where the needle sits
  // when the user swipes away.
  //
  // A lap is "was near the end, now near the start". Deliberately NOT suppressed
  // by seeking/seeked: YouTube may implement the loop as a seek to 0, which
  // would make those events swallow the very signal being looked for. The only
  // false positive is a manual scrub from near-end back to the start, which
  // implies a high-water mark past the threshold anyway.
  const LAP_END_PCT = 80;
  const LAP_START_PCT = 25;
  const WATCH_WRITE_MIN_MS = 2000;
  let watchLastWriteAt = 0;

  let watchVideoEl = null;
  let watchTrackedId = null;
  let watchMaxPct = 0;
  let watchLastPct = -1;
  let watchLapped = false;
  // Shorts always start at 0, so a high first reading means the outgoing video's
  // element is still mounted under the new URL. Ignore until playback is
  // genuinely at the start, or the swiped-past Short's position gets credited to
  // the Short just swiped to.
  let watchAwaitingStart = false;

  function resetWatchAccumulator(id) {
    // Only guard against staleness when displacing another tracked video — that
    // is the case where the old element can still be mounted. Landing on a
    // Short cold has no outgoing video to confuse us, and demanding a start
    // there would throw away the whole first pass whenever the poll binds late.
    const displacing = watchTrackedId !== null && id !== null;
    watchTrackedId = id;
    watchMaxPct = 0;
    watchLastPct = -1;
    watchLapped = false;
    watchAwaitingStart = displacing && isShortsWatchPage();
  }

  // Binds to whichever <video> the player currently owns. Idempotent, and cheap
  // enough to call from the poll as a safety net for element swaps.
  function syncWatchTracker() {
    const el = isWatchPage() ? watchPlayerVideo() : null;
    if (el === watchVideoEl) return;
    if (watchVideoEl) {
      watchVideoEl.removeEventListener('timeupdate', sampleWatchProgress);
      watchVideoEl.removeEventListener('ended', onWatchEnded);
    }
    watchVideoEl = el;
    if (!el) return;
    el.addEventListener('timeupdate', sampleWatchProgress);
    // Never fires on Shorts: they play with video.loop = true (measured), and
    // the loop attribute suppresses 'ended' entirely. That is precisely why the
    // lap heuristic exists rather than this listener. Kept for /watch, where a
    // video really does end.
    el.addEventListener('ended', onWatchEnded);
  }

  function onWatchEnded() {
    if (watchTrackedId && !watchAwaitingStart) {
      watchLapped = true;
      writeWatchProgress(true);
    }
  }

  // Folds the player's current position into the accumulator for the id in the
  // URL, switching accumulators (and crediting the old id) when it changes.
  function sampleWatchProgress() {
    if (!config.enabled || !isContextValid()) return;
    const id = watchPageVideoId();
    if (!id) return;
    if (id !== watchTrackedId) {
      // Credit the outgoing id before the accumulator is reused. Must be the
      // bare write, not flushWatchProgress() — that re-enters this function.
      writeWatchProgress();
      resetWatchAccumulator(id);
    }

    const pct = watchPagePercent();
    if (pct < 0) return;

    if (watchAwaitingStart) {
      if (pct > LAP_START_PCT) return;
      watchAwaitingStart = false;
    }
    if (watchLastPct >= LAP_END_PCT && pct <= LAP_START_PCT) watchLapped = true;
    watchLastPct = pct;
    if (pct > watchMaxPct) watchMaxPct = pct;

    writeWatchProgress();
  }

  // Writes the accumulator out. Safe to call at any time — it names the tracked
  // id, never the URL, so it stays correct after a navigation. `force` skips the
  // rate limit for the last write before a video is left.
  function writeWatchProgress(force) {
    if (!config.enabled || !isContextValid()) return;
    const id = watchTrackedId;
    if (!id) return;

    // A completed lap is a full view regardless of where playback sits now.
    const pct = watchLapped ? 100 : watchMaxPct;
    if (pct <= 0) return;

    const crossed = config.threshold <= 1 ? pct > 0 : pct >= config.threshold;
    if (!crossed) return;

    const entry = cache[id];
    // A manual mark is a stronger statement than measured progress.
    if (typeof entry === 'number') return;
    const prev = entry ? entry.p : -1;
    // Refine in steps so a long video costs a handful of writes, not one per
    // timeupdate. A higher stored percentage matters if the user later raises
    // the threshold — p:16 would wrongly unhide a video watched to the end.
    // A lap always earns its write, so a Short that looped at p:95 still
    // records the 100 that no later threshold can undo.
    const refines = prev < 0 || pct > prev + WATCH_REFINE_STEP || (pct >= 100 && prev < 100);
    if (!refines) return;
    // The percentage ladder alone paced writes fine at one poll per 5s, but
    // timeupdate runs ~4Hz: a 15s Short would climb the whole ladder in one
    // pass and rewrite the entire cache — up to 7MB — nine times in fifteen
    // seconds, broadcasting a rescan to every open feed tab each time.
    if (!force && Date.now() - watchLastWriteAt < WATCH_WRITE_MIN_MS) return;

    watchLastWriteAt = Date.now();
    cache[id] = { t: Date.now(), p: pct };
    selfCacheWrite = true;
    chrome.storage.local.set({ cache });
  }

  function flushWatchProgress() {
    sampleWatchProgress();
    writeWatchProgress(true);
  }

  function startWatchReporter() {
    // Idempotent. timeupdate does the real work; the poll only rebinds the
    // tracker when the player swaps its <video> out, and keeps long videos
    // recorded if timeupdate is throttled in a background tab.
    if (watchInterval) return;
    watchInterval = setInterval(() => {
      if (!isContextValid()) { stopWatchReporter(); return; }
      syncWatchTracker();
      sampleWatchProgress();
    }, WATCH_POLL_MS);
  }

  function stopWatchReporter() {
    if (watchInterval) {
      clearInterval(watchInterval);
      watchInterval = null;
    }
    syncWatchTracker();
    resetWatchAccumulator(null);
  }

  function startDriftCheck() {
    stopDriftCheck();
    driftInterval = setInterval(() => {
      if (!isContextValid()) { stopDriftCheck(); detachObserver(); cleanupDOM(); return; }
      checkInlinePreview();
      if (isDrifted()) {
        if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
        scan();
      }
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
    if (!isContextValid()) return;
    if (!isTargetPage()) return;
    if (scrollCutoff) {
      removeContinuation();
    }
    const items = document.querySelectorAll(VIDEO_SELECTOR);
    hideMostRelevantSection();
    items.forEach(processVideo);
    initialScanDone = true;
    if (config.enabled) expandShortsIfNeeded();
    pruneEmptySections();
    if (config.maxAgeDays && isSubscriptionsPage()) checkAgeCutoff();
  }

  function expandShortsIfNeeded() {
    document.querySelectorAll(SECTION_SELECTOR).forEach((sec) => {
      if (sec.dataset.hwExpanded) return;

      const title = sec.querySelector('h2, #title');
      if (!title || !SHORTS_RE.test(title.textContent.trim())) return;

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
      // config.enabled gates these too — otherwise a force-hidden section stays
      // hidden after the user turns the extension off, and cleanupDOM() skips
      // anything carrying hwForceHidden.
      if (MOST_RELEVANT_RE.test(text)) shouldHide = config.enabled && config.hideMostRelevant;
      else if (SHORTS_RE.test(text)) shouldHide = config.enabled && config.hideShorts;
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
    const t = text.replace(STREAMED_RE, '').replace(/[​-‏﻿]/g, '');
    if (!AGO_RE.test(t)) return -1;
    const numMatch = t.match(/(\d+)/);
    if (!numMatch) return -1;
    const n = parseInt(numMatch[1], 10);
    for (const unit of TIME_UNITS) {
      if (unit.re.test(t)) return n * unit.days;
    }
    return -1;
  }

  // Returns -1 when no age can be determined.
  //
  // Shorts always return -1: their lockups carry only a view count, no upload
  // age, in any locale. Verified against a live Subscriptions feed — every
  // renderer that failed to parse was a Short (602/608 parsed; all 6 misses
  // were Shorts). Consequence: isTooOld() is always false for a Short, so the
  // Subscriptions max-age cutoff can never hide one. This is a DOM limitation,
  // not a locale gap — do not try to fix it by adding TIME_UNITS patterns.
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

  const UPCOMING_RE = localeRE({
    en: 'upcoming',         es: 'próximamente',     fr: 'à venir',
    de: ['Anstehend', 'demnächst'], id: ['Mendatang', 'akan datang'], pt: 'em breve',
    tr: 'yakında',          sv: 'kommande',         vi: 'sắp diễn ra',
    ja: '配信予定',         ko: '예정',             zh: '即将开始',
    ar: 'قادم',             ru: 'скоро',
    hi: ['जल्द ही लाइव होने वाला', 'आगामी'], bn: 'আসন্ন', mr: 'आगामी',
    th: ['เร็วๆ นี้', 'กำลังจะมีขึ้น'], ta: 'வரவிரு', te: 'రాబో',
  });

  const SCHEDULED_RE = localeRE({
    en: 'scheduled for',    es: 'programado',       fr: 'planifié',
    de: 'geplant',          id: 'dijadwalkan',      pt: 'agendado',
    tr: 'planlanmış',       sv: 'schemalagd',       vi: 'đã lên lịch',
    ja: '予定',             ko: '예정',             zh: '排期',
    ar: 'مجدول',            ru: 'запланир',
    hi: 'शेड्यूल',          bn: 'নির্ধারিত',        mr: 'नियोजित',
    th: 'กำหนดเวลา',        ta: 'திட்டமிட',         te: 'షెడ్యూల్',
  });

  function isPlayable(el) {
    return !!el.querySelector('ytd-mini-game-card-view-model');
  }

  function isScheduled(el) {
    const badges = el.querySelectorAll('.ytBadgeShapeText');
    for (const badge of badges) {
      if (UPCOMING_RE.test(badge.textContent.trim())) return true;
    }
    if (el.querySelector('[overlay-style="UPCOMING"]')) return true;
    const meta = el.querySelectorAll('.ytContentMetadataViewModelMetadataText, #metadata-line span, .inline-metadata-item');
    for (const span of meta) {
      if (SCHEDULED_RE.test(span.textContent)) return true;
    }
    return false;
  }

  function isWatched(el, id) {
    if (id && cache[id]) {
      const entry = cache[id];
      if (typeof entry === 'number') return true;
      if (entry.p >= config.threshold || config.threshold <= 1) return true;
    }
    if (el.querySelector('yt-thumbnail-overlay-full-view-model')) return true;

    const progress = getProgressWidth(el);
    if (progress < 0) return false;

    if (config.threshold <= 1) return true;
    return progress >= config.threshold;
  }

  function processVideo(el) {
    if (el.classList.contains('hw-manual-hide')) return;
    const id = extractVideoId(el);

    // Every hide below is gated on config.enabled so that turning the extension
    // off restores the page. The matching "if (el.dataset.hw*)" branch then
    // unhides on the next scan.
    if (config.enabled && isTooOld(el)) {
      el.classList.add('hw-hidden');
      el.dataset.hwAgeHidden = '1';
      el.querySelectorAll('.hw-mark-btn, .hw-mark-btn-short').forEach(b => b.remove());
      return;
    }

    if (el.dataset.hwAgeHidden) {
      delete el.dataset.hwAgeHidden;
      el.classList.remove('hw-hidden');
    }

    if (config.enabled && config.hidePlayables && isPlayable(el)) {
      el.classList.add('hw-hidden');
      el.dataset.hwPlayableHidden = '1';
      return;
    }

    if (el.dataset.hwPlayableHidden) {
      delete el.dataset.hwPlayableHidden;
      el.classList.remove('hw-hidden');
    }

    if (config.enabled && config.hideScheduled && isScheduled(el)) {
      el.classList.add('hw-hidden');
      el.dataset.hwScheduledHidden = '1';
      el.querySelectorAll('.hw-mark-btn, .hw-mark-btn-short').forEach(b => b.remove());
      return;
    }

    if (el.dataset.hwScheduledHidden) {
      delete el.dataset.hwScheduledHidden;
      el.classList.remove('hw-hidden');
    }

    if (id && dismissed.has(id)) {
      el.classList.remove('hw-hidden');
      ensureMarkButton(el, id);
      return;
    }

    if (isWatched(el, id)) {
      if (id && typeof cache[id] !== 'number') {
        const p = getProgressWidth(el);
        const detected = p >= 0 ? p : (el.querySelector('yt-thumbnail-overlay-full-view-model') ? 100 : -1);
        const prevP = cache[id]?.p ?? -1;
        if (detected >= 0 && detected > prevP) {
          cache[id] = { t: Date.now(), p: detected };
          selfCacheWrite = true;
          chrome.storage.local.set({ cache });
        }
      }
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

  // Renderers ensureMarkButton() could not attach to, keyed by the id we tried.
  // Playables, posts and not-yet-hydrated cards have no id and no mount point;
  // without this the drift checker would rescan every 2s forever. Storing the
  // id means a recycled or hydrated renderer gets retried.
  const unmountable = new WeakMap();

  function canMountMarkButton(el, id) {
    return !unmountable.has(el) || unmountable.get(el) !== id;
  }

  function isShortRenderer(el) {
    return !!el.querySelector('ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2');
  }

  function ensureMarkButton(el, id) {
    if (el.querySelector('.hw-mark-btn, .hw-mark-btn-short')) return;
    if (!id) {
      unmountable.set(el, id);
      return;
    }

    const isShort = isShortRenderer(el);

    const btn = document.createElement('button');
    btn.title = chrome.i18n.getMessage('markAsWatched');
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      markWatched(el, id);
    });

    function createEyeIcon() {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', '20');
      svg.setAttribute('height', '20');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('fill', 'currentColor');
      path.setAttribute('d', 'M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 001 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z');
      svg.appendChild(path);
      return svg;
    }

    if (isShort) {
      const subhead = el.querySelector('.shortsLockupViewModelHostOutsideMetadataSubhead');
      if (subhead) {
        btn.className = 'hw-mark-btn-short';
        btn.appendChild(createEyeIcon());
        subhead.appendChild(btn);
        unmountable.delete(el);
        return;
      }
    }

    if (!config.iconOnThumbnail) {
      let metadataLine = el.querySelector('#metadata-line');
      if (!metadataLine) {
        const metaTexts = el.querySelectorAll('.ytContentMetadataViewModelMetadataText');
        for (const span of metaTexts) {
          if (VIEW_WATCHING_RE.test(span.textContent)) {
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
      if (!metadataLine) {
        const rows = el.querySelectorAll('.ytContentMetadataViewModelMetadataRow');
        if (rows.length) metadataLine = rows[rows.length - 1];
      }
      if (metadataLine) {
        btn.className = 'hw-mark-btn-short';
        btn.appendChild(createEyeIcon());
        metadataLine.appendChild(btn);
        if (metadataLine.scrollWidth > metadataLine.clientWidth + 4) {
          const parent = metadataLine.parentElement;
          if (parent) {
            btn.remove();
            parent.insertBefore(btn, metadataLine.nextSibling);
          }
        }
        unmountable.delete(el);
        return;
      }
    }

    {
      const container =
        el.querySelector('yt-thumbnail-view-model') ||
        el.querySelector('ytd-thumbnail') ||
        el.querySelector('#thumbnail');
      if (!container) {
        unmountable.set(el, id);
        return;
      }
      container.style.position = 'relative';
      btn.className = 'hw-mark-btn';
      btn.appendChild(createEyeIcon());
      container.appendChild(btn);
      unmountable.delete(el);
    }
  }

  function showUndoCard(el, id, onUndo) {
    el.querySelectorAll('.hw-mark-btn, .hw-mark-btn-short').forEach(b => b.remove());
    el.classList.add('hw-manual-hide');

    const card = document.createElement('div');
    card.className = 'hw-undo-card';
    const undoText = document.createElement('span');
    undoText.className = 'hw-undo-text';
    undoText.textContent = chrome.i18n.getMessage('videoHidden');
    const undoBtn = document.createElement('button');
    undoBtn.className = 'hw-undo-btn';
    undoBtn.textContent = chrome.i18n.getMessage('undo');
    card.append(undoText, undoBtn);
    el.appendChild(card);

    let undone = false;

    undoBtn.addEventListener('click', () => {
      if (undone) return;
      undone = true;
      onUndo();
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

  function markWatched(el, id) {
    cache[id] = Date.now();
    selfCacheWrite = true;
    chrome.storage.local.set({ cache });
    manageCacheSize();
    showUndoCard(el, id, () => {
      delete cache[id];
      selfCacheWrite = true;
      chrome.storage.local.set({ cache });
      dismissed.set(id, 0);
    });
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
    const dayUnit = config.maxAgeDays === 1 ? chrome.i18n.getMessage('dayUnit') : chrome.i18n.getMessage('daysUnit');
    banner.textContent = chrome.i18n.getMessage('ageCutoff', [String(config.maxAgeDays), dayUnit]);
    grid.parentElement.insertBefore(banner, grid.nextSibling);
  }

  function removeAgeCutoffBanner() {
    document.querySelectorAll('.hw-age-cutoff-banner').forEach((e) => e.remove());
  }

  function onMessage(msg, sender, sendResponse) {
    if (sender.id !== chrome.runtime.id) return;
    if (msg.action === 'markAllWatched') {
      const count = markAllVisible();
      sendResponse({ count });
    }
    if (msg.action === 'getHiddenCount') {
      sendResponse({ count: document.querySelectorAll('.hw-hidden').length });
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
      selfCacheWrite = true;
    chrome.storage.local.set({ cache });
      manageCacheSize();
      pruneEmptySections();
    }
    return count;
  }

  function manageCacheSize() {
    if (Object.keys(cache).length < CACHE_CHECK_COUNT) return;
    const size = JSON.stringify(cache).length;
    if (size <= CACHE_EVICT_BYTES) return;
    const ts = v => typeof v === 'number' ? v : v.t;
    const entries = Object.entries(cache).sort((a, b) => ts(a[1]) - ts(b[1]));
    const bytesPerEntry = size / entries.length;
    const entriesToRemove = Math.ceil((size - CACHE_TARGET_BYTES) / bytesPerEntry);
    for (let i = 0; i < entriesToRemove && i < entries.length; i++) {
      delete cache[entries[i][0]];
    }
    selfCacheWrite = true;
    chrome.storage.local.set({ cache });
  }

  function cleanupDOM() {
    document.querySelectorAll('.hw-hidden').forEach((e) =>
      e.classList.remove('hw-hidden')
    );
    document.querySelectorAll('[data-hw-age-hidden]').forEach((e) =>
      delete e.dataset.hwAgeHidden
    );
    document.querySelectorAll('[data-hw-scheduled-hidden]').forEach((e) =>
      delete e.dataset.hwScheduledHidden
    );
    document.querySelectorAll('[data-hw-playable-hidden]').forEach((e) =>
      delete e.dataset.hwPlayableHidden
    );
    // Force-hidden sections are cleared too. This runs when leaving a target
    // page or losing the extension context, so nothing of ours should survive.
    document.querySelectorAll('.hw-section-hidden').forEach((e) => {
      e.classList.remove('hw-section-hidden');
      delete e.dataset.hwForceHidden;
    });
    document.querySelectorAll('.hw-mark-btn, .hw-mark-btn-short, .hw-undo-card').forEach((e) =>
      e.remove()
    );
    scrollCutoff = false;
    removeAgeCutoffBanner();
  }

  init();
})();
