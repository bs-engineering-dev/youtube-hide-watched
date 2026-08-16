// verify-shorts.js — Manual diagnostic tool (not part of the extension or CI).
//
// The Shorts player page (/shorts/{id}) cannot be reached by the test suite:
// signed out, YouTube serves a stripped-down page whose player never loads a
// media source at all, so nothing about playback can be measured there. This
// script signs in the same way verify-subscriptions.js does and drives the one
// journey that matters end to end:
//
//   pick an unwatched Short showing on the Subscriptions feed and/or the
//   Subscriptions Shorts tab
//     -> open it in another tab and watch it past the threshold
//       -> does it vanish from those feed tabs, which are never reloaded?
//
// That last hop is the whole point of the watch-page progress reporter, and it
// is invisible to the test suite. The feed tabs are opened once and never
// touched again — no reload, no re-navigation — so a disappearance can only
// come from the chrome.storage.onChanged path.
//
// Both Subscriptions surfaces are watched because they are not equivalent. The
// main feed renders Shorts in a shelf alongside normal videos; the Shorts tab
// is nothing but Shorts and its renderers carry no progress bar and no
// timestamp at all, so hiding there rides entirely on the cache. A Short is
// preferred that appears in both, so one viewing proves both at once.
//
// It loads an INSTRUMENTED COPY of the extension from a temp dir (the repo is
// never modified), patched to expose the reporter's own internals — which
// <video> it bound to, every sample it took, and every cache write it made —
// plus the feed's own view of each renderer.
//
// Reports:
//   1. Which player element the reporter resolved, and whether it is the decoy
//      (on a Shorts page #movie_player exists alongside #shorts-player holding
//      a dead video: paused at 0, duration NaN. Reading it returns -1 forever.)
//   2. Every timeupdate sample, the live high-water mark, and each cache write
//   3. Whether the Short reached the cache at all
//   4. Whether the untouched feed tab then hid it, and how long that took
//   5. Whether a COMPLETED LOOP is recorded, and survives the position dropping
//      back to near zero. Shorts play with video.loop = true, so 'ended' never
//      fires and the wrap is the only completion signal there is. This is the
//      one phase that exercises it.
//
// Usage:
//   node verify-shorts.js             # reuses the verify-subscriptions login
//   node verify-shorts.js --fresh     # wipes the profile, logs in again
//   node verify-shorts.js --no-seek   # sit through the loop instead of seeking
//
// You sign in yourself in the browser window that opens; this script never sees
// or stores your password. The profile is shared with verify-subscriptions.js,
// so if you have already run that, you are already signed in.
//
// The run is NOT unattended. It pauses and waits for Enter twice:
//   1. after the feed loads, so you can scroll to bring Shorts into it
//   2. after the Short opens, so you can start playback if it does not autoplay

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const os = require("os");
const readline = require("readline");

const REPO = __dirname;
// Shared with verify-subscriptions.js on purpose: one login serves both tools.
const PROFILE_DIR = path.join(os.tmpdir(), "yt-hide-watched-subs-profile");
const EXT_DIR = path.join(os.tmpdir(), "yt-hide-watched-shorts-ext");
// Both Subscriptions surfaces. The Shorts tab is the interesting one: its
// renderers carry no progress bar and no timestamp, so a Short can only be
// hidden there via the cache the watch-page reporter writes.
const FEEDS = [
  { label: "Subscriptions feed", url: "https://www.youtube.com/feed/subscriptions" },
  { label: "Subscriptions Shorts tab", url: "https://www.youtube.com/feed/subscriptions/shorts" },
];
const WATCH_MAX_SECONDS = 90;   // give up waiting for a cache write
const PROPAGATE_SECONDS = 20;   // give up waiting for the feed to react

const LAUNCH_ARGS = [
  "--no-first-run",
  "--disable-gpu",
  "--disable-blink-features=AutomationControlled",
  "--autoplay-policy=no-user-gesture-required",
];

function waitForEnter(msg) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(msg, () => { rl.close(); resolve(); }));
}

