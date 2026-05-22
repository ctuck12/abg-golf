'use client'

import { useState, Fragment } from 'react'
import { submitHoleScores } from '@/app/actions'
import { computeHoleBallScores, computeTeamBallSummary, computeHoleDaytona, computeTeamDaytonaSummary } from '@/lib/scoring'
import { ScoreNotation } from './ScoreNotation'

type Player = { id: string; name: string }
type Hole = { hole_number: number; par: number }
type Score = { player_id: string; hole_number: number; strokes: number }
type Team = { id: string; name: string }

const navy = '#0f172a'
const gold = '#f59e0b'


export default function ScoreEntry({
  team, players, holes, initialScores, ballsCount, format = 'standard', isAdmin,
}: {
  team: Team
  players: Player[]
  holes: Hole[]
  initialScores: Score[]
  ballsCount: number
  format?: string
  isAdmin: boolean
}) {
  const isDaytona = format === 'daytona'

  // strokes[playerId][holeNumber] = strokes
  const [strokes, setStrokes] = useState<Record<string, Record<number, number>>>(() => {
    const s: Record<string, Record<number, number>> = {}
    for (const sc of initialScores) {
      if (!s[sc.player_id]) s[sc.player_id] = {}
      s[sc.player_id][sc.hole_number] = sc.strokes
    }
    return s
  })

  const [savedHoles, setSavedHoles] = useState<Set<number>>(() => {
    const saved = new Set<number>()
    for (let h = 1; h <= 18; h++) {
      if (players.every((p) => initialScores.some((s) => s.player_id === p.id && s.hole_number === h))) {
        saved.add(h)
      }
    }
    return saved
  })

  // Separate from strokes: only updated on successful save — drives the header totals
  const [savedScores, setSavedScores] = useState<Score[]>(initialScores)

  const [pendingHoles, setPendingHoles] = useState<Set<number>>(new Set())
  const [expandedHole, setExpandedHole] = useState<number | null>(null)
  const [errors, setErrors] = useState<Record<number, string>>({})

  function setStroke(playerId: string, hole: number, val: number) {
    setStrokes((s) => ({ ...s, [playerId]: { ...s[playerId], [hole]: Math.max(1, Math.min(20, val)) } }))
  }

  async function saveHole(holeNumber: number) {
    const playerScores = players.map((p) => ({
      playerId: p.id,
      strokes: strokes[p.id]?.[holeNumber] ?? holes.find((h) => h.hole_number === holeNumber)?.par ?? 4,
    }))

    setPendingHoles((p) => new Set([...p, holeNumber]))
    const result = await submitHoleScores(team.id, holeNumber, playerScores)
    setPendingHoles((p) => { const n = new Set(p); n.delete(holeNumber); return n })

    if (result.error) {
      setErrors((e) => ({ ...e, [holeNumber]: result.error! }))
    } else {
      setSavedHoles((s) => new Set([...s, holeNumber]))
      setSavedScores((prev) => {
        const ids = players.map((p) => p.id)
        const without = prev.filter((s) => !(ids.includes(s.player_id) && s.hole_number === holeNumber))
        const added = playerScores.map(({ playerId, strokes: st }) => ({
          player_id: playerId, hole_number: holeNumber, strokes: st,
        }))
        return [...without, ...added]
      })
      setErrors((e) => { const n = { ...e }; delete n[holeNumber]; return n })
      setExpandedHole(null)
    }
  }

  const frontHoles = holes.filter((h) => h.hole_number <= 9)
  const backHoles = holes.filter((h) => h.hole_number >= 10)
  const playerIds = players.map((p) => p.id)

  // Header totals — only updated on save
  const frontSummary = !isDaytona ? computeTeamBallSummary(frontHoles, playerIds, savedScores, ballsCount) : null
  const backSummary = !isDaytona ? computeTeamBallSummary(backHoles, playerIds, savedScores, ballsCount) : null
  const dtSummary = isDaytona ? computeTeamDaytonaSummary(holes, playerIds, savedScores) : null

  const savedCount = savedHoles.size

  // Live totals for the Front/Back Total cards (include unsaved edits)
  const frontBallTotals = !isDaytona
    ? Array.from({ length: ballsCount }, (_, bi) =>
        frontHoles.reduce((sum, h) => {
          const hps = players.map((p) => strokes[p.id]?.[h.hole_number] ?? h.par)
          return sum + (computeHoleBallScores(hps, ballsCount)[bi] ?? h.par)
        }, 0)
      )
    : []
  const backBallTotals = !isDaytona
    ? Array.from({ length: ballsCount }, (_, bi) =>
        backHoles.reduce((sum, h) => {
          const hps = players.map((p) => strokes[p.id]?.[h.hole_number] ?? h.par)
          return sum + (computeHoleBallScores(hps, ballsCount)[bi] ?? h.par)
        }, 0)
      )
    : []

  const frontDtTotal = isDaytona
    ? frontHoles.reduce((sum, h) => {
        const hps = players.map((p) => strokes[p.id]?.[h.hole_number] ?? h.par)
        const dt = computeHoleDaytona(hps, h.par)
        return dt != null ? sum + dt : sum
      }, 0)
    : 0
  const backDtTotal = isDaytona
    ? backHoles.reduce((sum, h) => {
        const hps = players.map((p) => strokes[p.id]?.[h.hole_number] ?? h.par)
        const dt = computeHoleDaytona(hps, h.par)
        return dt != null ? sum + dt : sum
      }, 0)
    : 0

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>
      {/* Header */}
      <header className="text-white px-4 pt-4 pb-3 sticky top-0 z-10 shadow-md" style={{ background: navy }}>
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-xs uppercase tracking-wide" style={{ color: gold }}>Scorecard</p>
              <h1 className="font-bold text-lg">{team.name}</h1>
            </div>
            <a href="/" className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ background: gold, color: navy }}>Leaderboard</a>
          </div>
          <div className="flex gap-3">
            {isDaytona ? (
              ([
                { label: 'Front 9', total: dtSummary?.frontTotal ?? null },
                { label: 'Back 9', total: dtSummary?.backTotal ?? null },
              ]).map(({ label, total }) => (
                <div key={label} className="flex-1">
                  <p className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</p>
                  <div className="flex gap-3">
                    <div className="text-center">
                      <p className="text-xs" style={{ color: gold }}>DT</p>
                      <p className="font-bold text-sm" style={{ color: total == null ? 'rgba(255,255,255,0.35)' : 'white' }}>
                        {total ?? '–'}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              ([{ label: 'Front 9', s: frontSummary }, { label: 'Back 9', s: backSummary }] as const).map(({ label, s }) => (
                <div key={label} className="flex-1">
                  <p className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</p>
                  <div className="flex gap-3">
                    {Array.from({ length: ballsCount }, (_, i) => {
                      const vp = s?.ballVsPar[i] ?? null
                      return (
                        <div key={i} className="text-center">
                          <p className="text-xs" style={{ color: gold }}>{i + 1}B</p>
                          <p className="font-bold text-sm" style={{ color: vp == null ? 'rgba(255,255,255,0.35)' : 'white' }}>
                            {vp == null ? '–' : vp === 0 ? 'E' : vp > 0 ? `+${vp}` : vp}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-3 py-4 space-y-2 pb-24">
        {savedCount === 18 && (
          <div className="bg-white rounded-xl border-2 px-4 py-3 text-center" style={{ borderColor: gold }}>
            <p className="font-semibold" style={{ color: navy }}>All 18 holes submitted! ⛳</p>
            <a href="/leaderboard" className="text-sm underline mt-1 inline-block" style={{ color: gold }}>
              View Live Leaderboard →
            </a>
          </div>
        )}

        {holes.map((hole) => {
          const isSaved = savedHoles.has(hole.hole_number)
          const isPending = pendingHoles.has(hole.hole_number)
          const isExpanded = expandedHole === hole.hole_number
          const error = errors[hole.hole_number]

          // Collapsed scores use savedScores so they don't change until Save Hole is tapped
          const savedHolePlayerScores = players.map((p) => {
            const sc = savedScores.find((s) => s.player_id === p.id && s.hole_number === hole.hole_number)
            return sc?.strokes ?? hole.par
          })
          const holeBalls = !isDaytona ? computeHoleBallScores(savedHolePlayerScores, ballsCount) : []
          const holeDt = isDaytona ? computeHoleDaytona(savedHolePlayerScores, hole.par) : null

          return (
            <Fragment key={hole.hole_number}>
            <div
              className="bg-white rounded-xl border overflow-hidden"
              style={{ borderColor: isSaved ? gold : '#e5e7eb' }}>
              {/* Hole row */}
              <button
                type="button"
                className="w-full flex items-center px-4 py-3 gap-3 text-left"
                onClick={() => setExpandedHole(isExpanded ? null : hole.hole_number)}>
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
                    {isDaytona ? (
                      <div className="text-center">
                        <p className="text-xs text-gray-400">DT</p>
                        <p className="font-bold text-sm text-gray-900">{holeDt ?? '–'}</p>
                      </div>
                    ) : (
                      holeBalls.map((score, i) => (
                        <div key={i} className="text-center">
                          <p className="text-xs text-gray-400">{i + 1}B</p>
                          <ScoreNotation strokes={score ?? hole.par} par={hole.par} size="sm" />
                        </div>
                      ))
                    )}
                  </div>
                )}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {isSaved && <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#92400e' }}>✓</span>}
                  <span className="text-gray-400 text-sm">{isExpanded ? '▲' : '▼'}</span>
                </div>
              </button>

              {/* Expanded score entry */}
              {isExpanded && (
                <div className="border-t border-gray-100 px-4 py-3 space-y-2">
                  {players.map((player) => {
                    const val = strokes[player.id]?.[hole.hole_number] ?? hole.par
                    return (
                      <div key={player.id} className="flex items-center gap-3">
                        <span className="flex-1 text-sm font-medium text-gray-800 truncate">{player.name}</span>
                        <button type="button" onClick={() => setStroke(player.id, hole.hole_number, val - 1)}
                          className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 font-bold text-gray-700 flex items-center justify-center active:scale-90 transition flex-shrink-0">
                          −
                        </button>
                        <div className="w-11 flex items-center justify-center flex-shrink-0">
                          <ScoreNotation strokes={val} par={hole.par} />
                        </div>
                        <button type="button" onClick={() => setStroke(player.id, hole.hole_number, val + 1)}
                          className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 font-bold text-gray-700 flex items-center justify-center active:scale-90 transition flex-shrink-0">
                          +
                        </button>
                      </div>
                    )
                  })}

                  {error && <p className="text-xs text-red-500">{error}</p>}

                  <button type="button" onClick={() => saveHole(hole.hole_number)} disabled={isPending}
                    className="w-full mt-2 text-white py-2 rounded-lg font-semibold text-sm disabled:opacity-60 transition"
                    style={{ background: navy }}>
                    {isPending ? 'Saving…' : 'Save Hole'}
                  </button>
                </div>
              )}
            </div>

              {hole.hole_number === 9 && (
                <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: navy }}>
                  <div className="flex items-center px-4 py-3 gap-3">
                    <p className="text-xs font-bold uppercase tracking-widest text-gray-500 flex-1">Front 9 Total</p>
                    {savedHoles.has(9) && (
                      <div className="flex items-center gap-3 mr-8">
                        {isDaytona ? (
                          <div className="text-center">
                            <p className="text-xs text-gray-400">DT</p>
                            <p className="font-bold text-sm text-gray-900">{frontDtTotal}</p>
                          </div>
                        ) : (
                          frontBallTotals.map((total, i) => (
                            <div key={i} className="text-center">
                              <p className="text-xs text-gray-400">{i + 1}B</p>
                              <p className="font-bold text-sm text-gray-900">{total}</p>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {hole.hole_number === 18 && (
                <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: navy }}>
                  <div className="flex items-center px-4 py-3 gap-3">
                    <p className="text-xs font-bold uppercase tracking-widest text-gray-500 flex-1">Back 9 Total</p>
                    {savedHoles.has(18) && (
                      <div className="flex items-center gap-3 mr-8">
                        {isDaytona ? (
                          <div className="text-center">
                            <p className="text-xs text-gray-400">DT</p>
                            <p className="font-bold text-sm text-gray-900">{backDtTotal}</p>
                          </div>
                        ) : (
                          backBallTotals.map((total, i) => (
                            <div key={i} className="text-center">
                              <p className="text-xs text-gray-400">{i + 1}B</p>
                              <p className="font-bold text-sm text-gray-900">{total}</p>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Fragment>
          )
        })}
      </main>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3">
        <div className={`max-w-lg mx-auto flex items-center text-sm ${isAdmin ? 'justify-between' : 'justify-center'}`}>
          {isAdmin && (
            <a href="/admin/dashboard"
              className="text-xs px-3 py-1.5 rounded-lg font-semibold"
              style={{ background: navy, color: gold }}>
              Admin Hub
            </a>
          )}
          <p className="text-xs text-gray-400">{savedCount}/18 holes saved</p>
        </div>
      </div>
    </div>
  )
}
