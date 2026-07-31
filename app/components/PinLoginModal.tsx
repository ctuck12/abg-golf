'use client'

import { useEffect, useState } from 'react'

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
  const [selectedId, setSelectedId] = useState('')

  // iOS scrolls the layout viewport to reveal a focused input, and a
  // position:fixed overlay is anchored to that layout viewport — so opening the
  // keyboard carried this card up off the top of the screen. Sizing the overlay
  // to the *visual* viewport instead keeps it centred in what's actually
  // visible. Safe here in a way it wasn't for the page header: the modal locks
  // body scroll, so there's no scrolling for the offset to chase.
  const [vv, setVv] = useState<{ top: number; height: number } | null>(null)
  useEffect(() => {
    const v = window.visualViewport
    if (!v) return
    const apply = () => setVv({ top: v.offsetTop, height: v.height })
    apply()
    v.addEventListener('resize', apply)
    v.addEventListener('scroll', apply)
    return () => {
      v.removeEventListener('resize', apply)
      v.removeEventListener('scroll', apply)
    }
  }, [])

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
      className="fixed left-0 right-0 z-50 flex items-center justify-center px-4 py-6 overflow-y-auto"
      style={vv
        ? { background: 'rgba(0,0,0,0.5)', top: vv.top, height: vv.height }
        : { background: 'rgba(0,0,0,0.5)', top: 0, bottom: 0 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 my-auto flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-gray-900">Choose {entityLabel} &amp; Enter Pin</h2>
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
            {/* No heading — the modal title already says which PIN this is, and
                the cards are self-evidently the groups to pick from. */}
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
            {/* The PIN belongs to a particular group, so there's nothing to type
                against until one is picked */}
            <label className={`block text-xs font-medium mb-1 ${selectedId ? 'text-gray-600' : 'text-gray-400'}`}>{entityLabel} PIN</label>
            {/* 16px — anything smaller and iOS zooms the page on focus, which
                shoves the card up under the status bar */}
            <input
              type="text"
              name="pin"
              inputMode="numeric"
              maxLength={4}
              required
              disabled={!selectedId}
              placeholder={selectedId ? '4-digit PIN' : `Choose your ${entityLabel.toLowerCase()} first`}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-gray-900 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
              style={{ fontSize: '16px' }}
            />
          </div>
          <button
            type="submit"
            disabled={pending || !selectedId}
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
