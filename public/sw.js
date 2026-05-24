self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

// Do NOT intercept fetch events.
// When the SW re-fetches navigation requests (mode: 'navigate') via fetch(e.request),
// some browsers (Safari / iOS PWA) don't include httpOnly cookies in the re-issued
// request, causing the server to render pages as if the user is logged out.
// Removing the fetch handler lets the browser own all requests directly, so cookies
// are always sent correctly for both page navigations and same-origin API calls.
