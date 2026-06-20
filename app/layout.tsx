import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Golf Scoring',
  description: 'Anything But Golf Group — live scoring',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Golf Scoring',
  },
  icons: {
    icon: [
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icon-180.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#0f172a',
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">
        <div className="min-h-full" style={{ background: 'var(--background)' }}>
        {children}
        </div>
        <script dangerouslySetInnerHTML={{
          __html: `
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
  // When a NEW service worker takes control (= update, not first install),
  // reload the page so users always run the latest code without having to
  // manually close the PWA. We defer to the next foreground cycle so we
  // never interrupt someone who is actively entering scores.
  var hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (!hadController) { hadController = true; return; } // first install, skip
    function reloadOnVisible() {
      if (document.visibilityState === 'visible') {
        document.removeEventListener('visibilitychange', reloadOnVisible);
        window.location.reload();
      }
    }
    if (document.visibilityState === 'hidden') {
      // Already in background — reload as soon as they open the app
      document.addEventListener('visibilitychange', reloadOnVisible);
    } else {
      // Visible right now — wait for them to background first, then reload on refocus
      document.addEventListener('visibilitychange', function waitForHide() {
        if (document.visibilityState === 'hidden') {
          document.removeEventListener('visibilitychange', waitForHide);
          document.addEventListener('visibilitychange', reloadOnVisible);
        }
      });
    }
  });
}
          `
        }} />
      </body>
    </html>
  )
}
