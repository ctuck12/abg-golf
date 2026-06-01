'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { submitGroupHoleScores } from '@/app/actions'
import { computeTeamBallSummary, computeHoleBallScores } from '@/lib/scoring'

const navy = '#0f172a'
const gold = '#f59e0b'
const BALL_NAMES = ['1-Ball', '2-Ball', '3-Ball', '4-Ball']

type Player = { id: string; name: string; team_id: string; position: number | null; handicap?: number | null }
type Hole = { hole_number: number; par: number }
type Score = { player_id: string; hole_number: number; strokes: number }
type BallValue = { ball_number: number; value_dollars: number }

function scoreToPar(scores: Score[], playerId: string, holes: Hole[]): number | null {
  let total = 0; let played = 0
  for (const h of holes) {
    const s = scores.find((sc) => sc.player_id === playerId && sc.hole_number === h.hole_number)
    if (s) { total += s.strokes - h.par; played++ }
  }
  return played > 0 ? total : null
}

function formatToPar(val: number | null): string {
  if (val === null) return '–'
  return val > 0 ? `+${val}` : val === 0 ? 'E' : String(val)
}

function toParColor(val: number | null): string {
  if (val === null) return 'rgba(255,255,255,0.4)'
  return val < 0 ? '#4ade80' : val > 0 ? '#f87171' : 'rgba(255,255,255,0.7)'
}

