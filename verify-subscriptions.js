// verify-subscriptions.js — Manual diagnostic tool (not part of the extension or CI).
//
// The Subscriptions feed is the only target page the test suite cannot reach,
// because it requires a signed-in account. This script signs in the same way
// verify-locales.js does, loads the extension, and reports exactly what it does
// to a real Subscriptions feed.
//
// It loads an INSTRUMENTED COPY of the extension from a temp dir (the repo is
// never modified). The copy is patched to expose the content script's own
// internals — extractVideoId, isWatched, getProgressWidth, getVideoAgeDays,
// isScheduled, isPlayable — so the report is ground truth from the real
// implementation rather than a reimplementation of it.
//
// Reports, per renderer and in aggregate:
//   1. Whether the content script activates at all
//   2. extractVideoId success rate  (if this fails, nothing else can work)
//   3. Which getProgressWidth DOM path matches, and measured widths vs threshold
//   4. Where each mark button mounted, and which renderers never get one
//   5. Every section renderer, its real title, whether SECTION_SELECTOR covers
//      it, and whether we hid it (validates the hideMostRelevant default and
//      the MOST_RELEVANT_RE / SHORTS_RE patterns against reality)
//   6. Video-like elements that VIDEO_SELECTOR misses entirely
//   7. Age-string parsing through getVideoAgeDays
//   8. Whether the 2s drift checker settles or rescans forever, before and
//      after infinite scroll
//   9. Whether toggling the extension off actually restores the page
//  10. Whether a video watched in ANOTHER TAB disappears from the feed without
//      reloading it (the feed tab is never reloaded during that phase)
//
// A full per-renderer JSON dump is written to os.tmpdir() for later analysis.
//
// Usage:
//   node verify-subscriptions.js           # reuses a saved login if present
//   node verify-subscriptions.js --fresh   # wipes the profile, logs in again
//
// You sign in yourself in the browser window that opens; this script never sees
// or stores your password. The login lives in a Chromium profile in os.tmpdir()
// and is reused across runs unless you pass --fresh.
//
// The run is NOT unattended. It pauses and waits for Enter three times:
//   1. after the feed loads, so you can get it into the state you want measured
//   2. to let you scroll the feed down BY HAND — programmatic scrolling does not
//      reliably trigger YouTube's infinite scroll, so the "at scale" phase only
//      measures anything if you grow the feed yourself
//   3. to let a video play past your watch threshold in the watch tab that the
//      last phase opens (skip any ad first)

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const os = require("os");
const readline = require("readline");

const REPO = __dirname;
const PROFILE_DIR = path.join(os.tmpdir(), "yt-hide-watched-subs-profile");
const EXT_DIR = path.join(os.tmpdir(), "yt-hide-watched-subs-ext");
const SUBS_URL = "https://www.youtube.com/feed/subscriptions";
const IDLE_MS = 10000; // 5 drift ticks

const LAUNCH_ARGS = [
  "--no-first-run",
  "--disable-gpu",
  "--disable-blink-features=AutomationControlled",
  // So the watch-propagation phase can actually start playback.
  "--autoplay-policy=no-user-gesture-required",
];

function waitForEnter(msg) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(msg, () => { rl.close(); resolve(); }));
}

