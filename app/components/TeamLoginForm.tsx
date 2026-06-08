'use client'

import { useActionState, useState, useEffect, useRef } from 'react'
import { teamLogin } from '@/app/actions'

type Team = { id: string; name: string }
type Round = { id: string; name: string; date: string; course: string; balls_count: number }

const navy = '#0f172a'
const gold = '#f59e0b'

export default function TeamLoginForm({ teams, round }: { teams: Team[]; round: Round }) {
  const [state, action, pending] = useActionState(teamLogin, null)
  const [showPin, setShowPin] = useState(false)
  const ballLabels = Array.from({ length: round.balls_count }, (_, i) => `${i + 1}-ball`).join(', ')
  const formattedDate = new Date(round.date + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })

  const headerRef = useRef<HTMLElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const header = headerRef.current
    if (!header) return
    const ro = new ResizeObserver(() => {
      if (spacerRef.current) spacerRef.current.style.height = `${header.offsetHeight}px`
    })
    ro.observe(header)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>
      <header ref={headerRef} className="text-white pb-7 px-4 text-center shadow-md z-10" style={{ position: 'fixed', top: 0, left: 0, right: 0, background: navy, paddingTop: 'calc(1.75rem + env(safe-area-inset-top))' }}>
        <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: gold }}>
          Anything But Golf Group
        </p>
        <h1 className="text-2xl font-bold">{round.name}</h1>
        <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
          {round.course && `${round.course} · `}{formattedDate}
        </p>
        <p className="text-xs mt-1" style={{ color: gold }}>
          Playing {ballLabels}
        </p>
      </header>
      <div ref={spacerRef} />

      <main className="max-w-sm mx-auto px-4 pt-8">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-5">Enter Your Scores</h2>
          <form action={action} className="space-y-4">
            {state?.error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{state.error}</p>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Your Team</label>
              <select name="teamId" required defaultValue=""
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 bg-white text-gray-900 focus:outline-none">
                <option value="" disabled>Select your team…</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Team PIN</label>
              <div className="relative">
                <input type={showPin ? 'text' : 'password'} name="pin" inputMode="numeric" maxLength={4} required
                  placeholder="4-digit PIN"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 pr-10 text-gray-900 focus:outline-none" />
                <button type="button" tabIndex={-1} onClick={() => setShowPin(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none">
                  {showPin
                    ? <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:'1rem',height:'1rem'}}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:'1rem',height:'1rem'}}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">Your PIN was set when the team was created.</p>
            </div>
            <button type="submit" disabled={pending}
              className="w-full text-white py-3 rounded-xl font-semibold transition active:scale-95 disabled:opacity-60"
              style={{ background: navy }}>
              {pending ? 'Verifying…' : 'Open Scorecard'}
            </button>
          </form>
        </div>

        <div className="mt-5 text-center space-y-2">
          <a href="/leaderboard" className="block font-medium hover:underline" style={{ color: navy }}>
            View Live Leaderboard →
          </a>
        </div>
      </main>
    </div>
  )
}