// ── Instrumented copy of the extension ──────────────────────
// The content script runs in an isolated world, so its internals are not
// reachable from page.evaluate(). We bridge that with a custom DOM event: the
// page dispatches "hw-shorts-diag", the content script answers by writing JSON
// onto <html> dataset, which both worlds share.
//
// CAUTION: this is a template literal, so backslash escapes are consumed before
// the code is written out — a regex \d silently becomes d in the emitted file.
// Avoid backslash shorthands entirely in here.
const DIAG_HOOK = `
  document.addEventListener('hw-shorts-diag', () => {
    const trackedEntry = watchTrackedId ? cache[watchTrackedId] : undefined;

    // The feed's own view of every renderer, straight from the implementation.
    // Empty on a Shorts page; this is what the feed tab is polled for.
    const feedItems = [...document.querySelectorAll(VIDEO_SELECTOR)].map((el) => {
      const id = extractVideoId(el);
      const entry = id ? cache[id] : undefined;
      const section = el.closest(SECTION_SELECTOR);
      return {
        id,
        isShort: isShortRenderer(el),
        title: (el.querySelector('#video-title, h3, .shortsLockupViewModelHostOutsideMetadataTitle, .yt-lockup-metadata-view-model__title')
          ? el.querySelector('#video-title, h3, .shortsLockupViewModelHostOutsideMetadataTitle, .yt-lockup-metadata-view-model__title').textContent : '').trim().slice(0, 55),
        watched: isWatched(el, id),
        hidden: el.classList.contains('hw-hidden'),
        manualHide: el.classList.contains('hw-manual-hide'),
        ageHidden: !!el.dataset.hwAgeHidden,
        // A Short can also vanish because the whole Shorts shelf was hidden,
        // which would be a false positive for "it was recognised as watched".
        sectionHidden: !!section && section.classList.contains('hw-section-hidden'),
        cacheEntry: entry === undefined ? null
          : (typeof entry === 'number' ? 'manual' : 'progress:' + entry.p),
      };
    });

    document.documentElement.dataset.hwShortsDiag = JSON.stringify({
      config,
      path: location.pathname,
      isWatchPage: isWatchPage(),
      isShortsWatchPage: isShortsWatchPage(),
      urlVideoId: watchPageVideoId(),
      // What the reporter's own resolver picks, from inside the extension's
      // world. If this is null the feature cannot work at all.
      selectorResolves: !!watchPlayerVideo(),
      selectorBranch: document.querySelector('#shorts-player video') ? 'shorts-player'
        : document.querySelector('#movie_player video') ? 'movie_player' : 'none',
      // The decoy that caused the original bug: on Shorts, #movie_player exists
      // alongside #shorts-player holding a dead video (paused at 0, duration
      // NaN). If this is ever true while the branch is 'movie_player', the
      // resolver is reading the wrong element again.
      decoyMoviePlayer: (() => {
        const v = document.querySelector('#movie_player video');
        return !!v && !v.currentSrc && !v.src;
      })(),
      reporterRunning: !!watchInterval,
      bound: !!watchVideoEl,
      boundPlayerId: watchVideoEl && watchVideoEl.closest('.html5-video-player')
        ? (watchVideoEl.closest('.html5-video-player').id || '(no id)') : null,
      // watchPagePercent() is the single value everything downstream depends
      // on; -1 means it refused to trust the player (ad, live, or no duration).
      percentNow: watchPagePercent(),
      accumulator: {
        trackedId: watchTrackedId,
        maxPct: watchMaxPct,
        lastPct: watchLastPct,
        lapped: watchLapped,
        awaitingStart: watchAwaitingStart,
      },
      counters: {
        samples: window.__hwSamples || 0,
        writes: window.__hwWrites || 0,
        binds: window.__hwBinds || 0,
      },
      initialScanDone,
      cacheSize: Object.keys(cache).length,
      trackedEntry: trackedEntry === undefined ? null
        : (typeof trackedEntry === 'number' ? 'manual' : 'progress:' + trackedEntry.p),
      feedItems,
    });
  });
`;

