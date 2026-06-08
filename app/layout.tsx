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
          __html: `if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js')`
        }} />
        <script dangerouslySetInnerHTML={{ __html: `
(function(){
  var html=document.documentElement;
  html.style.background='#0f172a';
  function upd(){
    var se=document.scrollingElement||html;
    html.style.background=se.scrollTop<30?'#0f172a':'#f8fafc';
  }
  ['scroll','touchend'].forEach(function(e){window.addEventListener(e,upd,{passive:true});});
})();
        `}} />
      </body>
    </html>
  )
}