// ── Instrumented copy of the extension ──────────────────────
// The content script runs in an isolated world, so its internals are not
// reachable from page.evaluate(). We bridge that with a custom DOM event: the
// page dispatches "hw-diag", the content script answers by writing JSON onto
// <html> dataset, which both worlds share.
//
// CAUTION: this is a template literal, so backslash escapes are consumed before
// the code is written out — a regex \d silently becomes d in the emitted file.
// Use [0-9] style classes here, never backslash shorthands.
const DIAG_HOOK = `
  document.addEventListener('hw-diag', () => {
    const items = [...document.querySelectorAll(VIDEO_SELECTOR)].map((el) => {
      const id = extractVideoId(el);
      const entry = id ? cache[id] : undefined;
      return {
        tag: el.tagName,
        id,
        title: (el.querySelector('#video-title, h3, .yt-lockup-metadata-view-model__title')?.textContent || '').trim().slice(0, 60),
        progress: getProgressWidth(el),
        progressDom: el.querySelector('yt-thumbnail-overlay-progress-bar-view-model') ? 'new'
                   : el.querySelector('ytd-thumbnail-overlay-resume-playback-renderer') ? 'old' : 'none',
        fullViewOverlay: !!el.querySelector('yt-thumbnail-overlay-full-view-model'),
        watched: isWatched(el, id),
        cacheEntry: entry === undefined ? null : (typeof entry === 'number' ? 'manual' : 'progress:' + entry.p),
        ageDays: getVideoAgeDays(el),
        tooOld: isTooOld(el),
        scheduled: isScheduled(el),
        playable: isPlayable(el),
        isShort: isShortRenderer(el),
        hidden: el.classList.contains('hw-hidden'),
        manualHide: el.classList.contains('hw-manual-hide'),
        ageHidden: !!el.dataset.hwAgeHidden,
        scheduledHidden: !!el.dataset.hwScheduledHidden,
        playableHidden: !!el.dataset.hwPlayableHidden,
        btn: el.querySelector('.hw-mark-btn') ? 'thumbnail'
           : el.querySelector('.hw-mark-btn-short') ? 'metadata' : null,
        canMount: canMountMarkButton(el, id),
        // Live/premiere detection. A live stream has no usable duration, so
        // percentage-watched is meaningless and it must never be picked as the
        // propagation test video. Structural signals first, then the badge-text
        // trick checkInlinePreview() already uses: a real VOD carries a
        // timestamp badge like "12:34"; LIVE/UPCOMING carry words instead, which
        // makes the check locale-independent.
        badges: [...el.querySelectorAll('.ytBadgeShapeText')].map((b) => b.textContent.trim()).slice(0, 4),
        hasDurationBadge: [...el.querySelectorAll('.ytBadgeShapeText')]
          .some((b) => /^[0-9][0-9:.]*$/.test(b.textContent.trim())),
        // NOTE: there is no structural live signal in the modern lockup markup —
        // probed against a live channel, LIVE and Upcoming items carry no
        // overlay-style attribute and identical badge host classes. Only the
        // badge TEXT differs. So "is this a playable VOD" is decided by
        // hasDurationBadge above, which holds in any locale.
        isVod: [...el.querySelectorAll('.ytBadgeShapeText')]
          .some((b) => /^[0-9][0-9:.]*$/.test(b.textContent.trim())),
        // Where does this renderer actually live? A section toggle can only
        // hide videos that are INSIDE the section it matches.
        parentTag: el.parentElement ? el.parentElement.tagName : null,
        inSection: (() => {
          const s = el.closest(SECTION_SELECTOR);
          return s ? (s.querySelector('h2, #title')?.textContent || '').trim().slice(0, 40) : null;
        })(),
      };
    });

    // Raw metadata strings, so unparsed age formats can be spotted by eye.
    const metaSamples = [...document.querySelectorAll(VIDEO_SELECTOR)].slice(0, 8).map((el) =>
      [...el.querySelectorAll('.ytContentMetadataViewModelMetadataText, #metadata-line span, .inline-metadata-item, ytd-video-meta-block span')]
        .map((s) => s.textContent.trim()).filter(Boolean)
    );

    // The feed container's direct children, in DOM order. Shows whether a
    // "Latest" header is a SIBLING of the videos rather than their parent —
    // which would mean no containment-based selector can ever hide them.
    const describe = (el) => ({
      tag: el.tagName,
      title: (el.querySelector('h2, #title')?.textContent || '').trim().slice(0, 40),
      videos: el.querySelectorAll(VIDEO_SELECTOR).length,
      isVideo: el.matches(VIDEO_SELECTOR),
      isSection: el.matches(SECTION_SELECTOR),
    });

    const grid = document.querySelector('ytd-rich-grid-renderer #contents, ytd-rich-grid-renderer, ytd-section-list-renderer');
    const feedOrder = grid ? [...grid.children].map(describe) : null;

    // Descend to whichever element directly holds the video renderers, and list
    // its children in order. This is what shows whether a section header is a
    // SIBLING of the videos it labels rather than their container.
    let videoParent = null, best = 0;
    for (const el of document.querySelectorAll(VIDEO_SELECTOR)) {
      const p = el.parentElement;
      if (!p) continue;
      const n = [...p.children].filter((c) => c.matches(VIDEO_SELECTOR)).length;
      if (n > best) { best = n; videoParent = p; }
    }
    const videoParentOrder = videoParent ? {
      tag: videoParent.tagName,
      className: (videoParent.className || '').slice(0, 80),
      children: [...videoParent.children].map(describe),
    } : null;

    document.documentElement.dataset.hwDiag = JSON.stringify({
      config,
      feedOrder,
      videoParentOrder,
      scrollCutoff,
      initialScanDone,
      cacheSize: Object.keys(cache).length,
      sectionSelector: SECTION_SELECTOR,
      videoSelector: VIDEO_SELECTOR,
      items,
      metaSamples,
    });
  });
`;

