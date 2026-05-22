'use client'

import { useState, Fragment } from 'react'
import { submitHoleScores } from '@/app/actions'
import { computeHoleBallScores, computeTeamBallSummary } from '@/lib/scoring'
import { ScoreNotation } from './ScoreNotation'

type Player = { id: string; name: string }
type Hole = { hole_number: number; par: number }
type Score = { player_id: string; hole_number: number; strokes: number }
type Team = { id: string; name: string }

const navy = '#0f172a'
const gold = '#f59e0b'


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

  const [showAdminModal, setShowAdminModal] = useState(false)
  const [adminPassword, setAdminPassword] = useState('')
  const [adminError, setAdminError] = useState('')
  const [adminPending, setAdminPending] = useState(false)

  async function handleAdminLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setAdminError('')
    setAdminPending(true)
    try {
      const res = await fetch('/api/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword }),
      })
      const data = await res.json()
      if (data.success) {
        window.location.href = '/admin/dashboard'
      } else {
        setAdminError(data.error ?? 'Incorrect password.')
      }
    } catch {
      setAdminError('Network error. Please try again.')
    } finally {
      setAdminPending(false)
    }
  }

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
  // Header totals use savedScores only — they don't move until Save Hole is tapped
  const frontSummary = computeTeamBallSummary(frontHoles, playerIds, savedScores, ballsCount)
  const backSummary = computeTeamBallSummary(backHoles, playerIds, savedScores, ballsCount)
  const savedCount = savedHoles.size

  const frontBallTotals = Array.from({ length: ballsCount }, (_, bi) =>
    frontHoles.reduce((sum, h) => {
      const hps = players.map((p) => strokes[p.id]?.[h.hole_number] ?? h.par)
      return sum + (computeHoleBallScores(hps, ballsCount)[bi] ?? h.par)
    }, 0)
  )
  const backBallTotals = Array.from({ length: ballsCount }, (_, bi) =>
    backHoles.reduce((sum, h) => {
      const hps = players.map((p) => strokes[p.id]?.[h.hole_number] ?? h.par)
      return sum + (computeHoleBallScores(hps, ballsCount)[bi] ?? h.par)
    }, 0)
  )

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>
      {showAdminModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={(e) => { if (e.target === e.currentTarget) { setShowAdminModal(false); setAdminError(''); setAdminPassword('') } }}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-gray-900">Admin Login</h2>
              <button onClick={() => { setShowAdminModal(false); setAdminError(''); setAdminPassword('') }}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <form onSubmit={handleAdminLogin} className="space-y-3">
              {adminError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{adminError}</p>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Admin Password</label>
                <input
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="Password"
                  required
                  autoFocus
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none"
                />
              </div>
              <button type="submit" disabled={adminPending}
                className="w-full text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-60 transition active:scale-95"
                style={{ background: navy }}>
                {adminPending ? 'Verifying…' : 'Open Admin Portal →'}
              </button>
            </form>
          </div>
        </div>
      )}
      {/* Header */}
      <header className="text-white px-4 pt-4 pb-3 sticky top-0 z-10 shadow-md" style={{ background: navy }}>
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-xs uppercase tracking-wide" style={{ color: gold }}>Scorecard</p>
              <h1 className="font-bold text-lg">{team.name}</h1>
            </div>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>{savedCount}/18 holes</p>
          </div>
          <div className="flex gap-3">
            {([{ label: 'Front 9', s: frontSummary }, { label: 'Back 9', s: backSummary }] as const).map(({ label, s }) => (
              <div key={label} className="flex-1">
                <p className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</p>
                <div className="flex gap-3">
                  {Array.from({ length: ballsCount }, (_, i) => {
                    const vp = s.ballVsPar[i]
                    return (
                      <div key={i} className="text-center">
                        <p className="text-xs" style={{ color: gold }}>{i + 1}B</p>
                        <p className="font-bold text-sm" style={{ color: vp == null ? 'rgba(255,255,255,0.35)' : vp < 0 ? '#60a5fa' : vp > 0 ? '#f87171' : 'white' }}>
                          {vp == null ? '–' : vp === 0 ? 'E' : vp > 0 ? `+${vp}` : vp}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
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

          // Always include a score per player (default to par) so the ball row shows E immediately
          const holePlayerScores = players.map((p) => strokes[p.id]?.[hole.hole_number] ?? hole.par)
          const holeBalls = computeHoleBallScores(holePlayerScores, ballsCount)

          return (
            <Fragment key={hole.hole_number}>
              {hole.hole_number === 1 && (
                <div className="flex items-center gap-3 px-1 pt-1">
                  <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Front 9</p>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>
              )}
              {hole.hole_number === 10 && (
                <div className="flex items-center gap-3 px-1 pt-3">
                  <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Back 9</p>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>
              )}
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
                    {holeBalls.map((score, i) => (
                      <div key={i} className="text-center">
                        <p className="text-xs text-gray-400">{i + 1}B</p>
                        <ScoreNotation strokes={score} par={hole.par} size="sm" />
                      </div>
                    ))}
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
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center px-4 py-3 gap-3">
                    <p className="text-xs font-bold uppercase tracking-widest text-gray-500 flex-1">Front 9 Total</p>
                    <div className="flex items-center gap-3 mr-8">
                      {frontBallTotals.map((total, i) => (
                        <div key={i} className="text-center">
                          <p className="text-xs text-gray-400">{i + 1}B</p>
                          <p className="font-bold text-sm text-gray-900">{total}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {hole.hole_number === 18 && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center px-4 py-3 gap-3">
                    <p className="text-xs font-bold uppercase tracking-widest text-gray-500 flex-1">Back 9 Total</p>
                    <div className="flex items-center gap-3 mr-8">
                      {backBallTotals.map((total, i) => (
                        <div key={i} className="text-center">
                          <p className="text-xs text-gray-400">{i + 1}B</p>
                          <p className="font-bold text-sm text-gray-900">{total}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </Fragment>
          )
        })}
      </main>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between text-sm">
          <a href="/leaderboard" className="font-medium" style={{ color: navy }}>← Leaderboard</a>
          <span className="text-xs text-gray-400">{savedCount} of 18 saved</span>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => { setShowAdminModal(true); setAdminError(''); setAdminPassword('') }}
              className="text-xs text-gray-400 hover:text-gray-700 transition">
              Admin Login
            </button>
            <a href="/" className="text-xs text-gray-400 hover:text-gray-600">Switch Team</a>
          </div>
        </div>
      </div>
    </div>
  )
}
