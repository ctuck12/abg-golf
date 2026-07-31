'use client'

import { useEffect, useState } from 'react'

type RoundEvent = { id: string; actor: string; action: string; detail: string; created_at: string }

// Collapsible "Round History" card for the Admin Hub: the audit trail of who
// changed what during the round (HCP edits, skins/settings changes, matchup
// edits, clears). Reads /api/round-events; refetches on every expand.
export default function RoundHistory({ roundId }: { roundId: string }) {
  const [open, setOpen] = useState(false)
  const [events, setEvents] = useState<RoundEvent[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/round-events?roundId=' + encodeURIComponent(roundId))
      const data = (await res.json()) as { events: RoundEvent[]; error?: string }
      setEvents(data.events ?? [])
      setLoadError(data.error ?? null)
    } catch {
      setLoadError('Could not load history — check your connection.')
    }
    setLoading(false)
  }

  // Fetch once on mount so the collapsed row can show the count — otherwise
  // you had to expand the card and close it again to find out.
  useEffect(() => { void load() }, [roundId])   // eslint-disable-line react-hooks/exhaustive-deps

  function toggle() {
    setOpen((v) => {
      if (!v) load()
      return !v
    })
  }

  const tableMissing = loadError != null && /round_events|does not exist|schema cache/i.test(loadError)

  function fmtTime(iso: string): string {
    const d = new Date(iso)
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

  // Navy spine — matches the Admin Hub's default section spine
  return (
    <div className="bg-white rounded-2xl border border-slate-200 border-l-4 border-l-[#0f172a] overflow-hidden">
      <button type="button" onClick={toggle} className="w-full flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-gray-900 text-sm">Round History</h3>
          {/* Suppressed on a failed load — 0 would read as "nothing changed"
              when the truth is we couldn't tell */}
          {events !== null && !loadError && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{events.length} change{events.length === 1 ? '' : 's'}</span>
          )}
        </div>
        <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-5 pb-5">
          <p className="text-xs text-gray-400 mt-3 mb-3">Who changed what during this round — handicaps, skins, matchups, and settings.</p>

          {loading && <p className="text-sm text-gray-400">Loading…</p>}

          {!loading && tableMissing && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2">
              History isn&apos;t set up yet — run <code className="font-mono">supabase/add_round_events.sql</code> in the Supabase SQL editor. Changes made before that aren&apos;t recorded.
            </p>
          )}
          {!loading && loadError && !tableMissing && (
            <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{loadError}</p>
          )}

          {!loading && !loadError && events !== null && events.length === 0 && (
            <p className="text-sm text-gray-400">No changes recorded yet.</p>
          )}

          {!loading && events !== null && events.length > 0 && (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {events.map((e) => (
                <div key={e.id} className="bg-gray-50 rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-gray-700">{e.action}</span>
                    <span className="text-[11px] text-gray-400 flex-shrink-0">{fmtTime(e.created_at)}</span>
                  </div>
                  {e.detail && <p className="text-xs text-gray-600 mt-0.5 break-words">{e.detail}</p>}
                  <p className="text-[11px] text-gray-400 mt-0.5">by {e.actor}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
