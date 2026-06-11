'use client'

import { useEffect, useState } from 'react'

const navy = '#0f172a'

type Platform =
  | 'ios-safari-new'   // iOS 17+ Safari
  | 'ios-safari-old'   // iOS 13–16 Safari
  | 'ios-chrome'       // Chrome on iOS (CriOS)
  | 'ios-other'        // Other iOS browsers
  | 'android-chrome'   // Chrome on Android
  | 'android-other'    // Other Android browsers
  | 'standalone'       // Already installed as PWA
  | 'desktop'
  | 'unknown'

function detectPlatform(): Platform {
  if (typeof window === 'undefined') return 'unknown'
  if (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  ) return 'standalone'

  const ua = navigator.userAgent
  const isIOS = /iPhone|iPad|iPod/i.test(ua)
  const isAndroid = /Android/i.test(ua)
  if (!isIOS && !isAndroid) return 'desktop'

  if (isIOS) {
    if (/CriOS/i.test(ua)) return 'ios-chrome'
    if (/Safari/i.test(ua) && !/CriOS|FxiOS|OPiOS|mercury/i.test(ua)) {
      const m = ua.match(/OS (\d+)_/)
      return m && parseInt(m[1]) >= 17 ? 'ios-safari-new' : 'ios-safari-old'
    }
    return 'ios-other'
  }

  if (/Chrome/i.test(ua) && !/OPR/i.test(ua)) return 'android-chrome'
  return 'android-other'
}

type Step = { num: number; text: React.ReactNode }

function getSteps(platform: Platform): Step[] {
  switch (platform) {
    case 'ios-safari-new':
      return [
        { num: 1, text: <>Tap the <strong>•••</strong> button in the bottom-right corner of Safari</> },
        { num: 2, text: <>Tap the <strong>Share ⬆</strong> button</> },
        { num: 3, text: <>Tap <strong>&ldquo;Add to Home Screen&rdquo;</strong></> },
        { num: 4, text: <>Tap <strong>&ldquo;Add&rdquo;</strong> to confirm</> },
      ]
    case 'ios-safari-old':
      return [
        { num: 1, text: <>Tap the <strong>Share ⬆</strong> button at the bottom of the screen</> },
        { num: 2, text: <>Scroll down and tap <strong>&ldquo;Add to Home Screen&rdquo;</strong></> },
        { num: 3, text: <>Tap <strong>&ldquo;Add&rdquo;</strong> in the top right to confirm</> },
      ]
    case 'ios-chrome':
      return [
        { num: 1, text: <>Tap the <strong>Share ⬆</strong> button in the address bar at the top</> },
        { num: 2, text: <>Scroll down and tap <strong>&ldquo;Add to Home Screen&rdquo;</strong></> },
        { num: 3, text: <>Tap <strong>&ldquo;Add&rdquo;</strong> to confirm</> },
      ]
    case 'android-chrome':
    case 'android-other':
      return [
        { num: 1, text: <>Tap the <strong>⋮</strong> three-dot menu in the top-right corner</> },
        { num: 2, text: <>Tap <strong>&ldquo;Add to Home Screen&rdquo;</strong> or <strong>&ldquo;Install App&rdquo;</strong></> },
        { num: 3, text: <>Tap <strong>&ldquo;Add&rdquo;</strong> to confirm</> },
      ]
    case 'ios-other':
      return [
        { num: 1, text: <>Open this page in <strong>Safari</strong> for the easiest install</> },
        { num: 2, text: <>Tap the <strong>Share ⬆</strong> button at the bottom</> },
        { num: 3, text: <>Tap <strong>&ldquo;Add to Home Screen&rdquo;</strong> then <strong>&ldquo;Add&rdquo;</strong></> },
      ]
    default:
      return []
  }
}

export default function AddToHomeScreen() {
  const [platform, setPlatform] = useState<Platform>('unknown')
  const [show, setShow] = useState(false)
  const [done, setDone] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)

  useEffect(() => {
    const p = detectPlatform()
    setPlatform(p)
    if (p === 'standalone' || p === 'desktop' || p === 'unknown') return
    if (localStorage.getItem('abg-aths-dismissed')) return
    setShow(true)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (e: any) => { e.preventDefault(); setDeferredPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  useEffect(() => {
    if (!show) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [show])

  function dismiss() {
    localStorage.setItem('abg-aths-dismissed', '1')
    setShow(false)
  }

  async function handleAndroidInstall() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') setDone(true)
    setDeferredPrompt(null)
  }

  if (!show) return null

  const isAndroid = platform === 'android-chrome' || platform === 'android-other'
  const canDirectInstall = isAndroid && !!deferredPrompt
  const steps = canDirectInstall ? [] : getSteps(platform)

  const NumberBadge = ({ n }: { n: number }) => (
    <span
      className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5"
      style={{ background: navy }}
    >
      {n}
    </span>
  )

  if (done) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center px-6"
        style={{ backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', background: 'rgba(0,0,0,0.45)' }}
      >
        <div className="bg-white rounded-3xl w-full max-w-sm px-8 pt-5 pb-8 text-center shadow-2xl border-2" style={{ borderColor: navy }}>
          <img src="/abg-logo.jpg" alt="ABG" className="w-32 h-32 mx-auto mb-2 rounded-full object-cover" />
          <div className="text-4xl mb-2">🎉</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">You&apos;re All Set!</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-6">
            Close your browser and open the <strong className="text-gray-800">ABG Golf</strong> app from your Home Screen for the full experience.
          </p>
          <button onClick={dismiss} className="text-sm text-gray-400">
            Continue in Browser Anyway
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', background: 'rgba(0,0,0,0.45)' }}
    >
      <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl border-2 overflow-hidden" style={{ borderColor: navy }}>
        <div className="px-6 pt-4 pb-4 text-center">
          <img src="/abg-logo.jpg" alt="ABG" className="w-32 h-32 mx-auto mb-2 rounded-full object-cover" />
          <h2 className="text-xl font-bold text-gray-900 mb-1">Get the Best Experience</h2>
          <p className="text-gray-500 text-sm leading-relaxed">
            Add this app to your Home Screen for a full-screen experience with no browser bar.
          </p>
        </div>

        {canDirectInstall ? (
          <div className="px-6 pb-2">
            <button
              onClick={handleAndroidInstall}
              className="w-full py-3.5 rounded-2xl font-bold text-white text-base"
              style={{ background: navy }}
            >
              Add to Home Screen
            </button>
          </div>
        ) : steps.length > 0 ? (
          <div className="mx-6 mb-2 rounded-2xl border-2 p-4 space-y-3" style={{ borderColor: navy }}>
            {steps.map((step) => (
              <div key={step.num} className="flex items-start gap-3">
                <NumberBadge n={step.num} />
                <p className="text-sm text-gray-700 leading-snug">{step.text}</p>
              </div>
            ))}
          </div>
        ) : null}

        <div className="px-6 pt-3 pb-6 space-y-3 text-center">
          <button
            onClick={() => setDone(true)}
            className="w-full py-3.5 rounded-2xl font-bold text-white text-base"
            style={{ background: navy }}
          >
            I Added It
          </button>
          <button onClick={dismiss} className="text-sm text-gray-400 block w-full">
            Continue in Browser Instead
          </button>
        </div>
      </div>
    </div>
  )
}
