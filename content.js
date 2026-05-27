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
  const CACHE_EVICT_BYTES = 9_500_000;
  const CACHE_TARGET_BYTES = 7_000_000;
  const CACHE_CHECK_COUNT = 200_000;

  let config = { enabled: true, threshold: 5, maxAgeDays: 0, hideMostRelevant: true, hideLatest: true, hideShorts: false, hideScheduled: false, iconOnThumbnail: false };
  let cache = {};
  let observer = null;
  let debounceTimer = null;
  let driftInterval = null;
  let scrollCutoff = false;
  let selfCacheWrite = false;

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

  const LATEST_RE = localeRE({
    en: 'latest',           es: 'más recientes',        fr: 'les plus récentes',
    de: 'neueste',          id: 'terbaru',              pt: 'mais recentes',
    tr: 'Son yüklenenler',  sv: 'senaste',              vi: 'Mới nhất',
    ja: '新しい順',         ko: '최신순',               zh: '最新',
    ar: 'الأحدث',           ru: 'Новые',
    hi: 'नए',               bn: 'লেটেস্ট',             mr: 'अलीकडील',
    th: 'ล่าสุด',           ta: 'சமீபத்தியவை',         te: 'తాజా',
  }, s => `^(${s})$`);

  const SHORTS_RE = localeRE({ en: 'shorts', ja: 'ショート' });

  const STREAMED_RE = localeRE({
    en: 'streamed',         es: 'emitido',              fr: 'diffusé',
    de: 'gestreamt',        id: 'disiarkan',            pt: 'transmitido',
    tr: 'canlı yayın',     sv: 'strömmade',
    ja: 'ライブ配信',       ko: '실시간 스트리밍',      zh: '直播',
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
      en: 'minute',   es: 'minuto',   fr: 'minute',   de: 'Minute',   id: 'menit',
      pt: 'minuto',   tr: 'dakika',   sv: 'minut',    vi: 'phút',
      ja: '分',       ko: '분',
      ar: 'دق',       ru: 'минут',
      hi: 'मिनट',     bn: 'মিনিট',    mr: 'मिनिट',
      th: 'นาที',     ta: 'நிமிட',    te: 'నిమిష',
    })},
    // hours
    { days: 0, re: localeRE({
      en: 'hour',     es: 'hora',     fr: 'heure',    de: 'Stunde',   id: 'jam',
      tr: 'saat',     sv: 'timm',     vi: 'giờ',
      ja: '時間',     ko: '시간',     zh: '小时',
      ar: 'ساع',      ru: 'час',
      hi: 'घंट',      bn: 'ঘণ্টা',    mr: 'तास',
      th: 'ชั่วโมง',  ta: 'மணி',      te: 'గంట',
    })},
    // days
    { days: 1, re: localeRE({
      en: 'day',      es: 'día',      fr: 'jour',     de: 'Tag',      id: 'hari',
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
        chrome.storage.sync.get({ enabled: true, threshold: 5, maxAgeDays: 0, hideMostRelevant: true, hideLatest: true, hideShorts: false, hideScheduled: false, iconOnThumbnail: false }),
        chrome.storage.local.get({ cache: {} }),
      ]);
      config = { enabled: syncData.enabled, threshold: syncData.threshold, maxAgeDays: syncData.maxAgeDays, hideMostRelevant: syncData.hideMostRelevant, hideLatest: syncData.hideLatest, hideShorts: syncData.hideShorts, hideScheduled: syncData.hideScheduled, iconOnThumbnail: syncData.iconOnThumbnail };
      cache = localData.cache;
      manageCacheSize();
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
    if (/^\/@[^/]+(\/videos|\/streams|\/shorts)?\/?$/.test(path)) return true;
    if (/^\/(channel|c|user)\/[^/]+(\/videos|\/streams|\/shorts)?\/?$/.test(path)) return true;
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
      if (changes.hideShorts) config.hideShorts = changes.hideShorts.newValue;
      if (changes.hideScheduled) config.hideScheduled = changes.hideScheduled.newValue;
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
        cache = changes.cache.newValue || {};
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
      if (!watched && !hasBtn) return true;
    }
    return false;
  }

  function startDriftCheck() {
    stopDriftCheck();
    driftInterval = setInterval(() => {
      if (!isContextValid()) { stopDriftCheck(); detachObserver(); cleanupDOM(); return; }
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
    if (!isContextValid()) return;
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
      if (MOST_RELEVANT_RE.test(text)) shouldHide = config.hideMostRelevant;
      else if (LATEST_RE.test(text)) shouldHide = config.hideLatest;
      else if (SHORTS_RE.test(text)) shouldHide = config.hideShorts;
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
    de: 'demnächst',        id: 'akan datang',      pt: 'em breve',
    tr: 'yakında',          sv: 'kommande',         vi: 'sắp diễn ra',
    ja: '配信予定',         ko: '예정',             zh: '即将开始',
    ar: 'قادم',             ru: 'скоро',
    hi: 'आगामी',            bn: 'আসন্ন',            mr: 'आगामी',
    th: 'กำลังจะมีขึ้น',    ta: 'வரவிருக்கிறது',    te: 'రాబోతోంది',
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
    if (id && cache[id]) return true;
    if (el.querySelector('yt-thumbnail-overlay-full-view-model')) return true;

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

    if (config.hideScheduled && isScheduled(el)) {
      el.classList.add('hw-hidden');
      el.dataset.hwScheduledHidden = '1';
      el.querySelectorAll('.hw-mark-btn, .hw-mark-btn-short').forEach(b => b.remove());
      return;
    }

    if (el.dataset.hwScheduledHidden) {
      delete el.dataset.hwScheduledHidden;
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
      btn.appendChild(createEyeIcon());
      container.appendChild(btn);
    }
  }

  function markWatched(el, id) {
    cache[id] = Date.now();
    selfCacheWrite = true;
    chrome.storage.local.set({ cache });
    manageCacheSize();

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
      delete cache[id];
      selfCacheWrite = true;
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
    const entries = Object.entries(cache).sort((a, b) => a[1] - b[1]);
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
