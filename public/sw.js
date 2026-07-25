self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

// Do NOT intercept fetch events.
// When the SW re-fetches navigation requests (mode: 'navigate') via fetch(e.request),
// some browsers (Safari / iOS PWA) don't include httpOnly cookies in the re-issued
// request, causing the server to render pages as if the user is logged out.
// Removing the fetch handler lets the browser own all requests directly, so cookies
// are always sent correctly for both page navigations and same-origin API calls.

// ── Web Push ──────────────────────────────────────────────────────────────────
self.addEventListener('push', (e) => {
  let data = {}
  try { data = e.data ? e.data.json() : {} } catch { /* non-JSON payload */ }
  const title = data.title || 'ABG Golf'
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' },
  }))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || '/'
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) { c.navigate(url); return c.focus() }
      }
      return clients.openWindow(url)
    })
  )
})
