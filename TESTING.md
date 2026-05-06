# Testing Plan

## Setup

1. Load the extension unpacked via `chrome://extensions` with Developer mode enabled
2. Ensure you have a YouTube account with some watch history (partially and fully watched videos)
3. Test in both light and dark YouTube themes

## Core functionality

### Auto-hide watched videos

- [ ] **Home page** — Navigate to `youtube.com`. Videos with progress bars should be hidden. Unwatched videos remain visible.
- [ ] **Subscriptions** — Navigate to `/feed/subscriptions`. Same behavior.
- [ ] **Channel videos** — Visit a channel's videos tab (`/@channel/videos`). Watched videos hidden.
- [ ] **Channel streams** — Visit a channel's streams tab (`/@channel/streams`). Watched videos hidden.
- [ ] **Partially watched** — With threshold at 1%, a video with any progress is hidden. Increase threshold to 50% and confirm videos with less progress reappear.
- [ ] **Non-target pages** — Visit a watch page, search results, or playlist. Extension should not hide anything or inject buttons.

### Toggle on/off

- [ ] Open the popup and toggle off. All hidden videos should reappear immediately.
- [ ] Toggle back on. Watched videos hide again.
- [ ] Verify the extension icon changes appearance when disabled.

### Mark as watched (individual)

- [ ] Hover over an unwatched video thumbnail — the eye icon button should appear.
- [ ] Click it — the video should be replaced by an undo card ("Video hidden" + Undo button).
- [ ] Click Undo within 60 seconds — the video reappears with its eye icon button.
- [ ] Mark another video and wait 60 seconds — the undo card disappears and the video is fully hidden.
- [ ] Confirm the manually marked video stays hidden across page navigations.

### Mark All Watched (popup)

- [ ] On a page with visible unwatched videos, click "Mark All Watched" in the popup.
- [ ] Button should disable and show the count of videos marked (e.g., "Marked 12").
- [ ] All visible videos on the page should be hidden.
- [ ] Button resets to "Mark All Watched" after 2 seconds.
- [ ] Click "Mark All Watched" on a non-YouTube tab — button should show "No videos found".
- [ ] Click "Mark All Watched" when all videos are already hidden — should show "Marked 0".

### Shorts

- [ ] On a page with a Shorts shelf, Shorts without progress bars remain visible.
- [ ] The eye icon button appears in the Shorts metadata area (not on the thumbnail).
- [ ] Clicking the eye icon on a Short hides it.
- [ ] "Mark All Watched" also marks and hides visible Shorts.
- [ ] If watched videos are hidden from a Shorts shelf, the extension clicks "Show more" to reveal additional items.

### "Most relevant" section

- [ ] On the Subscriptions page, the "Most relevant" section is hidden by default.
- [ ] In Settings, uncheck "Hide Most relevant" — section reappears.
- [ ] Re-check it — section hides again.

## Settings

### Watch threshold

- [ ] Open Settings from the popup.
- [ ] Drag the threshold slider to 50%. Videos with less than 50% progress should reappear.
- [ ] Set to 100%. Only fully watched videos should be hidden.
- [ ] Set back to 1%. Any progress hides the video.
- [ ] "Saved" flash message appears on change.

### Cache management

- [ ] Mark several videos as watched manually.
- [ ] Open Settings — cache count should reflect the number of manually marked videos.
- [ ] Click "Clear cache" — count resets to 0, and manually hidden videos reappear on the next page load.
- [ ] "Cache cleared" flash message appears.

## Edge cases

- [ ] **SPA navigation** — Navigate between Home, Subscriptions, and a channel without full page reloads. Hiding should activate/deactivate correctly on each page.
- [ ] **Infinite scroll** — Scroll down to load more videos. Newly loaded watched videos should be hidden automatically.
- [ ] **Empty sections** — If all videos in a section are hidden, the entire section should collapse (not leave empty whitespace).
- [ ] **Extension reload** — Reload the extension from `chrome://extensions`. Navigate to YouTube. Everything should work without requiring a page refresh (though a refresh of the YouTube tab is expected).
- [ ] **Multiple tabs** — Open YouTube in two tabs. Mark a video as watched in tab 1. Switch to tab 2 and verify the video is also hidden (via storage change listener).
- [ ] **Settings sync** — If signed into Chrome on two devices, changing the threshold on one should sync to the other.

## Dark mode

- [ ] Switch YouTube to dark theme. Undo cards should have a dark background (`#272727`) and light text.
- [ ] Eye icon buttons should be visible against dark thumbnails.
- [ ] Popup and options page should render cleanly (they use system fonts, not YouTube's theme, so just verify no broken contrast).

## Performance

- [ ] On a page with 50+ videos, the extension should not cause visible jank or lag while scrolling.
- [ ] Rapidly toggling the extension on/off from the popup should not cause layout thrashing or errors in the console.