const PATCHES = [
  // Count timeupdate samples. Zero of these while a Short plays means the
  // listener never fired — either nothing was bound, or it bound to the wrong
  // element.
  [
    "  function sampleWatchProgress() {\n    if (!config.enabled || !isContextValid()) return;",
    "  function sampleWatchProgress() {\n    window.__hwSamples = (window.__hwSamples || 0) + 1;\n    if (!config.enabled || !isContextValid()) return;",
  ],
  // Count actual cache writes.
  [
    "    watchLastWriteAt = Date.now();\n    cache[id] = { t: Date.now(), p: pct };",
    "    watchLastWriteAt = Date.now();\n    window.__hwWrites = (window.__hwWrites || 0) + 1;\n    cache[id] = { t: Date.now(), p: pct };",
  ],
  // Count successful listener binds.
  [
    "    el.addEventListener('timeupdate', sampleWatchProgress);",
    "    window.__hwBinds = (window.__hwBinds || 0) + 1;\n    el.addEventListener('timeupdate', sampleWatchProgress);",
  ],
  // Expose internals via the hw-shorts-diag event.
  ["\n  init();\n})();", DIAG_HOOK + "\n  init();\n})();"],
];

function buildInstrumentedExtension() {
  fs.rmSync(EXT_DIR, { recursive: true, force: true });
  fs.mkdirSync(EXT_DIR, { recursive: true });

  for (const entry of ["manifest.json", "background.js", "content.js", "content.css", "popup.html", "popup.js", "icons", "_locales"]) {
    fs.cpSync(path.join(REPO, entry), path.join(EXT_DIR, entry), { recursive: true });
  }

  const target = path.join(EXT_DIR, "content.js");
  let src = fs.readFileSync(target, "utf8");

  for (const [from, to] of PATCHES) {
    if (!src.includes(from)) {
      throw new Error(
        "Instrumentation patch no longer matches content.js:\n  " + from.trim().slice(0, 90) +
        "\nUpdate PATCHES in verify-shorts.js."
      );
    }
    src = src.replace(from, to);
  }
  fs.writeFileSync(target, src);
}

// ── Page-world collection ───────────────────────────────────
// Deliberately independent of the extension: this is the ground truth the
// reporter is measured against. If these two disagree, the resolver is wrong.
async function readDom(page) {
  return page.evaluate(() => {
    const players = [...document.querySelectorAll(".html5-video-player")].map((p) => ({
      id: p.id || "(no id)",
      hasVideo: !!p.querySelector("video"),
      adShowing: p.classList.contains("ad-showing"),
    }));

    const videos = [...document.querySelectorAll("video")].map((v) => ({
      player: v.closest(".html5-video-player") ? (v.closest(".html5-video-player").id || "(no id)") : null,
      t: +v.currentTime.toFixed(2),
      dur: Number.isFinite(v.duration) ? +v.duration.toFixed(2) : String(v.duration),
      pct: Number.isFinite(v.duration) && v.duration > 0
        ? +((v.currentTime / v.duration) * 100).toFixed(1) : null,
      paused: v.paused,
      loop: v.loop,
      readyState: v.readyState,
      hasSrc: !!(v.src || v.currentSrc),
    }));

    return { path: location.pathname, players, videos };
  });
}

async function readDiag(page) {
  return page.evaluate(() => {
    delete document.documentElement.dataset.hwShortsDiag;
    document.dispatchEvent(new CustomEvent("hw-shorts-diag"));
    const raw = document.documentElement.dataset.hwShortsDiag;
    return raw ? JSON.parse(raw) : null; // null = content script not running
  });
}

