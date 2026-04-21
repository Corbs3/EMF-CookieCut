# CookieCut

A Chrome extension that automatically declines non-essential cookies on every page you visit.

No more clicking "Reject All" manually. CookieCut handles it silently in the background.

## Features

- **Automatic cookie rejection** on every page load with no interaction needed
- **9 named CMP handlers** - OneTrust, CookieBot, TrustArc, Quantcast, Didomi, Osano, Usercentrics, CookieYes, iubenda
- **Generic fallback** - text, aria-label, and data-attribute matching for unlisted CMPs
- **Site-specific rules** - hardcoded selectors for BBC, Guardian, Google, YouTube, Reddit, and more
- **IAB TCF API support** - sends a direct consent signal where supported
- **Shadow DOM traversal** - finds buttons inside shadow roots
- **SPA navigation handling** - re-runs on page transitions in single-page apps
- **Two-step flow support** - opens settings panels and rejects from inside them
- **Activity log** - tracks which CMPs were declined and when
- **Badge counter** - shows total declines on the extension icon

## Installation (Developer Mode)

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked**
5. Select the `cookiecut` folder

## How It Works

CookieCut runs a content script on every page and attempts to decline cookies using this priority order:

1. IAB TCF API (direct signal, no UI interaction needed)
2. Site-specific selectors (BBC, Guardian, Google, etc.)
3. Named CMP handlers (OneTrust, CookieBot, etc.)
4. aria-label and data-attribute detection
5. Generic text matching against common decline phrases
6. Two-step flows (opens Settings panel, then rejects all)

It retries up to 10 times with a short delay to handle late-loading banners.

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Saves decline count and activity log locally |
| `host_permissions: <all_urls>` | Required to run on every website |

No data is sent anywhere. Everything is stored locally in your browser.

## File Structure

```
cookiecut/
  manifest.json   Extension config and permissions
  content.js      Main logic - runs on every page
  background.js   Service worker - tracks stats and updates badge
  popup.html      Extension popup UI
  popup.js        Popup logic - reads and displays stats
  icons/          Extension icons (16px, 48px, 128px)
```

## Browser Support

Chrome (Manifest V3). Should also work in Chromium-based browsers such as Edge and Brave via manual installation.

## Licence

MIT