const PATCHES = [
  // Count scan() invocations.
  [
    "  function scan() {\n    if (!isContextValid()) return;",
    "  function scan() {\n    document.documentElement.dataset.hwScans = String((+document.documentElement.dataset.hwScans || 0) + 1);\n    if (!isContextValid()) return;",
  ],
  // Record what pinned the drift checker.
  [
    "      if (!watched && !hidden && !hasBtn && canMountMarkButton(el, id)) return true;",
    "      if (!watched && !hidden && !hasBtn && canMountMarkButton(el, id)) { document.documentElement.dataset.hwDrift = JSON.stringify({ tag: el.tagName, id, text: (el.textContent || '').trim().slice(0, 80) }); return true; }",
  ],
  // Expose internals via the hw-diag event.
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
        "\nUpdate PATCHES in verify-subscriptions.js."
      );
    }
    src = src.replace(from, to);
  }
  fs.writeFileSync(target, src);
}

// ── Page-world collection ───────────────────────────────────
async function readDiag(page) {
  return page.evaluate(() => {
    delete document.documentElement.dataset.hwDiag;
    document.dispatchEvent(new CustomEvent("hw-diag"));
    const raw = document.documentElement.dataset.hwDiag;
    if (!raw) return null; // content script not running

    const diag = JSON.parse(raw);

    // Section renderers, including the kinds SECTION_SELECTOR does not match.
    diag.sections = [...document.querySelectorAll("ytd-rich-section-renderer, ytd-item-section-renderer, ytd-shelf-renderer")].map((s) => ({
      tag: s.tagName,
      title: (s.querySelector("h2, #title")?.textContent || "").trim().slice(0, 60),
      videos: s.querySelectorAll(diag.videoSelector).length,
      hidden: s.classList.contains("hw-section-hidden"),
      forceHidden: !!s.dataset.hwForceHidden,
      covered: s.matches(diag.sectionSelector),
    }));

    // Video-like elements VIDEO_SELECTOR may be missing entirely.
    const LOCKUPS = "yt-lockup-view-model, ytd-rich-grid-media, ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2";
    diag.uncoveredLockups = [...document.querySelectorAll(LOCKUPS)]
      .filter((el) => !el.closest(diag.videoSelector))
      .map((el) => el.tagName)
      .reduce((acc, t) => ((acc[t] = (acc[t] || 0) + 1), acc), {});

    diag.banner = !!document.querySelector(".hw-age-cutoff-banner");
    diag.continuations = document.querySelectorAll("ytd-continuation-item-renderer").length;
    diag.drift = document.documentElement.dataset.hwDrift || null;
    return diag;
  });
}

