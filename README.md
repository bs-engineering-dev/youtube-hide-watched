# Hide Watched YouTube Videos

A Chrome extension that hides videos you've already watched from YouTube, so you only see what's new.

## Features

- **Auto-hide watched videos** on the YouTube home page, Subscriptions feed, and channel pages (videos, streams, and Shorts)
- **Adjustable watch threshold** — choose the minimum percentage watched before a video is hidden (default: any progress)
- **Mark as watched** button on video thumbnails to manually hide videos you don't want to see
- **Mark All Watched** button in the popup to hide every visible video on the page at once
- **Subscriptions max age** — hide videos older than a configurable number of days on the Subscriptions page, and automatically stop loading more once everything is past the cutoff
- **Hide "Most relevant" section** on the Subscriptions page (optional, on by default)
- **Hide "Shorts" sections** on the home page and Subscriptions page (optional, off by default)
- **Hide scheduled videos** — hide upcoming premieres and scheduled streams (optional, off by default)
- **No refresh needed** — watch a video in another tab and it disappears from an already-open feed; the extension notes your progress on the watch page and every open feed tab updates itself
- **Shorts you watch are remembered** — playing a Short marks it watched even though its thumbnail never grows a progress bar, and watching one all the way through counts as fully watched no matter where it loops back to
- **Undo support** — accidentally mark something? An undo card appears for 60 seconds
- **Dark mode** support — follows YouTube's theme

## Where it works

| Page | Supported |
|------|-----------|
| Home (`youtube.com`) | Yes |
| Subscriptions (`/feed/subscriptions`) | Yes |
| Channel videos (`/@channel`, `/@channel/videos`) | Yes |
| Channel streams (`/@channel/streams`) | Yes |
| Shorts shelves on the above pages | Yes |
| Subscriptions Shorts tab (`/feed/subscriptions/shorts`) | Manual marking, plus Shorts you've played |
| Watch page (`/watch`, `/shorts/…`) | Records your progress only — nothing is hidden or changed on the page |
| Search, Playlists | No (not applicable) |

## Installation

### From the Chrome Web Store

Install directly from the [Chrome Web Store listing](#).

### Report issues

Found a bug or have a feature request? [Open an issue on GitHub](https://github.com/bs-engineering-dev/youtube-hide-watched/issues).

### From source

1. Clone this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the project folder
5. Navigate to YouTube — watched videos will be hidden automatically

## Usage

**Popup controls** — Click the extension icon to:
- Toggle hiding on/off
- Mark all visible videos as watched
- Open settings

**Per-video control** — Hover over any unwatched video's thumbnail to reveal the mark-as-watched button (eye icon).

**Settings** (all accessible from the popup):
- **Watch threshold** — Percentage of a video that must be watched before it's hidden (1%–100%)
- **Subscriptions max age** — Hide videos older than 1–90 days on the Subscriptions page (0 = off). When enabled, infinite scroll stops once all loading videos are past the cutoff. Does not apply to Shorts — see [Shorts caveat](#shorts-caveat).
- **Hide "Most relevant"** — Toggle the "Most relevant" section on the Subscriptions page
- **Hide "Shorts"** — Toggle Shorts sections on the home page and Subscriptions page
- **Hide scheduled videos** — Hide upcoming premieres and scheduled live streams
- **Clear cache** — Remove all manually marked videos

## Localization (beta)

The extension UI is translated into 20 languages. Translations are machine-generated and may contain errors — if you spot an issue, please [open an issue](https://github.com/bs-engineering-dev/youtube-hide-watched/issues) and let us know.

## Browser compatibility

This extension works on desktop Chromium-based browsers: Chrome, Edge, Brave, Helium, Opera, and others. It does not work on mobile browsers — Chrome for Android, Safari on iOS, and other mobile browsers do not support Chrome extensions.

## Shorts caveat

YouTube Shorts don't consistently display progress bars on their thumbnails, so a Short you watched before installing the extension — or watched on another device — can't be detected from the feed alone. You can always mark those manually with the eye icon or the "Mark All Watched" button.

**Shorts you play with the extension installed are remembered.** Watching one past your threshold records it, and it disappears from your feeds without a reload, exactly like a regular video. Because Shorts loop, the extension tracks the furthest point you reached rather than wherever the player happens to be sitting — so a Short you watched all the way through stays hidden even if it has looped back around to the beginning by the time you swipe away.

This also covers the Subscriptions Shorts tab (`/feed/subscriptions/shorts`): Shorts you've played are hidden there too. Hiding by *age* is still unavailable on that tab, and everywhere else — see below.

**Subscriptions max age never applies to Shorts, anywhere.** YouTube renders a view count on Shorts but never an upload age, in any language, so the extension has no date to compare against. Shorts stay visible no matter how old they are or how low you set the cutoff — including Shorts appearing in the main Subscriptions feed, not just on the Shorts tab.

## How it works

The extension reads YouTube's built-in progress bars on video thumbnails to determine what you've watched. It does not access your YouTube/Google account or watch history API — everything is detected from what's visible on the page.

On a watch page it also reads the player's current position, so a video you watch is remembered without waiting for YouTube to redraw the feed. YouTube never updates an already-rendered feed, so without this a video watched in another tab stays visible until you reload. Nothing is hidden or altered on the watch page itself, and the position never leaves your browser.

This is also how Shorts get detected, since their thumbnails often carry no progress bar at all. Shorts loop rather than ending, so the extension records the furthest point you reached and treats a completed lap as fully watched — otherwise a Short you watched three times could be read as barely started.

Manually marked videos are stored in Chrome's local storage. Your enabled/threshold/preference settings sync across devices via Chrome Sync.

## Permissions

| Permission | Why |
|------------|-----|
| `storage` | Save settings and manually marked videos |
| `activeTab` | Send "mark all watched" command to the current YouTube tab |
| Host access (`youtube.com`) | Inject the content script that detects and hides watched videos |

## Development

### Prerequisites

- [Bun](https://bun.sh/) (v1.3+)

### Setup

```sh
bun install
```

### Running tests

```sh
bun run test
```

Tests use Playwright to launch Chromium with the extension loaded. Some tests that hit live YouTube pages will skip on fresh browser profiles without login/consent.

### Releasing

1. Bump the `version` in `manifest.json`
2. Commit and push (or merge a PR) to `main`
3. CI detects the version change, runs tests, builds the extension zip, creates a git tag (`v1.x.x`), and publishes a GitHub Release with the artifact attached
4. Download the zip from the release and upload it to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)

### Regenerating store assets

```sh
node store-assets/generate.mjs
```

This uses Playwright to render and screenshot mock YouTube pages. Output goes to `store-assets/`.

## License

MIT
