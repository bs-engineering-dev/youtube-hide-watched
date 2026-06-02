// verify-locales.js — Manual verification tool (not part of the extension or CI).
//
// Launches a real browser, signs into Google, then cycles through all 20
// supported YouTube languages via the PREF cookie and checks that:
//   1. Section title regexes (MOST_RELEVANT_RE, LATEST_RE, SHORTS_RE) match
//   2. Video age strings parse correctly through TIME_UNITS
//   3. The VIEW_WATCHING_RE regex finds at least one metadata string per language
//
// Usage:
//   node verify-locales.js
//
// You will be prompted to sign into Google in the browser window that opens.
// After sign-in the script runs unattended (~5 min) and prints a report.
// Requires: playwright (already a dev dependency).
// Creates a temporary Chromium profile in os.tmpdir(); cleaned up on exit.
//
// ── Fixing locale misses ──────────────────────────────────────
// When this script reports failures, fix them by APPENDING new
// patterns to the existing regex maps in BOTH content.js and this
// file. Do NOT replace existing patterns — YouTube shows either
// the full form or the abbreviation depending on context.
//
// Convert the entry to an array if it isn't one already:
//   Before:  tr: 'dakika'
//   After:   tr: ['dakika', 'dk\\.']
//
// For metadata (VIEW_WATCHING_RE) failures, check the "unmatched
// candidates" column to see what YouTube actually rendered, then
// add the distinguishing substring to the map.

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const os = require("os");
const readline = require("readline");

// ── Locale patterns (must match content.js) ─────────────────
// Maps language codes to YouTube UI text (case-insensitive substring match).

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
  ja: 'ライブ配信',       ko: ['실시간 스트리밍', '스트리밍 시간'],      zh: '直播',
  ar: 'بث مباشر',         ru: 'трансляция',
  hi: 'लाइव स्ट्रीम',    bn: 'লাইভ স্ট্রিম',        mr: 'लाइव्ह स्ट्रीम',
  th: 'ถ่ายทอดสด',        ta: 'நேரலை',                te: 'ప్రత్యక్ష ప్రసారం',
}, s => `^(${s})\\s*`);

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
    pt: 'ano',      tr: 'yıl',      sv: 'år',
    ja: '年',       ko: '년',
    ar: 'سنة',      ru: 'год',
    hi: 'साल',      bn: 'বছর',      mr: 'वर्ष',
    th: 'ปี',       ta: 'ஆண்டு',    te: 'సంవత్సరం',
  })},
];

// Matches "ago" equivalents — distinguishes time-ago strings from channel names
const AGO_RE = localeRE({
  en: 'ago',      es: 'hace',     fr: 'il y a',   de: 'vor',      id: 'yang lalu',
  pt: 'há',       tr: 'önce',     sv: 'sedan',    vi: 'trước',
  ja: '前',       ko: '전',       zh: '前',
  ar: 'قبل',      ru: 'назад',
  hi: 'पहले',     bn: 'আগে',      mr: 'पूर्वी',
  th: 'ที่ผ่านมา', ta: 'முன்',     te: 'క్రితం',
});

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

function parseAgeDays(text) {
  if (!text) return -1;
  const t = text.replace(STREAMED_RE, "").replace(/[​-‏﻿]/g, "");
  if (!AGO_RE.test(t)) return -1;
  const numMatch = t.match(/(\d+)/);
  if (!numMatch) return -1;
  const n = parseInt(numMatch[1], 10);
  for (const unit of TIME_UNITS) {
    if (unit.re.test(t)) return n * unit.days;
  }
  return -1;
}

// YouTube hl codes
const YT_LANGS = [
  "en", "es", "fr", "de", "id", "ja", "ko",
  "hi", "bn", "ar", "ru", "pt-BR", "tr", "sv",
  "th", "ta", "te", "mr", "zh-CN", "vi",
];

const PROFILE_DIR = path.join(os.tmpdir(), "yt-locale-verify-profile");
const LAUNCH_ARGS = [
  "--no-first-run",
  "--disable-gpu",
  "--disable-blink-features=AutomationControlled",
];

function waitForEnter(msg) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(msg, () => { rl.close(); resolve(); }));
}