function printTick(i, dom, diag) {
  const v = dom.videos.find((x) => x.hasSrc) || dom.videos[0];
  const line = [
    String(i).padStart(2) + "s",
    "video=" + (v ? v.pct + "% (" + v.t + "/" + v.dur + (v.paused ? ", PAUSED" : "") + ")" : "none"),
  ];
  if (diag) {
    line.push("via=" + diag.selectorBranch);
    line.push("pct=" + (diag.percentNow < 0 ? "-1 (distrusted)" : diag.percentNow.toFixed(1)));
    line.push("max=" + diag.accumulator.maxPct.toFixed(1));
    line.push(diag.accumulator.lapped ? "LAPPED" : "");
    line.push(diag.accumulator.awaitingStart ? "awaitingStart" : "");
    line.push("s/w/b=" + diag.counters.samples + "/" + diag.counters.writes + "/" + diag.counters.binds);
    line.push("entry=" + diag.trackedEntry);
  }
  console.log("  " + line.filter(Boolean).join("  "));
}

// Explains a failure of the WATCH half, in the order the pipeline runs.
function diagnoseReporter(dom, diag) {
  console.log("\n──────── reporter diagnosis ────────");
  if (!diag) {
    console.log("  !! The content script is not running on this page at all.");
    return;
  }
  const problems = [];

  if (!diag.isWatchPage) {
    problems.push("isWatchPage() is FALSE for " + diag.path + " — the reporter never starts here. " +
                  "Check the regex in isShortsWatchPage().");
  }
  if (!diag.urlVideoId) {
    problems.push("watchPageVideoId() returned null — no id can be parsed from " + diag.path + ".");
  }
  if (!diag.reporterRunning) {
    problems.push("watchInterval is null — startWatchReporter() never ran, or stopWatchReporter() ran after it.");
  }

  if (!diag.selectorResolves) {
    const real = dom.players.filter((p) => p.hasVideo).map((p) => p.id);
    problems.push("watchPlayerVideo() resolves to NOTHING. Players actually holding a <video>: " +
                  (real.length ? real.join(", ") : "(none)") + ". Add the live one to watchPlayerVideo().");
  } else if (diag.selectorBranch === "movie_player" && diag.decoyMoviePlayer) {
    problems.push("Bound to #movie_player, but that element has NO media source — it is the decoy " +
                  "that sits alongside #shorts-player on a Shorts page. Its duration is NaN, so " +
                  "watchPagePercent() returns -1 forever and nothing is ever recorded.");
  } else if (!diag.bound) {
    problems.push("The resolver works but watchVideoEl is null — syncWatchTracker() never ran here.");
  } else if (diag.counters.samples === 0) {
    problems.push("Bound to a <video> in '" + diag.boundPlayerId + "' but ZERO timeupdate events arrived. " +
                  "That element is not the one playing.");
  }

  if (diag.counters.samples > 0 && diag.percentNow < 0) {
    problems.push("Samples are arriving but watchPagePercent() returns -1, so every one is discarded. " +
                  "Cause: ad-showing, non-finite duration, or currentTime exactly 0 on the bound element.");
  }
  if (diag.accumulator.awaitingStart && diag.counters.samples > 0) {
    problems.push("watchAwaitingStart is stuck true — readings are being discarded as a stale outgoing " +
                  "element. If playback really is near the start, this flag is suppressing everything.");
  }
  if (diag.accumulator.maxPct > 0 && diag.counters.writes === 0) {
    const t = diag.config.threshold;
    problems.push("High-water mark reached " + diag.accumulator.maxPct.toFixed(1) + "% but nothing was written. " +
                  "Threshold is " + t + "% — " + (diag.accumulator.maxPct < t ? "playback never crossed it."
                  : "it was crossed, so the block is the manual-mark guard or the refine/rate limit."));
  }

  if (!problems.length) {
    console.log("  OK. maxPct=" + diag.accumulator.maxPct.toFixed(1) +
                "%  lapped=" + diag.accumulator.lapped +
                "  writes=" + diag.counters.writes + "  entry=" + diag.trackedEntry);
    return;
  }
  problems.forEach((p, i) => console.log("  " + (i + 1) + ". " + p));
}

function findItem(diag, id) {
  return diag && diag.feedItems ? diag.feedItems.find((f) => f.id === id) : undefined;
}