export default function PlayingGroupScoreEntry({
  orgSlug, orgId, orgName, isMaster, isAdmin,
  groupId, groupName, roundId, roundName, roundDate, roundCourse,
  players, holes, initialScores, allScores: initialAllScores,
  ballsCount, teamPlayerMap, teamMap, includeTotal, ballValues, isStarted,
}: {
  orgSlug: string; orgId: string; orgName: string; isMaster: boolean; isAdmin: boolean
  groupId: string; groupName: string; roundId: string; roundName: string; roundDate: string; roundCourse: string
  players: Player[]; holes: Hole[]; initialScores: Score[]; allScores: Score[]
  ballsCount: number; teamPlayerMap: Record<string, string[]>; teamMap: Record<string, string>
  includeTotal: boolean; ballValues: BallValue[]; isStarted: boolean
}) {
  const router = useRouter()
  const [strokes, setStrokes] = useState<Record<string, Record<number, number>>>(() => {
    const s: Record<string, Record<number, number>> = {}
    for (const sc of initialScores) {
      if (!s[sc.player_id]) s[sc.player_id] = {}
      s[sc.player_id][sc.hole_number] = sc.strokes
    }
    return s
  })
  const [savedScores, setSavedScores] = useState<Score[]>(initialScores)
  const [allScores, setAllScores] = useState<Score[]>(initialAllScores)
  const [savedHoles, setSavedHoles] = useState<Set<number>>(() => {
    const saved = new Set<number>()
    for (const h of holes) {
      if (players.every((p) => initialScores.some((s) => s.player_id === p.id && s.hole_number === h.hole_number))) {
        saved.add(h.hole_number)
      }
    }
    return saved
  })
  const [expandedHole, setExpandedHole] = useState<number | null>(() => {
    for (const h of holes) {
      if (!players.every((p) => initialScores.some((s) => s.player_id === p.id && s.hole_number === h.hole_number))) {
        return h.hole_number
      }
    }
    return null
  })
  const [pendingHoles, setPendingHoles] = useState<Set<number>>(new Set())
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [playerPopup, setPlayerPopup] = useState<string | null>(null)
  const [showOptions, setShowOptions] = useState(false)
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false)

  const formattedDate = roundDate
    ? new Date(roundDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : ''

  function expandHole(holeNumber: number) {
    const h = holes.find((h) => h.hole_number === holeNumber)
    if (!h) return
    const isLocked = !isStarted
    if (isLocked) return
    setExpandedHole((prev) => prev === holeNumber ? null : holeNumber)
  }

  async function saveHole(holeNumber: number) {
    const hole = holes.find((h) => h.hole_number === holeNumber)
    if (!hole) return
    const playerScores = players.map((p) => ({
      playerId: p.id,
      strokes: strokes[p.id]?.[holeNumber] ?? hole.par,
    }))
    setPendingHoles((prev) => new Set([...prev, holeNumber]))
    setErrors((prev) => { const e = { ...prev }; delete e[holeNumber]; return e })
    const res = await submitGroupHoleScores(groupId, holeNumber, playerScores)
    setPendingHoles((prev) => { const s = new Set(prev); s.delete(holeNumber); return s })
    if (res.error) { setErrors((prev) => ({ ...prev, [holeNumber]: res.error! })); return }
    setSavedHoles((prev) => new Set([...prev, holeNumber]))
    const newScores = playerScores.map((ps) => ({ player_id: ps.playerId, hole_number: holeNumber, strokes: ps.strokes }))
    setSavedScores((prev) => {
      const filtered = prev.filter((s) => s.hole_number !== holeNumber || !players.some((p) => p.id === s.player_id))
      return [...filtered, ...newScores]
    })
    setAllScores((prev) => {
      const filtered = prev.filter((s) => s.hole_number !== holeNumber || !players.some((p) => p.id === s.player_id))
      return [...filtered, ...newScores]
    })
    // Auto-advance to next unsaved hole
    const nextHole = holes.find((h) => h.hole_number > holeNumber && !savedHoles.has(h.hole_number) && h.hole_number !== holeNumber)
    if (nextHole) { setExpandedHole(nextHole.hole_number); setTimeout(() => document.getElementById(`hole-${nextHole.hole_number}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100) }
    else setExpandedHole(null)
  }

  async function handleSignOut() {
    await fetch('/api/playing-group-logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groupId }) })
    window.location.href = isMaster ? '/master/dashboard' : `/${orgSlug}`
  }

  // Ball score popup for a player
  const popupPlayer = playerPopup ? players.find((p) => p.id === playerPopup) : null
  const popupTeamId = popupPlayer?.team_id ?? null
  const popupTeamPlayerIds = popupTeamId ? (teamPlayerMap[popupTeamId] ?? []) : []
  const popupBallSummary = popupTeamId && popupTeamPlayerIds.length > 0
    ? computeTeamBallSummary(holes, popupTeamPlayerIds, allScores, ballsCount)
    : null

  const frontHoles = holes.filter((h) => h.hole_number <= 9)
  const backHoles = holes.filter((h) => h.hole_number > 9)

  function ballSummarySection(label: string, holeSubset: Hole[]) {
    if (!popupBallSummary || holeSubset.length === 0) return null
    const sub = computeTeamBallSummary(holeSubset, popupTeamPlayerIds, allScores, ballsCount)
    return (
      <div className="mb-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{label}</p>
        <div className="flex gap-2 flex-wrap">
          {Array.from({ length: ballsCount }, (_, bi) => {
            const vsp = sub.ballVsPar[bi]
            return (
              <div key={bi} className="flex-1 min-w-0 bg-gray-50 rounded-lg p-2 text-center border border-gray-100">
                <p className="text-[10px] text-gray-400 font-medium mb-0.5">{BALL_NAMES[bi]}</p>
                <p className="text-sm font-bold" style={{ color: vsp == null ? '#9ca3af' : vsp < 0 ? '#16a34a' : vsp > 0 ? '#dc2626' : navy }}>
                  {vsp == null ? '–' : vsp > 0 ? `+${vsp}` : vsp === 0 ? 'E' : vsp}
                </p>
                {sub.ballTotals[bi] != null && (
                  <p className="text-[10px] text-gray-400">{sub.ballTotals[bi]}</p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>

      {/* Options modal */}
      {showOptions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowOptions(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-gray-900">Options</h2>
              <button onClick={() => setShowOptions(false)} className="text-gray-400 text-xl leading-none">✕</button>
            </div>
            <div className="flex flex-col gap-3">
              {isAdmin && (
                <a href={`/${orgSlug}/admin/dashboard`} className="w-full text-center py-3 rounded-xl font-semibold text-sm text-white" style={{ background: navy }}>
                  Admin Hub
                </a>
              )}
              {isMaster && (
                <a href="/master/dashboard" className="w-full text-center py-3 rounded-xl font-semibold text-sm border" style={{ borderColor: gold, color: '#92400e', background: '#fffbeb' }}>
                  ← Master Admin
                </a>
              )}
              {showSignOutConfirm ? (
                <div className="space-y-2">
                  <p className="text-sm text-center text-gray-700 font-medium">Sign out of this group?</p>
                  <div className="flex gap-2">
                    <button onClick={handleSignOut} className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white" style={{ background: '#dc2626' }}>Sign Out</button>
                    <button onClick={() => setShowSignOutConfirm(false)} className="flex-1 py-2.5 rounded-xl font-semibold text-sm border border-gray-300 text-gray-700">Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowSignOutConfirm(true)} className="w-full py-3 rounded-xl text-sm font-semibold text-white" style={{ background: '#6b7280' }}>
                  Sign Out of {orgName}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Player ball score popup */}
      {playerPopup && popupPlayer && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setPlayerPopup(null)}>
          <div className="bg-white rounded-t-3xl w-full max-w-lg p-5 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-bold text-gray-900">{popupPlayer.name}</h3>
              <button onClick={() => setPlayerPopup(null)} className="text-gray-400 text-xl leading-none">✕</button>
            </div>
            <p className="text-xs text-gray-400 mb-4">{teamMap[popupPlayer.team_id] ?? 'Unknown team'} · {BALL_NAMES.slice(0, ballsCount).join(', ')}</p>
            {popupBallSummary ? (
              <>
                {ballSummarySection('Front 9', frontHoles)}
                {ballSummarySection('Back 9', backHoles)}
                {includeTotal && ballSummarySection('Overall', holes)}
              </>
            ) : (
              <p className="text-sm text-gray-400 text-center py-4">No scores yet</p>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <header className="text-white px-4 pt-4 pb-3 sticky top-0 z-10 shadow-md" style={{ background: navy }}>
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-xs uppercase tracking-wide" style={{ color: gold }}>Scorecard</p>
              <h1 className="font-bold text-lg">{groupName}</h1>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{roundCourse} · {formattedDate}</p>
            </div>
            <button onClick={() => setShowOptions(true)} className="text-xs px-3 py-1.5 rounded-lg border font-medium" style={{ borderColor: 'rgba(255,255,255,0.4)', color: '#d1d5db' }}>
              Options
            </button>
          </div>
          {/* Player scores to par — tap to see ball breakdown */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 border-t border-white/10 mt-1">
            {players.map((p) => {
              const toPar = scoreToPar(savedScores, p.id, holes)
              return (
                <button key={p.id} type="button"
                  onClick={() => setPlayerPopup((prev) => prev === p.id ? null : p.id)}
                  className="flex items-center gap-1 text-xs">
                  <span className="underline underline-offset-2" style={{ color: 'rgba(255,255,255,0.6)' }}>{p.name.split(' ')[0]}</span>
                  <span className="font-bold" style={{ color: toParColor(toPar) }}>{formatToPar(toPar)}</span>
                </button>
              )
            })}
          </div>
        </div>
      </header>

      {/* Hole list */}
      <div className="max-w-lg mx-auto px-4 pt-4 pb-16 space-y-2">
        {!isStarted && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-center">
            <p className="text-sm font-semibold text-amber-800">Round not yet active</p>
          </div>
        )}

        {holes.map((hole) => {
          const isSaved = savedHoles.has(hole.hole_number)
          const isPending = pendingHoles.has(hole.hole_number)
          const isExpanded = isStarted && expandedHole === hole.hole_number
          const error = errors[hole.hole_number]
          const totalPar = players.reduce((sum, p) => {
            const s = savedScores.find((sc) => sc.player_id === p.id && sc.hole_number === hole.hole_number)
            return sum + (s ? s.strokes - hole.par : 0)
          }, 0)

          return (
            <div key={hole.hole_number} id={`hole-${hole.hole_number}`}
              className="bg-white rounded-xl border overflow-hidden"
              style={{ borderColor: isSaved ? gold : '#e5e7eb' }}>
              <button type="button"
                className={`w-full flex items-center px-4 py-3 gap-3 text-left${!isStarted ? ' cursor-not-allowed opacity-50' : ''}`}
                onClick={() => expandHole(hole.hole_number)}>
                <div className="w-8 text-center flex-shrink-0">
                  <p className="text-xs text-gray-400">Hole</p>
                  <p className="font-bold text-gray-900">{hole.hole_number}</p>
                </div>
                <div className="w-8 text-center flex-shrink-0">
                  <p className="text-xs text-gray-400">Par</p>
                  <p className="font-semibold text-gray-600">{hole.par}</p>
                </div>
                <div className="flex-1" />
                {isSaved && (
                  <div className="flex items-center gap-3 mr-2">
                    {players.map((p) => {
                      const sc = savedScores.find((s) => s.player_id === p.id && s.hole_number === hole.hole_number)
                      const rel = sc ? sc.strokes - hole.par : null
                      return (
                        <div key={p.id} className="text-center">
                          <p className="text-[10px] text-gray-400">{p.name.split(' ')[0]}</p>
                          <p className="text-xs font-semibold" style={{ color: rel == null ? '#9ca3af' : rel < 0 ? '#16a34a' : rel > 0 ? '#dc2626' : '#374151' }}>
                            {rel == null ? '–' : rel > 0 ? `+${rel}` : rel === 0 ? 'E' : rel}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                )}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {isSaved && <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#92400e' }}>✓</span>}
                  <span className="text-gray-400 text-sm">{isExpanded ? '▲' : '▼'}</span>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-gray-100 px-4 py-3 space-y-3">
                  {players.map((player) => {
                    const val = strokes[player.id]?.[hole.hole_number] ?? hole.par
                    const rel = val - hole.par
                    return (
                      <div key={player.id}>
                        <div className="flex items-center justify-between mb-1">
                          <div>
                            <p className="text-sm font-semibold text-gray-800">{player.name}</p>
                            <p className="text-xs text-gray-400">{teamMap[player.team_id] ?? '—'}</p>
                          </div>
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{
                            background: rel < 0 ? '#dcfce7' : rel > 0 ? '#fee2e2' : '#f3f4f6',
                            color: rel < 0 ? '#15803d' : rel > 0 ? '#dc2626' : '#374151',
                          }}>
                            {rel > 0 ? `+${rel}` : rel === 0 ? 'E' : rel}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button type="button"
                            onClick={() => setStrokes((prev) => ({ ...prev, [player.id]: { ...(prev[player.id] ?? {}), [hole.hole_number]: Math.max(1, (prev[player.id]?.[hole.hole_number] ?? hole.par) - 1) } }))}
                            className="w-10 h-10 rounded-xl border border-gray-300 text-lg font-bold text-gray-600 flex items-center justify-center active:scale-95">−</button>
                          <div className="flex-1 text-center">
                            <span className="text-2xl font-bold text-gray-900">{val}</span>
                          </div>
                          <button type="button"
                            onClick={() => setStrokes((prev) => ({ ...prev, [player.id]: { ...(prev[player.id] ?? {}), [hole.hole_number]: Math.min(20, (prev[player.id]?.[hole.hole_number] ?? hole.par) + 1) } }))}
                            className="w-10 h-10 rounded-xl border border-gray-300 text-lg font-bold text-gray-600 flex items-center justify-center active:scale-95">+</button>
                        </div>
                      </div>
                    )
                  })}
                  {error && <p className="text-xs text-red-500">{error}</p>}
                  <button type="button"
                    onClick={() => saveHole(hole.hole_number)}
                    disabled={isPending}
                    className="w-full mt-1 text-white py-2.5 rounded-xl font-semibold text-sm disabled:opacity-60 transition"
                    style={{ background: navy }}>
                    {isPending ? 'Saving…' : 'Save Hole'}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
