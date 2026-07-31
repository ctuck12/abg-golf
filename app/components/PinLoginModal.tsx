'use client'

import { useState } from 'react'

type Team = { id: string; name: string }
type PlayingGroup = { id: string; name: string }

const navy = '#0f172a'
const gold = '#f59e0b'

export default function PinLoginModal({
  teams, onClose, isGroup = false, orgSlug, onBeforeNavigate, playingGroups, memberNames = {},
}: {
  teams: Team[]
  onClose: () => void
  isGroup?: boolean
  orgSlug: string
  onBeforeNavigate?: () => Promise<void>
  playingGroups?: PlayingGroup[]
  /** entity id → player names, listed under each choice so a scorekeeper can
   *  tell the groups apart without knowing which number they were given. */
  memberNames?: Record<string, string[]>
}) {
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [showPin, setShowPin] = useState(false)
  const [selectedId, setSelectedId] = useState('')

  const useMixedGroups = !!(playingGroups && playingGroups.length > 0)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setPending(true)
    const form = e.currentTarget
    const id = selectedId
    const pin = (form.elements.namedItem('pin') as HTMLInputElement).value
    if (!id) { setPending(false); setError('Pick your ' + (useMixedGroups || isGroup ? 'group' : 'team') + ' first.'); return }
    try {
      if (useMixedGroups) {
        const res = await fetch('/api/playing-group-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId: id, pin }),
        })
        const data = await res.json()
        if (data.success) {
          if (onBeforeNavigate) await onBeforeNavigate()
          window.location.href = `/${orgSlug}/score/group/${id}`
        } else {
          setError(data.error ?? 'Login failed.')
        }
      } else {
        const res = await fetch('/api/team-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teamId: id, pin }),
        })
        const data = await res.json()
        if (data.success) {
          if (onBeforeNavigate) await onBeforeNavigate()
          window.location.href = `/${orgSlug}/score/${data.teamId}`
        } else {
          setError(data.error ?? 'Login failed.')
        }
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setPending(false)
    }
  }

  const entityLabel = useMixedGroups ? 'Group' : isGroup ? 'Group' : 'Team'
  const options = useMixedGroups ? (playingGroups ?? []) : teams

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-gray-900">Enter {entityLabel} PIN</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        {options.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-2">No teams are set up for this round yet.</p>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Your {entityLabel}</label>
            {/* A list rather than a <select>: native options are one line of
                plain text, so the roster couldn't be shown under the name. */}
            <div className="space-y-1.5 max-h-64 overflow-y-auto -mx-0.5 px-0.5 py-0.5">
              {options.map((t) => {
                const roster = memberNames[t.id] ?? []
                const rosterLine = roster.join(' · ')
                // Long rosters step down a size rather than wrapping — a full
                // five names of ordinary length still land on one line.
                const rosterSize = rosterLine.length > 56 ? 'text-[9px]' : 'text-[10px]'
                const picked = selectedId === t.id
                return (
                  <button key={t.id} type="button" onClick={() => { setSelectedId(t.id); setError('') }}
                    aria-pressed={picked}
                    className="w-full text-left rounded-xl px-3 py-2 transition"
                    style={{
                      border: `2px solid ${picked ? navy : '#e5e7eb'}`,
                      background: picked ? '#f8fafc' : 'white',
                    }}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold flex-1 min-w-0 truncate" style={{ color: navy }}>{t.name}</span>
                      {picked && <span className="text-xs font-bold flex-shrink-0" style={{ color: gold }}>✓</span>}
                    </div>
                    {roster.length > 0 && (
                      <p className={`${rosterSize} text-gray-500 mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis`}>
                        {rosterLine}
                      </p>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{entityLabel} PIN</label>
            <div className="relative">
              <input
                type={showPin ? 'text' : 'password'}
                name="pin"
                inputMode="numeric"
                maxLength={4}
                required
                placeholder="4-digit PIN"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 pr-10 text-gray-900 text-sm focus:outline-none"
              />
              <button type="button" tabIndex={-1} onClick={() => setShowPin(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none">
                {showPin
                  ? <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:'1rem',height:'1rem'}}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:'1rem',height:'1rem'}}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-60 transition active:scale-95"
            style={{ background: navy }}
          >
            {pending ? 'Verifying…' : 'Open Scorecard'}
          </button>
        </form>
        )}
      </div>
    </div>
  )
}