async function scans(page) {
  return page.evaluate(() => +document.documentElement.dataset.hwScans || 0);
}

async function measureIdleScans(page) {
  const before = await scans(page);
  await page.waitForTimeout(IDLE_MS);
  return (await scans(page)) - before;
}

function count(items, fn) {
  return items.filter(fn).length;
}

function printReport(label, d) {
  const items = d.items;
  console.log("\n════════ " + label + " ════════");
  console.log("  config: " + JSON.stringify(d.config));
  console.log("  cache entries: " + d.cacheSize + "   initialScanDone: " + d.initialScanDone + "   scrollCutoff: " + d.scrollCutoff);
  console.log("  renderers: " + items.length + "   continuations: " + d.continuations + "   age banner: " + d.banner);

  const byTag = items.reduce((a, i) => ((a[i.tag] = (a[i.tag] || 0) + 1), a), {});
  console.log("  by tag: " + JSON.stringify(byTag));
  if (Object.keys(d.uncoveredLockups).length) {
    console.log("  !! video-like elements NOT matched by VIDEO_SELECTOR: " + JSON.stringify(d.uncoveredLockups));
  }

  console.log("\n  -- id extraction --");
  console.log("     with id: " + count(items, (i) => i.id) + " / " + items.length +
              "   without: " + count(items, (i) => !i.id));

  console.log("\n  -- watch detection --");
  console.log("     progress bar DOM: " + JSON.stringify(items.reduce((a, i) => ((a[i.progressDom] = (a[i.progressDom] || 0) + 1), a), {})));
  console.log("     watched: " + count(items, (i) => i.watched) +
              "   full-view overlay: " + count(items, (i) => i.fullViewOverlay) +
              "   cache hits: " + count(items, (i) => i.cacheEntry));
  const widths = items.filter((i) => i.progress >= 0).map((i) => i.progress);
  if (widths.length) {
    console.log("     progress widths seen: " + [...new Set(widths)].sort((a, b) => a - b).join(", ") +
                "   (threshold " + d.config.threshold + "%)");
  } else {
    console.log("     !! no progress bars found on any renderer");
  }

  console.log("\n  -- hiding --");
  console.log("     hidden: " + count(items, (i) => i.hidden) +
              "   byAge: " + count(items, (i) => i.ageHidden) +
              "   byScheduled: " + count(items, (i) => i.scheduledHidden) +
              "   byPlayable: " + count(items, (i) => i.playableHidden));
  console.log("     detected scheduled: " + count(items, (i) => i.scheduled) +
              "   playable: " + count(items, (i) => i.playable) +
              "   shorts: " + count(items, (i) => i.isShort) +
              "   tooOld: " + count(items, (i) => i.tooOld));

  console.log("\n  -- mark buttons --");
  console.log("     on metadata line: " + count(items, (i) => i.btn === "metadata") +
              "   on thumbnail: " + count(items, (i) => i.btn === "thumbnail") +
              "   none: " + count(items, (i) => !i.btn));
  const stuck = items.filter((i) => !i.btn && !i.hidden && !i.manualHide && !i.watched);
  console.log("     visible+unwatched with NO button: " + stuck.length + (stuck.length ? "  <-- these pin the drift checker" : ""));
  for (const s of stuck.slice(0, 5)) {
    console.log("       " + s.tag + " id=" + s.id + " canMount=" + s.canMount + " playable=" + s.playable + " " + JSON.stringify(s.title));
  }

  console.log("\n  -- age parsing --");
  const parsed = items.filter((i) => i.ageDays >= 0);
  console.log("     parsed: " + parsed.length + " / " + items.length +
              (parsed.length ? "   days seen: " + [...new Set(parsed.map((i) => i.ageDays))].sort((a, b) => a - b).slice(0, 12).join(", ") : ""));
  if (parsed.length < items.length) {
    console.log("     sample metadata strings (check for unparsed age formats):");
    for (const m of d.metaSamples.slice(0, 5)) console.log("       " + JSON.stringify(m));
  }

  console.log("\n  -- sections --");
  if (!d.sections.length) console.log("     (none)");
  for (const s of d.sections) {
    console.log("     " + (s.covered ? "[matched] " : "[IGNORED] ") + s.tag.padEnd(28) +
                " videos=" + String(s.videos).padEnd(4) +
                " hidden=" + String(s.hidden).padEnd(6) +
                " title=" + JSON.stringify(s.title));
  }

  console.log("\n  -- where the videos live --");
  const byParent = items.reduce((a, i) => ((a[i.parentTag] = (a[i.parentTag] || 0) + 1), a), {});
  console.log("     parent tags: " + JSON.stringify(byParent));
  const inSec = items.reduce((a, i) => ((a[i.inSection === null ? "(no section)" : i.inSection] = (a[i.inSection === null ? "(no section)" : i.inSection] || 0) + 1), a), {});
  console.log("     enclosing section: " + JSON.stringify(inSec));
  const orphans = count(items, (i) => i.inSection === null);
  if (orphans) {
    console.log("     !! " + orphans + " videos are in NO matched section — no section toggle can hide these");
  }

  if (d.videoParentOrder) {
    const vp = d.videoParentOrder;
    console.log("\n  -- container holding the videos: <" + vp.tag.toLowerCase() + " class=\"" + vp.className + "\"> --");
    let r = null, rn = 0;
    const f = () => { if (r) console.log("     " + String(rn).padStart(4) + "x " + r); };
    for (const c of vp.children) {
      const k = c.isVideo ? "[VIDEO] " + c.tag
        : (c.isSection ? "[SECTION] " : "[other]  ") + c.tag + (c.title ? "  title=" + JSON.stringify(c.title) : "") + "  videos=" + c.videos;
      if (k === r) { rn++; continue; }
      f(); r = k; rn = 1;
    }
    f();
  }

  if (d.feedOrder) {
    console.log("\n  -- feed container children, in DOM order --");
    let run = null, runN = 0;
    const flush = () => { if (run) console.log("     " + String(runN).padStart(4) + "x " + run); };
    for (const c of d.feedOrder) {
      const key = c.tag + (c.title ? "  title=" + JSON.stringify(c.title) : "") + (c.isVideo ? "" : "  videos=" + c.videos);
      if (key === run) { runN++; continue; }
      flush(); run = key; runN = 1;
    }
    flush();
  }

  if (d.drift) console.log("\n  last drift trigger: " + d.drift);
}

