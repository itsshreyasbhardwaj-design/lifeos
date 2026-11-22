# PWA support

* `public/manifest.webmanifest`: name, icons (192, 512, maskable 512, SVG), standalone display, theme colours, shortcuts (Capture, Inbox, Today), **share target** (`POST /share`, multipart: title, text, url, files).
* `public/sw.js`: caches only the static shell (`/offline`, icons, manifest, `/_next/static`). **Pages and API responses are never cached** — they contain personal data. Offline navigation falls back to `/offline`, which can save drafts to IndexedDB. Handles `push` and `notificationclick`.
* Registered from the app shell; verified in E2E (`navigator.serviceWorker.ready` has an active worker on Chromium).

| Platform | Install | Share target | Push |
|---|---|---|---|
| Chrome / Edge desktop | Yes | Yes (Chromium supports it) | Yes |
| Chrome on Android | Yes | Yes | Yes (battery settings may delay) |
| Safari iOS/iPadOS | Add to Home Screen | **No** (Safari has no Web Share Target) | Only when added to Home Screen, 16.4+ |
| Firefox desktop | No install prompt | No | Yes |

Verified in this build: manifest contents, service worker activation, `/share` endpoint accepting a multipart post and landing in the Inbox (Chromium automation). **Not verified on real Android or iOS devices**; no native share extension exists.