(async () => {
  // Step 1: Log in once and save the profile
  fs.rmSync(PROFILE_DIR, { recursive: true, force: true });

  console.log("Launching browser for login...");
  let browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: LAUNCH_ARGS,
  });

  let page = await browser.newPage();
  await page.goto("https://accounts.google.com", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  console.log("\n=== Sign in to Google in the browser window. Take your time. ===\n");
  await waitForEnter("Press Enter here AFTER you are fully signed in...\n");

  await browser.close();
  console.log("Login saved. Starting locale tests...\n");

  // Step 2: Relaunch, cycle through languages via PREF cookie
  const sectionResults = [];
  const timeResults = [];
  const metadataResults = [];
  const upcomingResults = [];
  const playableResults = [];

  browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: LAUNCH_ARGS,
  });

  page = await browser.newPage();

  for (const hl of YT_LANGS) {
    try {
      // Set YouTube language via PREF cookie
      await browser.addCookies([{
        name: "PREF",
        value: "hl=" + hl,
        domain: ".youtube.com",
        path: "/",
      }]);
      await page.close();
      page = await browser.newPage();

      // --- Playables check (home page) ---
      await page.goto("https://www.youtube.com", {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });

      // dismiss consent
      try {
        const btn = page.locator(
          'button:has-text("Reject all"), button:has-text("Reject the use"), button:has-text("Confirm")'
        );
        await btn.first().click({ timeout: 3000 });
        await page.waitForTimeout(2000);
      } catch {}

      try {
        await page.waitForSelector("ytd-rich-item-renderer", { timeout: 10000 });
        await page.waitForTimeout(2000);
      } catch {}

      const playableInfo = await page.evaluate(() => {
        const cards = document.querySelectorAll("ytd-mini-game-card-view-model");
        const results = [];
        for (const card of cards) {
          const renderer = card.closest("ytd-rich-item-renderer");
          const link = card.querySelector('a[href*="/playables/"]');
          results.push({
            inRenderer: !!renderer,
            hasPlayableLink: !!link,
            href: link ? link.getAttribute("href") : null,
          });
        }
        return results;
      });

      if (playableInfo.length > 0) {
        const allDetectable = playableInfo.every((p) => p.inRenderer);
        playableResults.push({
          hl,
          count: playableInfo.length,
          allInRenderer: allDetectable ? "YES" : "NO",
          sampleHref: playableInfo[0].href || "(none)",
        });
      } else {
        playableResults.push({
          hl,
          count: 0,
          allInRenderer: "N/A",
          sampleHref: "(no playables found)",
        });
      }

      // --- Subscriptions page ---
      await page.goto("https://www.youtube.com/feed/subscriptions", {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });

      // dismiss consent
      try {
        const btn = page.locator(
          'button:has-text("Reject all"), button:has-text("Reject the use"), button:has-text("Confirm")'
        );
        await btn.first().click({ timeout: 3000 });
        await page.waitForTimeout(2000);
      } catch {}

      // wait for videos to render
      try {
        await page.waitForSelector("ytd-rich-item-renderer", { timeout: 10000 });
        await page.waitForTimeout(2000);
      } catch {}

      // --- Section titles ---
      const titles = await page.evaluate(() => {
        const sections = document.querySelectorAll("ytd-rich-section-renderer");
        return Array.from(sections)
          .map((sec) => {
            const title = sec.querySelector("h2") || sec.querySelector("#title");
            return title ? title.textContent.trim() : null;
          })
          .filter(Boolean);
      });

      for (const t of titles) {
        const mr = MOST_RELEVANT_RE.test(t);
        const lt = LATEST_RE.test(t);
        const sh = SHORTS_RE.test(t);
        sectionResults.push({
          hl,
          title: t,
          match: mr ? "MOST_RELEVANT" : lt ? "LATEST" : sh ? "SHORTS" : "UNMATCHED",
        });
      }

      if (titles.length === 0) {
        sectionResults.push({ hl, title: "(no sections)", match: "SKIP" });
      }

      // --- Video age strings + metadata strings ---
      const { ageStrings, viewStrings } = await page.evaluate(() => {
        const videos = document.querySelectorAll(
          "ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer"
        );
        const ages = new Set();
        const views = new Set();
        for (const el of videos) {
          const spans = el.querySelectorAll(
            ".ytContentMetadataViewModelMetadataText, #metadata-line span, .inline-metadata-item, ytd-video-meta-block span"
          );
          for (const span of spans) {
            const text = span.textContent.trim();
            if (!text) continue;
            // age strings contain a number + time unit
            if (/\d/.test(text) && text.length < 60) {
              ages.add(text);
            }
            // view/watching/scheduled strings (for button placement)
            if (/\d/.test(text) && text.length < 40) {
              views.add(text);
            }
          }
          if (ages.size >= 5 && views.size >= 5) break;
        }
        return { ageStrings: [...ages], viewStrings: [...views] };
      });

      for (const raw of ageStrings) {
        const parsed = parseAgeDays(raw);
        const isAgo = AGO_RE.test(raw) || STREAMED_RE.test(raw);
        if (!isAgo || VIEW_WATCHING_RE.test(raw)) continue;
        const hasStreamed = STREAMED_RE.test(raw);
        timeResults.push({
          hl,
          text: raw,
          streamed: hasStreamed ? "YES" : "",
          parsed: parsed >= 0 ? `${parsed} days` : "FAILED",
        });
      }

      if (!timeResults.some((r) => r.hl === hl)) {
        timeResults.push({ hl, text: "(no age strings)", streamed: "", parsed: "SKIP" });
      }

      // Check view/watching regex against metadata spans.
      // Filter out age strings and non-view strings (scheduled, etc.)
      let anyViewMatch = false;
      const unmatchedMeta = [];
      for (const raw of viewStrings) {
        if (parseAgeDays(raw) >= 0) continue;
        const matched = VIEW_WATCHING_RE.test(raw);
        if (!matched) {
          unmatchedMeta.push(raw);
          continue;
        }
        anyViewMatch = true;
        metadataResults.push({ hl, text: raw, viewMatch: "YES" });
      }
      if (!anyViewMatch) {
        metadataResults.push({ hl, text: unmatchedMeta.length ? unmatchedMeta.join(' | ') : "(no candidates)", viewMatch: "FAIL" });
      }

      // --- Upcoming/scheduled badge text (skip video durations) ---
      const badgeTexts = await page.evaluate(() => {
        const badges = new Set();
        for (const el of document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer')) {
          const badge = el.querySelector('yt-thumbnail-badge-view-model');
          if (badge) {
            const text = badge.textContent.trim();
            if (text && !/^\d[\d:.]*$/.test(text)) badges.add(text);
          }
        }
        return [...badges];
      });

      for (const text of badgeTexts) {
        upcomingResults.push({ hl, text, upcomingMatch: UPCOMING_RE.test(text) ? "YES" : "NO" });
      }
      if (badgeTexts.length === 0) {
        upcomingResults.push({ hl, text: "(none found)", upcomingMatch: "SKIP" });
      }

      // --- Scheduled metadata text (from already-collected viewStrings) ---
      for (const text of viewStrings) {
        if (SCHEDULED_RE.test(text)) {
          upcomingResults.push({ hl, text, upcomingMatch: "SCHEDULED" });
        }
      }

      const playableCount = playableInfo.length;
      console.log(`${hl}: ${playableCount} playable(s), ${titles.length} section(s), ${ageStrings.length} age(s), ${viewStrings.length} metadata(s), ${badgeTexts.length} badge(s)`);
    } catch (e) {
      sectionResults.push({ hl, title: "", match: "ERROR: " + e.message });
      console.log(`${hl}: ERROR - ${e.message}`);
    }
  }

  // reset to English
  await browser.addCookies([{
    name: "PREF",
    value: "hl=en",
    domain: ".youtube.com",
    path: "/",
  }]);

  await browser.close();

  // clean up
  fs.rmSync(PROFILE_DIR, { recursive: true, force: true });

  // --- Report ---
  console.log("\n=== SECTION TITLES ===\n");
  console.table(sectionResults);

  console.log("\n=== VIDEO AGE STRINGS ===\n");
  console.table(timeResults);

  console.log("\n=== METADATA VIEW/WATCHING MATCH ===\n");
  console.table(metadataResults);

  console.log("\n=== UPCOMING/SCHEDULED BADGE TEXT ===\n");
  console.table(upcomingResults);

  console.log("\n=== PLAYABLES DETECTION ===\n");
  console.table(playableResults);

  const sectionFails = sectionResults.filter((r) => r.match === "UNMATCHED");
  const timeFails = timeResults.filter((r) => r.parsed === "FAILED");
  const metadataFails = metadataResults.filter((r) => r.viewMatch === "FAIL");
  const playableFails = playableResults.filter((r) => r.count > 0 && r.allInRenderer === "NO");

  if (sectionFails.length) {
    console.warn("\nSECTION FAILURES:");
    sectionFails.forEach((f) => console.warn(`  ${f.hl}: "${f.title}"`));
  }

  if (timeFails.length) {
    console.warn("\nTIME PARSE FAILURES:");
    timeFails.forEach((f) => console.warn(`  ${f.hl}: "${f.text}"`));
  }

  if (metadataFails.length) {
    console.warn("\nMETADATA FAILURES (no view/watching match for language):");
    metadataFails.forEach((f) => console.warn(`  ${f.hl}`));
  }

  if (playableFails.length) {
    console.warn("\nPLAYABLE DETECTION FAILURES (found but not in expected renderer):");
    playableFails.forEach((f) => console.warn(`  ${f.hl}: ${f.count} playable(s)`));
  }

  if (sectionFails.length || timeFails.length || metadataFails.length || playableFails.length) {
    process.exit(1);
  } else {
    console.log("\nAll matched!");
  }
})();
