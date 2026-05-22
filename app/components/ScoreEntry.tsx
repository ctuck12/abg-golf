'use client'

import { useState } from 'react'
import { submitHoleScores } from '@/app/actions'
import { computeHoleBallScores, computeTeamBallSummary } from '@/lib/scoring'

type Player = { id: string; name: string }
type Hole = { hole_number: number; par: number }
type Score = { player_id: string; hole_number: number; strokes: number }
type Team = { id: string; name: string }

const navy = '#0f172a'
const gold = '#f59e0b'

function fmtScore(n: number | null, par: number | null) {
  if (n === null || par === null) return { label: '–', color: '#9ca3af' }
  const d = n - par
  if (d < 0) return { label: String(d), color: '#2563eb' }
  if (d > 0) return { label: `+${d}`, color: '#dc2626' }
  return { label: 'E', color: '#6b7280' }
}

const BALL_NAMES = ['1-ball', '2-ball', '3-ball', '4-ball']

export default function ScoreEntry({
  team, players, holes, initialScores, ballsCount,
}: {
  team: Team
  players: Player[]
  holes: Hole[]
  initialScores: Score[]
  ballsCount: number
}) {
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

  const [pendingHoles, setPendingHoles] = useState<Set<number>>(new Set())
  const [expandedHole, setExpandedHole] = useState<number | null>(null)
  const [errors, setErrors] = useState<Record<number, string>>({})

  function setStroke(playerId: string, hole: number, val: number) {
    setStrokes((s) => ({ ...s, [playerId]: { ...s[playerId], [hole]: Math.max(1, Math.min(20, val)) } }))
    setSavedHoles((sh) => { const n = new Set(sh); n.delete(hole); return n })
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
      setErrors((e) => { const n = { ...e }; delete n[holeNumber]; return n })
      setExpandedHole(null)
    }
  }

  // Build current scores array for summary
  const allScores: Score[] = []
  for (const [playerId, holeMap] of Object.entries(strokes)) {
    for (const [hole, s] of Object.entries(holeMap)) {
      allScores.push({ player_id: playerId, hole_number: parseInt(hole), strokes: s })
    }
  }

  const summary = computeTeamBallSummary(holes, players.map((p) => p.id), allScores, ballsCount)
  const savedCount = savedHoles.size
  const parMap = Object.fromEntries(holes.map((h) => [h.hole_number, h.par]))

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>
      {/* Header */}
      <header className="text-white px-4 py-4 sticky top-0 z-10 shadow-md" style={{ background: navy }}>
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide" style={{ color: gold }}>Scorecard</p>
            <h1 className="font-bold text-lg">{team.name}</h1>
          </div>
          <div className="text-right">
            <p className="text-xs mb-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{savedCount}/18 holes</p>
            <div className="flex gap-2">
              {Array.from({ length: ballsCount }, (_, i) => {
                const vp = summary.ballVsPar[i]
                return (
                  <div key={i} className="text-center">
                    <p className="text-xs" style={{ color: gold }}>{i + 1}B</p>
                    <p className="font-bold text-sm" style={{ color: vp == null ? 'rgba(255,255,255,0.4)' : vp < 0 ? '#60a5fa' : vp > 0 ? '#f87171' : 'white' }}>
                      {vp == null ? '–' : vp === 0 ? 'E' : vp > 0 ? `+${vp}` : vp}
                    </p>
                  </div>
                )
              })}
            </div>
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

          // Compute ball scores for this hole from current strokes
          const holePlayerScores = players
            .map((p) => strokes[p.id]?.[hole.hole_number])
            .filter((s): s is number => s !== undefined)
          const holeBalls = holePlayerScores.length > 0
            ? computeHoleBallScores(holePlayerScores, ballsCount)
            : []

          return (
            <div key={hole.hole_number}
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
                <div className="flex-1 flex gap-2">
                  {holeBalls.map((score, i) => {
                    const { label, color } = fmtScore(score, hole.par)
                    return (
                      <div key={i} className="text-center">
                        <p className="text-xs text-gray-400">{i + 1}B</p>
                        <p className="text-sm font-semibold" style={{ color }}>{label}</p>
                      </div>
                    )
                  })}
                </div>
                <div className="flex items-center gap-2">
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
                          className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 font-bold text-gray-700 flex items-center justify-center active:scale-90 transition">
                          −
                        </button>
                        <span className="w-6 text-center font-bold text-gray-900">{val}</span>
                        <button type="button" onClick={() => setStroke(player.id, hole.hole_number, val + 1)}
                          className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 font-bold text-gray-700 flex items-center justify-center active:scale-90 transition">
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
          )
        })}
      </main>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between text-sm">
          <a href="/leaderboard" className="font-medium" style={{ color: navy }}>← Leaderboard</a>
          <span className="text-gray-500">{savedCount} of 18 saved</span>
          <a href="/" className="text-gray-400 hover:text-gray-600">Switch Team</a>
        </div>
      </div>
    </div>
  )
}
