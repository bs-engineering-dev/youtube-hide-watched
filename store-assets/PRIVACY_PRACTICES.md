# Chrome Web Store — Privacy Practices

Answers for the Privacy practices tab when publishing.

## Single purpose description

Hide videos you have already watched from YouTube's home page, Subscriptions feed, and channel pages so you only see new content.

## Permission justifications

### activeTab

Used to send a message from the popup to the active YouTube tab when the user clicks "Mark All Watched." This lets the popup trigger the content script to mark every visible video as watched. No other tab data is accessed.

### Host permissions (youtube.com content script match pattern)

A content script matching *://*.youtube.com/* is required so the extension can read video thumbnail progress bars, hide watched videos, and inject "mark as watched" buttons directly on the page. This is the core functionality of the extension. No data is read from or sent to any other site, and no network requests are made.

### storage

Used to save user preferences (enabled state, watch threshold, max age) via chrome.storage.sync so settings persist and sync across devices. Also used to store a local cache of manually marked video IDs via chrome.storage.local so those videos stay hidden across page loads.

### Remote code

This extension does not use any remote code. All JavaScript is bundled locally in the extension package. There are no external script loads, no CDN imports, no fetch calls, and no use of eval() or dynamic code execution.

## Data usage certification

- This extension does not collect or transmit any user data.
- All data (settings and marked video IDs) is stored locally in the browser using the Chrome storage API.
- No data is sold to third parties.
- No data is used for purposes unrelated to the extension's single purpose.
- No data is used for creditworthiness or lending purposes.
