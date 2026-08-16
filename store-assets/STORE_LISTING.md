# Chrome Web Store Listing

## Name

Hide Watched YouTube Videos

## Summary (132 characters max)

Hides videos you've already watched from YouTube's home page, Subscriptions feed, and channel pages. See only what's new.

## Description

Tired of scrolling past videos you've already seen? This extension automatically hides watched videos from YouTube so your feed only shows what's new.

**How it works**

The extension detects YouTube's built-in progress bars on video thumbnails. If a video has any watch progress, it gets hidden. No account access required — it works entirely from what's visible on the page.

While you are watching a video it also notes how far through you are, so the video disappears from feeds you already have open in other tabs. Nothing is hidden or changed on the watch page itself, and nothing ever leaves your browser.

This is what makes Shorts work too. Shorts rarely show a progress bar on their thumbnail, so playing one is how the extension learns you have seen it — and because Shorts loop instead of ending, it remembers the furthest point you reached rather than wherever the player stopped.

**Where it works**
- YouTube home page
- Subscriptions feed
- Channel pages (videos, streams, and Shorts)

(On watch pages the extension only notes your playback position — it never hides or changes anything there.)

**Features**
- One-click toggle to turn hiding on or off
- "Mark All Watched" button to clear your entire feed at once
- Mark individual videos as watched with the eye icon on any thumbnail
- Adjustable watch threshold — set the minimum percentage before a video is hidden
- Subscriptions max age — hide videos older than a set number of days and stop loading more once everything is past the cutoff (does not apply to Shorts)
- Optionally hide the "Most relevant" section on Subscriptions
- Hide scheduled videos — upcoming premieres and scheduled streams can be hidden
- No refresh needed — videos you watch vanish from feeds already open in other tabs
- Shorts you play are remembered, even though their thumbnails show no progress bar
- Undo support when you accidentally mark a video
- Works with YouTube's dark mode
- Localized in 20 languages (translations are in beta — report issues on GitHub)
- Settings sync across your Chrome devices

**Pin it to your toolbar**

For quick access, pin the extension to your browser toolbar:
1. Click the puzzle piece icon (Extensions) in your browser toolbar
2. Find "Hide Watched YouTube Videos" in the list
3. Click the pin icon next to it

Once pinned, you can toggle hiding and mark videos as watched with a single click.

**Browser compatibility**

Works on desktop Chromium-based browsers: Chrome, Edge, Brave, Helium, Opera, and others. Does not work on mobile browsers (mobile Chrome, Safari, etc.) as they do not support Chrome extensions.

**A note about Shorts**

Shorts you play with the extension installed are hidden just like regular videos — including on the Subscriptions Shorts tab. Because Shorts loop rather than end, the extension remembers the furthest point you reached, so one you watched all the way through stays hidden even if it has looped back to the start by the time you swipe away.

What it cannot do is detect a Short you watched *before* installing the extension, or on another device: YouTube rarely draws a progress bar on a Short's thumbnail, so there is nothing on the page to read. Mark those manually with the eye icon or the "Mark All Watched" button.

Separately, the Subscriptions max age setting does not apply to Shorts. YouTube shows a view count on Shorts but never an upload age, so the extension has no date to compare against and Shorts stay visible regardless of how old they are.

**Support & feedback**

Found a bug or have a feature request? Open an issue on GitHub:
https://github.com/bs-engineering-dev/youtube-hide-watched/

**Privacy**

This extension does not collect, transmit, or share any data. All settings and marked videos are stored locally in your browser. It does not access your Google account or YouTube watch history.

## Languages (beta)

English, Arabic, Bengali, Chinese (Simplified), French, German, Hindi, Indonesian, Japanese, Korean, Marathi, Portuguese (Brazil), Russian, Spanish, Swedish, Tamil, Telugu, Thai, Turkish, Vietnamese

Translations are machine-generated and may not be perfect. If you notice an issue, please report it on GitHub.
