'use client'

import { useState } from 'react'

type Team = { id: string; name: string }
type Round = { name: string; date: string; course: string; format?: string } | null

const navy = '#0f172a'
const gold = '#f59e0b'

export default function PreRoundHome({
  teams, round, orgSlug, orgId, orgName, isMaster,
}: {
  teams: Team[]
  round: Round
  orgSlug: string
  orgId: string
  orgName: string
  isMaster: boolean
}) {
  const isGroup = round?.format === 'daytona' || round?.format === 'traditional'
  const [showPin, setShowPin] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false)

  const formattedDate = round
    ? new Date(round.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null

  async function handlePinSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setPending(true)
    const form = e.currentTarget
    const teamId = (form.elements.namedItem('teamId') as HTMLSelectElement).value
    const pin = (form.elements.namedItem('pin') as HTMLInputElement).value
    try {
      const res = await fetch('/api/team-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, pin }),
      })
      const data = await res.json()
      if (data.success) {
        window.location.href = `/${orgSlug}/score/${data.teamId}`
      } else {
        setError(data.error ?? 'Login failed.')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setPending(false)
    }
  }

  async function handleSignOut() {
    await fetch('/api/org-logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId }),
    })
    window.location.href = isMaster ? '/master/dashboard' : `/${orgSlug}`
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#f8fafc' }}>
      <header className="text-white py-8 px-4 text-center shadow-md" style={{ background: navy }}>
        <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: gold }}>
          {orgName}
        </p>
        {round ? (
          <>
            <h1 className="text-2xl font-bold">{round.name}</h1>
            <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.6)' }}>
              {round.course && `${round.course} · `}{formattedDate}
            </p>
          </>
        ) : (
          <h1 className="text-2xl font-bold">Welcome</h1>
        )}
      </header>

      <main className="flex-1 flex items-start justify-center px-4 pt-12">
        <div className="w-full max-w-sm space-y-4">
          {round ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center">
              <p className="text-sm font-semibold text-amber-800">Round is being set up — not yet active</p>
              <p className="text-xs text-amber-600 mt-0.5">Check back once the admin activates the round</p>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-center">
              <p className="text-gray-500 text-sm">No active round</p>
            </div>
          )}

          {isMaster && (
            <a href="/master/dashboard" className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-semibold text-white text-sm transition active:scale-95" style={{ background: gold, color: navy }}>
              ← Back to Master Admin
            </a>
          )}

          <a
            href={`/${orgSlug}/admin`}
            className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl font-semibold text-white text-sm transition active:scale-95"
            style={{ background: navy }}
          >
            Admin Login →
          </a>

          {teams.length > 0 && (
            <button
              type="button"
              onClick={() => setShowPin((v) => !v)}
              className="w-full py-3.5 rounded-xl font-semibold text-sm border-2 transition active:scale-95"
              style={{ borderColor: navy, color: navy, background: 'white' }}
            >
              {showPin ? 'Hide PIN Entry' : isGroup ? 'Enter Group PIN' : 'Enter Team PIN'}
            </button>
          )}

          {showPin && (
            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
              <h2 className="font-semibold text-gray-900 mb-3 text-sm">{isGroup ? 'Select your group and enter PIN' : 'Select your team and enter PIN'}</h2>
              <form onSubmit={handlePinSubmit} className="space-y-3">
                {error && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
                )}
                <select name="teamId" required defaultValue="" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 bg-white text-gray-900 text-sm focus:outline-none">
                  <option value="" disabled>{isGroup ? 'Select your group…' : 'Select your team…'}</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <input type="password" name="pin" inputMode="numeric" maxLength={4} required placeholder="4-digit PIN" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-gray-900 text-sm focus:outline-none" />
                <button type="submit" disabled={pending} className="w-full text-white py-2.5 rounded-xl font-semibold text-sm disabled:opacity-60 transition" style={{ background: navy }}>
                  {pending ? 'Verifying…' : 'Open Scorecard →'}
                </button>
              </form>
            </div>
          )}

          {isMaster ? (
            <button onClick={handleSignOut} className="w-full py-3 rounded-xl text-sm font-semibold text-white" style={{ background: '#6b7280' }}>
              Back to Master Admin
            </button>
          ) : showSignOutConfirm ? (
            <div className="space-y-2">
              <p className="text-sm text-center text-gray-700 font-medium">Sign out of this group?</p>
              <div className="flex gap-2">
                <button onClick={handleSignOut} className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white" style={{ background: '#dc2626' }}>
                  Sign Out
                </button>
                <button onClick={() => setShowSignOutConfirm(false)} className="flex-1 py-2.5 rounded-xl font-semibold text-sm border border-gray-300 text-gray-700">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowSignOutConfirm(true)} className="w-full py-3 rounded-xl text-sm font-semibold text-white" style={{ background: '#6b7280' }}>
              Sign Out of {orgName}
            </button>
          )}
        </div>
      </main>
    </div>
  )
}
