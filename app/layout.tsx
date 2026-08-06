import type { Metadata, Viewport } from 'next'
import './globals.css'

const SITE_NAME = 'Anything But Golf Scoring'
const SITE_DESCRIPTION = 'Live scoring for the Saturday golf group — Daytona, Banker, matchups and payouts.'

export const metadata: Metadata = {
  // Needed for the share card: relative image paths only become the absolute
  // URLs a link preview requires once there's a base to resolve them against.
  metadataBase: new URL('https://abgscoring.vercel.app'),
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  manifest: '/manifest.json',
  // What iMessage, Slack and the rest read when the link is shared. Without
  // these there's nothing to build a preview from, so the link stays a bare
  // grey bubble. The image itself comes from app/opengraph-image.tsx.
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ABG Scoring',
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
  // Stops iOS auto-zooming into focused inputs (the screen "jolt" when a
  // keyboard opens). Deliberate pinch-zoom still works — Safari ignores the
  // cap for user-initiated gestures.
  maximumScale: 1,
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
