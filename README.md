# Hide Watched YouTube Videos

A Chrome extension that hides videos you've already watched from YouTube, so you only see what's new.

## Features

- **Auto-hide watched videos** on the YouTube home page, Subscriptions feed, and channel pages (videos, streams, and Shorts)
- **Adjustable watch threshold** — choose the minimum percentage watched before a video is hidden (default: any progress)
- **Mark as watched** button on video thumbnails to manually hide videos you don't want to see
- **Mark All Watched** button in the popup to hide every visible video on the page at once
- **Hide "Most relevant" section** on the Subscriptions page (optional, on by default)
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
| Watch page, Search, Playlists | No (not applicable) |

## Installation

### From the Chrome Web Store

Install directly from the [Chrome Web Store listing](#).

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

**Settings** (via the popup or right-click the extension icon > Options):
- **Watch threshold** — Percentage of a video that must be watched before it's hidden (1%–100%)
- **Hide "Most relevant"** — Toggle the "Most relevant" section on the Subscriptions page
- **Clear cache** — Remove all manually marked videos

## Browser compatibility

This extension works on desktop Chromium-based browsers: Chrome, Edge, Brave, Helium, Opera, and others. It does not work on mobile browsers — Chrome for Android, Safari on iOS, and other mobile browsers do not support Chrome extensions.

## Shorts caveat

YouTube Shorts don't consistently display progress bars on their thumbnails, so the extension can't always auto-detect which Shorts you've watched. You can still manually mark Shorts as watched using the eye icon or the "Mark All Watched" button in the popup.

## How it works

The extension reads YouTube's built-in progress bars on video thumbnails to determine what you've watched. It does not access your YouTube/Google account or watch history API — everything is detected from what's visible on the page.

Manually marked videos are stored in Chrome's local storage. Your enabled/threshold/preference settings sync across devices via Chrome Sync.

## Permissions

| Permission | Why |
|------------|-----|
| `storage` | Save settings and manually marked videos |
| `activeTab` | Send "mark all watched" command to the current YouTube tab |
| Host access (`youtube.com`) | Inject the content script that detects and hides watched videos |

## License

MIT
