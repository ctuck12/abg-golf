'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const navy = '#0f172a'
const gold = '#f59e0b'

export default function OrgLoginGate({
  orgSlug,
  orgName,
  error: initialError,
}: {
  orgSlug: string
  orgName: string | null
  error?: string
}) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState(initialError ?? '')
  const [pending, setPending] = useState(false)
  const [showPw, setShowPw] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setPending(true)
    try {
      const res = await fetch('/api/org-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: orgSlug, password }),
      })
      const data = await res.json()
      if (data.success) {
        router.refresh()
      } else {
        setError(data.error ?? 'Incorrect password.')
      }
    } catch {
      setError('Network error.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#f8fafc' }}>
      <header className="text-white pb-4 px-4 shadow-md sticky top-0 z-10" style={{ background: navy, paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
        <div className="max-w-sm mx-auto relative min-h-[72px]">
          <div
            className="absolute top-1/2 -translate-y-1/2 flex items-center gap-2.5"
            style={{ left: 'calc(50% - 125px)' }}
          >
            <div className="w-[72px] h-[72px] flex-shrink-0 rounded-3xl overflow-hidden">
              <img src="/abg-logo.jpg" alt="ABG" className="w-full h-full object-cover" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest leading-tight" style={{ color: gold }}>{orgName ?? 'Group Login'}</p>
              <h1 className="text-2xl font-bold leading-tight">Login</h1>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-start justify-center px-4 pt-12">
        <div className="w-full max-w-sm space-y-4">
          {!orgName ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-center">
              <p className="text-sm font-semibold text-red-700">{initialError ?? 'Group not found.'}</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
              <h2 className="font-semibold text-gray-900 mb-4 text-sm">Enter Group Password</h2>
              <form onSubmit={handleSubmit} className="space-y-3">
                {error && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
                )}
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Group/Admin Password"
                    required
                    autoFocus
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 pr-10 text-sm focus:outline-none"
                  />
                  <button type="button" tabIndex={-1} onClick={() => setShowPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none">
                    {showPw
                      ? <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:'1rem',height:'1rem'}}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      : <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:'1rem',height:'1rem'}}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={pending}
                  className="w-full text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-60 transition"
                  style={{ background: navy }}
                >
                  {pending ? 'Verifying…' : 'Enter Group'}
                </button>
              </form>
            </div>
          )}

          <a href="/" className="block text-center text-xs text-gray-400 hover:text-gray-600 py-2">
            ← Back to Groups
          </a>
        </div>
      </main>
    </div>
  )
}
