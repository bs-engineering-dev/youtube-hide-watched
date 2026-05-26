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

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const os = require("os");
const readline = require("readline");

const MOST_RELEVANT_RE =
  /most relevant|más relevantes|les plus pertinentes|Relevanteste|paling relevan|関連が強い|관련성|काम के वीडियो|প্রাসঙ্গিক|الأكثر صلة|Самые актуальные|mais relevantes|en alakalı|mest relevant|เกี่ยวข้องที่สุด|மிகவும் தொடர்புடையவை|మరింత సందర్భోచితమైనవి|सर्वात सुसंबद्ध|最相关|Phù hợp nhất|mest relevanta/i;

const LATEST_RE =
  /^(latest|más recientes|les plus récentes|neueste|terbaru|新しい順|최신순|नए|লেটেস্ট|الأحدث|Новые|mais recentes|Son yüklenenler|senaste|ล่าสุด|சமீபத்தியவை|తాజా|अलीकडील|最新|Mới nhất)$/i;

const SHORTS_RE = /shorts|ショート/i;

const STREAMED_RE = /^(streamed|emitido|diffusé|gestreamt|disiarkan|ライブ配信|실시간 스트리밍|लाइव स्ट्रीम|লাইভ স্ট্রিম|بث مباشر|трансляция|transmitido|canlı yayın|strömmade|ถ่ายทอดสด|நேரலை|ప్రత్యక్ష ప్రసారం|लाइव्ह स्ट्रीम|直播)\s*/i;

const TIME_UNITS = [
  { re: /second|segund|seconde|Sekunde|detik|秒|초|सेकंड|সেকেন্ড|ثاني|секунд|sekund|saniye|sekund|วินาที|நொடி|సెకన్|सेकंद/i, days: 0 },
  { re: /minute|minut|Minute|menit|分|분|मिनट|মিনিট|دق|минут|minuto|dakika|minut|นาที|நிமிட|నిమిష|मिनिट|phút/i, days: 0 },
  { re: /hour|hora|heure|Stunde|jam|時間|시간|घंट|ঘণ্টা|ساع|час|saat|timm|ชั่วโมง|மணி|గంట|तास|小时|giờ/i, days: 0 },
  { re: /day|día|jour|Tag|hari|日|일|दिन|দিন|يوم|дн|dia|gün|dag|วัน|நாள்|రోజు|दिवस/i, days: 1 },
  { re: /week|semana|semaine|Woche|minggu|週|주|हफ़्त|সপ্তাহ|أسبوع|недел|semana|hafta|veck|สัปดาห์|வாரம்|వారం|आठवडा/i, days: 7 },
  { re: /month|mes|mois|Monat|bulan|か月|개월|महीन|মাস|شهر|месяц|mês|ay|månad|เดือน|மாதம்|నెల|महिना/i, days: 30 },
  { re: /year|año|an |Jahr|tahun|年|년|साल|বছর|سنة|год|ano|yıl|år|ปี|ஆண்டு|సంవత్సరం|वर्ष/i, days: 365 },
];

// Matches "ago" equivalents — used to distinguish time-ago strings from channel names
const AGO_RE = /ago|hace|il y a|vor|yang lalu|前|전|पहले|আগে|قبل|назад|há|önce|sedan|ที่ผ่านมา|முன்|క్రితం|पूर्वी|trước/i;

// This regex is used in content.js to find the metadata row for button placement
const VIEW_WATCHING_RE = /view|watching|scheduled|visualizaci|usuarios|vues|Aufrufe|Zuschauer|ditonton|menonton|視聴|시청|조회|व्यू|दर्शक|ভিউ|দেখছেন|مشاهد|просмотр|Зрител|visualizaç|assistindo|görüntüleme|izliyor|visning|tittare|การดู|ดูอยู่|பார்வை|பார்க்கிறார்|వీక్షణ|చూస్తున్నారు|व्ह्यू|पाहत|观看|xem/i;

function parseAgeDays(text) {
  if (!text) return -1;
  const t = text.replace(STREAMED_RE, "");
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
        const isView = VIEW_WATCHING_RE.test(raw);
        const isAgo = AGO_RE.test(raw) || STREAMED_RE.test(raw);
        const hasStreamed = STREAMED_RE.test(raw);
        // Skip strings that aren't time-ago or view/watching (e.g. channel names)
        if (parsed < 0 && !isView && !isAgo) continue;
        let status;
        if (parsed >= 0) status = `${parsed} days`;
        else if (isView) status = "VIEW";
        else status = "FAILED";
        timeResults.push({
          hl,
          text: raw,
          streamed: hasStreamed ? "YES" : "",
          parsed: status,
        });
      }

      if (!timeResults.some((r) => r.hl === hl)) {
        timeResults.push({ hl, text: "(no age strings)", streamed: "", parsed: "SKIP" });
      }

      // Check view/watching/scheduled regex against metadata
      // Filter out strings that are age strings (already handled by TIME_UNITS)
      const viewOnly = viewStrings.filter((s) => parseAgeDays(s) < 0);
      let anyViewMatch = false;
      for (const raw of viewOnly) {
        const matched = VIEW_WATCHING_RE.test(raw);
        if (matched) anyViewMatch = true;
        metadataResults.push({ hl, text: raw, viewMatch: matched ? "YES" : "NO" });
      }
      if (!anyViewMatch && viewOnly.length > 0) {
        metadataResults.push({ hl, text: "(NO STRINGS MATCHED)", viewMatch: "FAIL" });
      }

      console.log(`${hl}: ${titles.length} section(s), ${ageStrings.length} age(s), ${viewStrings.length} metadata(s)`);
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

  const sectionFails = sectionResults.filter((r) => r.match === "UNMATCHED");
  const timeFails = timeResults.filter((r) => r.parsed === "FAILED");
  const metadataFails = metadataResults.filter((r) => r.viewMatch === "FAIL");

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

  if (sectionFails.length || timeFails.length || metadataFails.length) {
    process.exit(1);
  } else {
    console.log("\nAll matched!");
  }
})();