// ── Census that does not depend on the content script ───────
// Runs even when the feed looks empty, so a failed wait still produces
// evidence instead of just an error message.
async function census(page) {
  return page.evaluate(() => {
    const tags = {};
    for (const el of document.querySelectorAll("*")) {
      const t = el.tagName.toLowerCase();
      if (t.includes("-") && (t.includes("renderer") || t.includes("lockup") || t.includes("view-model"))) {
        tags[t] = (tags[t] || 0) + 1;
      }
    }
    const top = Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 25);

    const vids = document.querySelectorAll("ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-reel-item-renderer");
    let visible = 0, displayNone = 0, hwHidden = 0;
    for (const el of vids) {
      if (el.classList.contains("hw-hidden")) hwHidden++;
      const cs = getComputedStyle(el);
      if (cs.display === "none") displayNone++;
      else if (el.getClientRects().length) visible++;
    }

    return {
      url: location.href,
      title: document.title,
      signedIn: !!document.querySelector("#avatar-btn, ytd-topbar-menu-button-renderer #avatar-btn, button#avatar-btn"),
      contentScriptMarks: document.querySelectorAll(".hw-hidden, .hw-mark-btn, .hw-mark-btn-short, .hw-section-hidden").length,
      videoRenderers: vids.length,
      visible,
      displayNone,
      hwHidden,
      hwSectionHidden: document.querySelectorAll(".hw-section-hidden").length,
      topTags: top,
    };
  });
}