async function main() {
  const fresh = process.argv.includes("--fresh");

  console.log("Building instrumented extension copy in " + EXT_DIR);
  buildInstrumentedExtension();

  if (fresh) fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  const needLogin = fresh || !fs.existsSync(PROFILE_DIR);

  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: [...LAUNCH_ARGS, `--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
  });

  if (needLogin) {
    const loginPage = await browser.newPage();
    await loginPage.goto("https://accounts.google.com", { waitUntil: "domcontentloaded", timeout: 60000 });
    console.log("\n=== Sign in to Google in the browser window. Take your time. ===\n");
    await waitForEnter("Press Enter here AFTER you are fully signed in...\n");
    await loginPage.close();
  } else {
    console.log("Reusing saved login (" + PROFILE_DIR + "). Pass --fresh to sign in again.");
  }

  let sw = browser.serviceWorkers()[0];
  if (!sw) sw = await browser.waitForEvent("serviceworker");

  // hideShorts would hide every Short outright, making "it disappeared"
  // meaningless. Force it off for the run and put the user's setting back.
  const original = await sw.evaluate(
    () => new Promise((r) => chrome.storage.sync.get({ enabled: true, hideShorts: false, threshold: 15 }, r))
  );
  await sw.evaluate(() => new Promise((r) => chrome.storage.sync.set({ enabled: true, hideShorts: false }, r)));
  console.log("Threshold is " + original.threshold + "%. hideShorts forced off for this run" +
              (original.hideShorts ? " (was ON — will restore)" : "") + ".");

  // ── The feed tabs. Opened once, then never touched again. ──
  // Both Subscriptions surfaces, because they are not the same page: the main
  // feed renders Shorts inside a shelf, the Shorts tab is nothing but Shorts and
  // carries no timestamp or progress metadata at all. Hiding there rides
  // entirely on the cache, so it is worth watching separately rather than
  // assuming the main feed's result carries over.
  for (const f of FEEDS) {
    f.page = await browser.newPage();
    await f.page.goto(f.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    try {
      await f.page.locator('button:has-text("Reject all"), button:has-text("Reject the use"), button:has-text("Confirm")').first().click({ timeout: 3000 });
    } catch {}
    try {
      await f.page.waitForSelector("ytd-rich-item-renderer, ytd-video-renderer, ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2",
        { state: "attached", timeout: 20000 });
    } catch {}
    await f.page.waitForTimeout(2000);
  }

  await waitForEnter(
    "\n  Both Subscriptions tabs are open (main feed + Shorts tab). Scroll either if\n" +
    "  you need to bring Shorts in, then press Enter.\n" +
    "  From here NEITHER feed tab is touched again — no reload, no navigation.\n"
  );

  console.log("\n════════ feeds on arrival ════════");
  const eligible = (f) => f.id && f.isShort && !f.watched && !f.hidden && !f.manualHide && !f.sectionHidden;
  for (const f of FEEDS) {
    const d = await readDiag(f.page);
    if (!d) {
      console.log("  " + f.label + ": !! content script not running here");
      f.items = [];
      continue;
    }
    f.items = d.feedItems.filter((x) => x.isShort);
    f.eligible = f.items.filter(eligible);
    console.log("  " + f.label + ": " + d.feedItems.length + " renderers, " + f.items.length +
                " Shorts, " + f.eligible.length + " eligible   initialScanDone: " + d.initialScanDone);
  }

  // Prefer a Short present in BOTH feeds: one watch then proves both surfaces
  // at once, and rules out the two feeds disagreeing about the same video.
  const [mainFeed, shortsFeed] = FEEDS;
  const inBoth = (mainFeed.eligible || []).find(
    (a) => (shortsFeed.eligible || []).some((b) => b.id === a.id)
  );
  const candidate = inBoth || (shortsFeed.eligible || [])[0] || (mainFeed.eligible || [])[0];
  if (!candidate) {
    console.log("\n  No eligible Short in either feed — need one that is unwatched, visible,");
    console.log("  and not already cached. Scroll to load more and re-run.");
    await waitForEnter("\nPress Enter to close...\n");
    await browser.close();
    return;
  }
  // Only the feeds that actually contain it can be expected to hide it.
  for (const f of FEEDS) f.hasCandidate = (f.items || []).some((x) => x.id === candidate.id);
  console.log("\n  test Short: " + candidate.id + "  " + JSON.stringify(candidate.title));
  console.log("  present in: " + FEEDS.filter((f) => f.hasCandidate).map((f) => f.label).join(" + ") +
              (inBoth ? "  (chosen because it appears in both)" : ""));

  // ── The watch tab, in a SECOND tab so the feed keeps living. ──
  const watch = await browser.newPage();
  await watch.goto("https://www.youtube.com/shorts/" + candidate.id, { waitUntil: "domcontentloaded", timeout: 30000 });
  await watch.waitForTimeout(4000);

  await waitForEnter(
    "\n  The Short opened in a second tab. Make sure it is PLAYING (click it if it\n" +
    "  did not autoplay) and leave it running. Press Enter to start sampling.\n"
  );

  console.log("\n════════ watching (waiting for a cache write) ════════");
  let dom = null, diag = null, wroteAt = -1;
  for (let i = 0; i < WATCH_MAX_SECONDS; i++) {
    dom = await readDom(watch);
    diag = await readDiag(watch);
    printTick(i, dom, diag);
    if (diag && diag.trackedEntry && wroteAt < 0) {
      wroteAt = i;
      console.log("  ^ cache write landed at " + i + "s — letting it run 3s more, then checking the feed.");
    }
    if (wroteAt >= 0 && i >= wroteAt + 3) break;
    await watch.waitForTimeout(1000);
  }
  diagnoseReporter(dom, diag);

  if (wroteAt < 0) {
    console.log("\n  The Short never reached the cache, so there is nothing for the feed to react to.");
    console.log("  The reporter diagnosis above is the failure. Skipping the propagation check.");
  }

  // ── Did the untouched feed tabs react? ──
  console.log("\n════════ propagation to the feed tabs (never reloaded) ════════");
  const targets = FEEDS.filter((f) => f.hasCandidate);
  for (const f of targets) { f.hiddenAt = -1; f.last = null; }
  for (let i = 0; i < PROPAGATE_SECONDS; i++) {
    for (const f of targets) {
      if (f.hiddenAt >= 0) continue;
      const item = findItem(await readDiag(f.page), candidate.id);
      f.last = item;
      if (!item) {
        console.log("  " + i + "s  " + f.label + ": renderer no longer in the DOM " +
                    "(YouTube removed it, or the feed re-rendered)");
      } else {
        console.log("  " + i + "s  " + f.label + ": hidden=" + item.hidden + "  watched=" + item.watched +
                    "  cache=" + item.cacheEntry + "  sectionHidden=" + item.sectionHidden);
        if (item.hidden) f.hiddenAt = i;
      }
    }
    if (targets.every((f) => f.hiddenAt >= 0)) break;
    await targets[0].page.waitForTimeout(1000);
  }

  // ── Does a completed loop count, even when it ends up sitting at 1%? ──
  // This is the property the accumulator exists for and the one that cannot be
  // read off the DOM: Shorts loop, so by the time the user swipes away the
  // position is arbitrary and usually low. A naive sampler reads 3% and calls
  // it unwatched. The high-water mark plus the lap flag must outvote that.
  //
  // Shorts play with video.loop = true, so 'ended' never fires — the only
  // completion signal is the wrap itself, which makes this the one phase that
  // actually exercises it.
  const lap = { ran: false, lapped: false, entry: null, pctAtLap: null, stillHidden: null, duration: null };
  if (wroteAt >= 0) {
    console.log("\n════════ lap detection (letting it loop) ════════");
    lap.ran = true;
    lap.duration = await watch.evaluate(() => {
      const v = document.querySelector("#shorts-player video") || document.querySelector("#movie_player video");
      return v && Number.isFinite(v.duration) ? +v.duration.toFixed(1) : null;
    });

    // Seek near the end rather than waiting out the whole Short. The seek only
    // fast-forwards; the wrap that follows is a real one, and the lap heuristic
    // is deliberately not suppressed by seeking (YouTube may implement looping
    // as a seek to 0, which would otherwise swallow the signal). Pass --no-seek
    // to sit through it in real time instead.
    const seek = !process.argv.includes("--no-seek");
    if (seek && lap.duration) {
      await watch.evaluate((d) => {
        const v = document.querySelector("#shorts-player video") || document.querySelector("#movie_player video");
        if (v) v.currentTime = Math.max(0, d - 3);
      }, lap.duration);
      console.log("  duration " + lap.duration + "s — seeked to " + Math.max(0, lap.duration - 3).toFixed(1) +
                  "s to reach the wrap quickly (--no-seek to watch it through).");
    } else {
      console.log("  duration " + lap.duration + "s — waiting for it to loop in real time.");
    }

    const budget = seek ? 25 : Math.ceil((lap.duration || 60) + 25);
    for (let i = 0; i < budget; i++) {
      dom = await readDom(watch);
      diag = await readDiag(watch);
      printTick(i, dom, diag);
      if (diag && diag.accumulator.lapped) {
        lap.lapped = true;
        // i === 0 means it had already wrapped during the earlier phases —
        // still a real observation, just not one this phase caused.
        if (i === 0) lap.preLapped = true;
        // Catch the 100 the moment it lands, rather than sleeping a fixed
        // interval. We have to wait at all because writeWatchProgress() is rate
        // limited, but every extra millisecond is playback climbing away from
        // the wrap — and the assertion is that the position is BELOW the
        // threshold. A flat 2.5s wait measured 13.6% on a 24s Short (a 1.4
        // point margin) and would have measured 25% on a 10s one, reporting
        // INCONCLUSIVE for a Short that behaved perfectly.
        for (let j = 0; j < 12; j++) {
          await watch.waitForTimeout(500);
          dom = await readDom(watch);
          diag = await readDiag(watch);
          lap.entry = diag.trackedEntry;
          lap.pctAtLap = diag.percentNow;
          lap.maxPct = diag.accumulator.maxPct;
          if (lap.entry === "progress:100") break;
        }
        console.log("  ^ LAPPED" + (lap.preLapped ? " (already, during the earlier phases)" : "") +
                    ". entry=" + lap.entry + " while live position is " +
                    (lap.pctAtLap < 0 ? "-1" : lap.pctAtLap.toFixed(1) + "%"));
        break;
      }
      await watch.waitForTimeout(1000);
    }
    if (!lap.lapped) {
      console.log("  never observed a wrap within " + budget + "s — lap detection is UNPROVEN, not disproven.");
      if (diag) lap.entry = diag.trackedEntry;
    }

    // A low live position must not un-hide it on either feed.
    lap.feeds = {};
    lap.stillHidden = null;
    for (const f of targets) {
      const item2 = findItem(await readDiag(f.page), candidate.id);
      // Kept separately from f.last, which is captured during the propagation
      // phase and is therefore stale by the time the lap lands.
      lap.feeds[f.label] = item2 || null;
      // Any feed un-hiding it is a failure, so this is an AND across feeds.
      const hid = item2 ? item2.hidden : null;
      if (hid !== null) lap.stillHidden = lap.stillHidden === null ? hid : (lap.stillHidden && hid);
      console.log("  " + f.label + " after the loop: " + (item2
        ? "hidden=" + item2.hidden + "  watched=" + item2.watched + "  cache=" + item2.cacheEntry
        : "renderer no longer in the DOM"));
    }
  }

  // ── Verdict ──
  console.log("\n════════ verdict ════════");
  const cache = await sw.evaluate(
    (vid) => new Promise((r) => chrome.storage.local.get({ cache: {} }, (d) => r(d.cache[vid] || null))),
    candidate.id
  );
  console.log("  cache entry for " + candidate.id + ": " + JSON.stringify(cache));

  // One line per feed the Short actually appeared in. A feed that never
  // contained it is reported as untested rather than quietly counted as a pass.
  for (const f of FEEDS) {
    if (!f.hasCandidate) {
      console.log("  " + f.label + ": NOT TESTED — this Short never appeared in that feed.");
      continue;
    }
    if (f.hiddenAt >= 0 && f.last && f.last.sectionHidden) {
      console.log("  " + f.label + ": INCONCLUSIVE — hidden, but so is its whole section. That is the");
      console.log("      shelf being hidden, NOT this Short being recognised as watched.");
    } else if (f.hiddenAt >= 0) {
      console.log("  " + f.label + ": PASS — disappeared " + f.hiddenAt + "s after the write, no reload.");
    } else if (wroteAt >= 0) {
      console.log("  " + f.label + ": FAIL — written to the cache, but this feed never hid it.");
      if (f.last) {
        console.log("      last state: " + JSON.stringify(f.last));
        if (f.last.cacheEntry === null) {
          console.log("      This tab's cache does not even have the id — the storage event did not");
          console.log("      arrive, or selfCacheWrite swallowed it.");
        } else if (!f.last.watched) {
          console.log("      It HAS the entry but isWatched() says false — compare the stored");
          console.log("      percentage against the threshold (" + original.threshold + "%).");
        }
      }
    } else {
      console.log("  " + f.label + ": FAIL — nothing was ever written; see the reporter diagnosis.");
    }
  }
  if (wroteAt < 0) {
    console.log("  Nothing reached the cache, so no feed could have reacted.");
  }

  if (lap.ran) {
    console.log("");
    if (!lap.lapped) {
      console.log("  LAP: UNPROVEN — no wrap was observed, so the looping case is still untested.");
      console.log("       Re-run with --no-seek, or pick a shorter Short.");
    } else if (lap.pctAtLap !== null && lap.pctAtLap >= original.threshold) {
      console.log("  LAP: INCONCLUSIVE — it lapped and entry=" + lap.entry + ", but the live position " +
                  "was still " + lap.pctAtLap.toFixed(1) + "%,");
      console.log("       which is above the " + original.threshold + "% threshold on its own. The lap " +
                  "was not load-bearing here.");
    } else if (lap.stillHidden === false) {
      console.log("  LAP: FAIL — it lapped (entry=" + lap.entry + ") but the feed UN-hid it once the");
      console.log("       position dropped back to " + lap.pctAtLap.toFixed(1) + "%. Something is " +
                  "downgrading the cache entry.");
    } else if (lap.entry !== "progress:100") {
      console.log("  LAP: PARTIAL — it stayed hidden at " + lap.pctAtLap.toFixed(1) + "% (good), but the");
      console.log("       entry is " + lap.entry + ", not progress:100. The wrap was detected yet the");
      console.log("       100 never got written — check the refine ladder and the rate limit in");
      console.log("       writeWatchProgress(). It matters if the threshold is later raised.");
    } else {
      console.log("  LAP: PASS — a completed loop was recorded as entry=progress:100, and it stayed");
      console.log("       hidden while playback sat at " + lap.pctAtLap.toFixed(1) + "% — below the " +
                  original.threshold + "% threshold.");
      console.log("       The high-water mark outvoted the live position, which is the point.");
    }
  }

  const out = path.join(os.tmpdir(), "yt-hide-watched-shorts-diag.json");
  fs.writeFileSync(out, JSON.stringify({
    candidate, threshold: original.threshold, wroteAt, lap,
    // Never spread a FEEDS entry directly — it holds a Playwright Page, which
    // does not survive JSON.stringify.
    feeds: FEEDS.map((f) => ({
      label: f.label,
      url: f.url,
      hasCandidate: !!f.hasCandidate,
      shortsSeen: (f.items || []).length,
      eligible: (f.eligible || []).length,
      hiddenAt: f.hiddenAt === undefined ? null : f.hiddenAt,
      lastState: f.last || null,
    })),
    watchDom: dom, watchDiag: diag, cacheEntry: cache,
  }, null, 2));
  console.log("\n  full dump: " + out);

  await sw.evaluate(
    (o) => new Promise((r) => chrome.storage.sync.set({ hideShorts: o.hideShorts, enabled: o.enabled }, r)),
    original
  );
  console.log("  restored your hideShorts/enabled settings.");

  await waitForEnter("\nPress Enter to close the browser...\n");
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
