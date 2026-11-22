/* LifeOS service worker.
 * Privacy rule: pages and API responses are never cached — they contain
 * personal data. Only the static app shell (/offline, icons, built JS/CSS)
 * is cached, so the app opens offline to a page that can save drafts. */
const VERSION = 'lifeos-v1';
const SHELL = ['/offline', '/icon.svg', '/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/_next/static/') || SHELL.includes(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
      return res;
    })));
    return;
  }
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/offline')));
  }
});

self.addEventListener('push', (e) => {
  let data = { title: 'LifeOS', body: 'You have a reminder.', url: '/app', tag: undefined };
  try { data = { ...data, ...e.data.json() }; } catch { /* keep defaults */ }
  e.waitUntil(self.registration.showNotification(data.title, { body: data.body, tag: data.tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: data.url } }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || '/app', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url === target && 'focus' in c) return c.focus();
    return self.clients.openWindow(target);
  }));
});