function printCensus(c) {
  console.log("\n──────── DOM census ────────");
  console.log("  url:      " + c.url);
  console.log("  title:    " + JSON.stringify(c.title));
  console.log("  signed in (avatar present): " + c.signedIn);
  console.log("  content-script marks in DOM: " + c.contentScriptMarks);
  console.log("  VIDEO_SELECTOR matches: " + c.videoRenderers +
              "   visible: " + c.visible +
              "   display:none: " + c.displayNone +
              "   .hw-hidden: " + c.hwHidden);
  console.log("  sections hidden by us: " + c.hwSectionHidden);
  console.log("  renderer/lockup tags present:");
  for (const [t, n] of c.topTags) console.log("    " + String(n).padStart(4) + "  " + t);
}

// ── Does a video watched elsewhere disappear without a reload? ──
// The feed tab is deliberately NEVER reloaded here. That is the whole point:
// a reload would hide the video regardless and prove nothing.
async function checkWatchPropagation(browser, page, sw, diag) {
  // A live stream has no usable duration, so percentage-watched is meaningless.
  // Requiring a numeric duration badge excludes live, upcoming and premieres.
  const eligible = (i) =>
    i.id && !i.hidden && !i.manualHide && !i.watched && !i.isShort &&
    !i.scheduled && i.isVod;
  const candidate = diag.items.find(eligible);
  if (!candidate) {
    console.log("\n  no eligible test video — skipping");
    console.log("    (need an unwatched, visible, non-Short VOD with a duration badge; " +
                count(diag.items, (i) => !i.isVod) + " of " + diag.items.length +
                " renderers had no duration badge — live/upcoming/premiere)");
    return { skipped: "no candidate" };
  }
  if (!candidate.isVod) throw new Error("candidate selection let a non-VOD through");
  const id = candidate.id;
  console.log("\n  test video: " + id + "  " + JSON.stringify(candidate.title));

  // Remember whether this id was already cached, so we can leave the user's
  // cache exactly as we found it.
  const wasCached = await sw.evaluate(
    (vid) => new Promise((r) => chrome.storage.local.get({ cache: {} }, (d) => r(vid in d.cache))),
    id
  );

  const watchTab = await browser.newPage();
  await watchTab.goto("https://www.youtube.com/watch?v=" + id, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Belt and braces: feed badges can be stale, so confirm at the player itself
  // that this is a finite-duration VOD before asking for a timed watch.
  await watchTab.waitForTimeout(4000);
  const kind = await watchTab.evaluate(() => {
    const v = document.querySelector("#movie_player video");
    const p = document.querySelector("#movie_player");
    // .ytp-live-badge is present in the player chrome for EVERY video and is
    // merely hidden on VODs, so its existence proves nothing — it must be
    // tested for visibility. Finite duration is the authoritative signal.
    const badge = document.querySelector(".ytp-live-badge");
    return {
      duration: v ? (Number.isFinite(v.duration) ? v.duration : String(v.duration)) : "no player",
      liveClass: !!p?.classList.contains("ytp-live"),
      liveBadgeVisible: !!badge && badge.getClientRects().length > 0,
    };
  });
  if (kind.liveClass || kind.liveBadgeVisible || !Number.isFinite(kind.duration)) {
    console.log("  !! this is a LIVE stream at the player (" + JSON.stringify(kind) + ")");
    console.log("     percentage-watched is meaningless here — aborting this phase.");
    await watchTab.close();
    return { skipped: "live stream", id, kind };
  }
  console.log("  confirmed VOD, duration " + kind.duration + "s");

  await waitForEnter(
    "\n  A watch tab opened. Let it play past your watch threshold (skip any ad),\n" +
    "  then come back here and press Enter. Do NOT touch the feed tab.\n"
  );

  // Report what playback actually reached — otherwise a paused player silently
  // invalidates the whole result.
  const playback = await watchTab.evaluate(() => {
    const v = document.querySelector("#movie_player video");
    const p = document.querySelector("#movie_player");
    if (!v) return null;
    return {
      currentTime: +v.currentTime.toFixed(1),
      duration: Number.isFinite(v.duration) ? +v.duration.toFixed(1) : String(v.duration),
      pct: Number.isFinite(v.duration) && v.duration > 0 ? +((v.currentTime / v.duration) * 100).toFixed(1) : null,
      paused: v.paused,
      adShowing: !!p?.classList.contains("ad-showing"),
    };
  });
  console.log("  playback reached: " + JSON.stringify(playback));
  if (!playback || playback.pct === null || playback.currentTime === 0) {
    console.log("  !! the player never advanced — this result is inconclusive, not a failure");
  }
  if (playback?.adShowing) {
    console.log("  !! an ad was showing at sample time — currentTime is the AD's, not the video's");
  }

  await watchTab.close();
  await page.waitForTimeout(3000); // scan debounce + a drift tick

  const after = await readDiag(page);
  const item = after.items.find((i) => i.id === id);
  const nowCached = await sw.evaluate(
    (vid) => new Promise((r) => chrome.storage.local.get({ cache: {} }, (d) => r(vid in d.cache))),
    id
  );

  const hidden = !!item?.hidden;
  console.log("\n  ── result (feed tab was NOT reloaded) ──");
  console.log("     video still present in feed: " + !!item);
  console.log("     cached before / after:       " + wasCached + " / " + nowCached);
  console.log("     progress bar now in feed DOM:" + (item ? item.progressDom : "n/a"));
  console.log("     extension considers watched: " + (item ? item.watched : "n/a"));
  console.log("     HIDDEN WITHOUT RELOAD:       " + hidden + (hidden ? "  ✓" : "  ✗ (this is the gap)"));

  // Restore the cache if we introduced this entry.
  if (!wasCached && nowCached) {
    await sw.evaluate(
      (vid) => new Promise((r) => chrome.storage.local.get({ cache: {} }, (d) => {
        delete d.cache[vid];
        chrome.storage.local.set({ cache: d.cache }, r);
      })),
      id
    );
    console.log("     (test entry removed from your cache)");
  }

  return { id, title: candidate.title, wasCached, nowCached, playback, hiddenWithoutReload: hidden, item };
}

(async () => {
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
  await sw.evaluate(() => new Promise((r) => chrome.storage.sync.set({ enabled: true }, r)));

  const page = await browser.newPage();
  await page.goto(SUBS_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  try {
    await page.locator('button:has-text("Reject all"), button:has-text("Reject the use"), button:has-text("Confirm")').first().click({ timeout: 3000 });
  } catch {}

  // state:"attached", NOT the default "visible" — the extension sets
  // display:none on hidden videos and whole sections, so a feed the extension
  // has already acted on can be fully attached yet entirely invisible.
  try {
    await page.waitForSelector("ytd-rich-item-renderer, ytd-video-renderer", { state: "attached", timeout: 45000 });
  } catch {
    console.log("\nNo video renderers attached after 45s — collecting a census anyway.");
  }
  await page.waitForTimeout(3000);

  const dump = {};
  dump.census = await census(page);
  printCensus(dump.census);

  // Manual gate: lets you dismiss dialogs, switch grid/list view, or just wait
  // for a slow feed before anything is measured.
  await waitForEnter("\nGet the Subscriptions feed into the state you want measured, then press Enter...\n");

  const initial = await readDiag(page);
  if (!initial) {
    console.log("\n!! The content script did not respond to hw-diag.");
    console.log("   Either it is not running on this URL, or isTargetPage() rejected it.");
    console.log("   Census above shows what is actually in the DOM.");
    dump.censusFinal = await census(page);
    printCensus(dump.censusFinal);
    const out = path.join(os.tmpdir(), "subs-diagnostic-" + Date.now() + ".json");
    fs.writeFileSync(out, JSON.stringify(dump, null, 2));
    console.log("\nDump written to:\n  " + out);
    await waitForEnter("Press Enter to close...\n");
    await browser.close();
    return;
  }
  printReport("SUBSCRIPTIONS — extension ENABLED", initial);
  console.log("\n  scans during " + IDLE_MS / 1000 + "s idle: " + (await measureIdleScans(page)) + "   (drift tick is 2s; 0 = settled)");
  dump.initial = initial;

  // ── Does cost grow with the feed? ────────────────────────
  // Programmatic scrolling does not reliably trigger YouTube's infinite scroll,
  // so the feed is grown by hand. Scroll far enough to load several more pages —
  // the point of this phase is to measure the extension against a large feed.
  const before = initial.items.length;
  await waitForEnter(
    "\nNow scroll the Subscriptions feed down BY HAND to load more videos\n" +
    "(currently " + before + " renderers). Then press Enter...\n"
  );
  // Let the 300ms scan debounce and a drift tick settle, so the snapshot is not
  // taken while renderers are still streaming in.
  await page.waitForTimeout(3000);

  const scrolled = await readDiag(page);
  printReport("AFTER INFINITE SCROLL", scrolled);
  const grew = scrolled.items.length - before;
  console.log("\n  renderers: " + before + " -> " + scrolled.items.length +
              (grew > 0 ? "  (+" + grew + ")" : "  (NO GROWTH — this phase measured nothing new)"));
  console.log("  scans during " + IDLE_MS / 1000 + "s idle: " + (await measureIdleScans(page)) +
              "   (with " + scrolled.items.length + " renderers on the page)");
  dump.scrolled = scrolled;

  // ── Does turning it off actually restore the page? ───────
  console.log("\nToggling the extension OFF (as the popup does)...");
  await sw.evaluate(() => new Promise((r) => chrome.storage.sync.set({ enabled: false }, r)));
  await page.waitForTimeout(4000);

  const off = await readDiag(page);
  printReport("SUBSCRIPTIONS — extension DISABLED", off);
  console.log("\n  scans during " + IDLE_MS / 1000 + "s idle: " + (await measureIdleScans(page)));
  console.log("\n  >>> with the extension OFF these should all be 0:");
  console.log("      videos still hidden:  " + count(off.items, (i) => i.hidden));
  console.log("      sections still hidden:" + off.sections.filter((s) => s.hidden).length);
  console.log("      age/scheduled/playable hidden: " +
    count(off.items, (i) => i.ageHidden) + " / " +
    count(off.items, (i) => i.scheduledHidden) + " / " +
    count(off.items, (i) => i.playableHidden));
  dump.disabled = off;

  await sw.evaluate(() => new Promise((r) => chrome.storage.sync.set({ enabled: true }, r)));
  await page.waitForTimeout(2000);

  // ── Watch propagation (runs last: it opens a second tab) ─
  console.log("\n════════ WATCH PROPAGATION ════════");
  console.log("  Does a video watched in ANOTHER TAB disappear from the feed");
  console.log("  without reloading it? Today this is expected to FAIL — nothing");
  console.log("  writes to the cache from a watch page.");
  dump.watchPropagation = await checkWatchPropagation(browser, page, sw, await readDiag(page));

  const out = path.join(os.tmpdir(), "subs-diagnostic-" + Date.now() + ".json");
  fs.writeFileSync(out, JSON.stringify(dump, null, 2));
  console.log("\nFull per-renderer dump written to:\n  " + out);

  console.log("\nDone. Browser stays open so you can inspect the page.");
  await waitForEnter("Press Enter to close...\n");
  await browser.close();
})();
