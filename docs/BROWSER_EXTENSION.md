# Browser extension

`apps/extension` — Manifest V3, plain JavaScript, no build step, no remote code, no analytics.

**Permissions:** `activeTab`, `scripting`, `storage`, `contextMenus`. **No host permissions.** The extension can only read the page you are on, and only after you click. The LifeOS server answers CORS for extension origins on bearer-token requests only (no cookies), so the extension never needs access to any website.

**Features:** save this page (title + URL), save selected text, save a note, add a task (quick-add parsing), context-menu items for selection/link/page. Everything lands in the Inbox for review (tasks are created directly).

**Setup:** LifeOS → Settings → *Browser extension & API tokens* → Create token (scopes `capture:write`, `tasks:write`). In Chrome/Edge: `chrome://extensions` → Developer mode → *Load unpacked* → select `apps/extension`. Open the popup, enter the server address and token.

**Verified:** E2E loads the unpacked extension in Chromium, connects with a scoped token, saves a note and a task, and checks they arrive with `source_app = browser-extension`. Not verified: context-menu clicks and "save selected text" on a real page (they use the same API path), Firefox/Safari packaging (Firefox MV3 would need `browser_specific_settings`; not done). Not published to any store.
