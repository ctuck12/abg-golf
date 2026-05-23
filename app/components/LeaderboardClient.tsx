'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  computeTeamBallSummary, computeDaytonaSidesSummary, computePlayerDaytonaPoints,
  calculateFrontBackPayouts, settleDaytonaPlayerPoints,
  type DaytonaHoleAssignment,
} from '@/lib/scoring'
import PinLoginModal from './PinLoginModal'

type Team = { id: string; name: string }
type Player = { id: string; team_id: string; name: string; position: number | null }
type Hole = { hole_number: number; par: number }
type Score = { player_id: string; hole_number: number; strokes: number }
type BallValue = { ball_number: number; value_dollars: number }

const BALL_NAMES = ['1-Ball', '2-Ball', '3-Ball', '4-Ball']

const navy = '#0f172a'
const gold = '#f59e0b'

function ScoreCell({ vp }: { vp: number | null }) {
  if (vp === null) return <span className="text-gray-300">–</span>
  if (vp < 0) return <span className="font-semibold text-red-600">{vp}</span>
  if (vp === 0) return <span className="font-semibold text-gray-900">E</span>
  return <span className="font-semibold text-gray-900">+{vp}</span>
}

function vpDisplay(vp: number | null): string {
  if (vp === null) return '–'
  if (vp === 0) return 'E'
  return vp > 0 ? `+${vp}` : `${vp}`
}

function vpColor(vp: number | null): string {
  return vp !== null && vp < 0 ? '#dc2626' : '#111827'
}

export default function LeaderboardClient({
  initialTeams, players, holes, initialScores, ballsCount, ballValues = [], roundName, roundDate, roundCourse, format = 'standard', daytonaVariant = '4man', viewOnly = false, scorecardTeamId = null, isAdmin = false, roundId = '', initialAssignments = [],
}: {
  initialTeams: Team[]
  players: Player[]
  holes: Hole[]
  initialScores: Score[]
  ballsCount: number
  ballValues?: BallValue[]
  roundName: string
  roundDate: string
  roundCourse: string
  format?: string
  daytonaVariant?: string
  viewOnly?: boolean
  scorecardTeamId?: string | null
  isAdmin?: boolean
  roundId?: string
  initialAssignments?: DaytonaHoleAssignment[]
}) {
  const [scores, setScores] = useState<Score[]>(initialScores)
  const [assignments, setAssignments] = useState<DaytonaHoleAssignment[]>(initialAssignments)
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const [showPin, setShowPin] = useState(false)
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null)
  const [showPayouts, setShowPayouts] = useState(false)

  const isDaytona = format === 'daytona'

  useEffect(() => {
    const playerIds = players.map((p) => p.id)
    async function refetchScores() {
      const { data } = await supabase
        .from('scores').select('player_id, hole_number, strokes').in('player_id', playerIds)
      if (data) { setScores(data); setLastUpdated(new Date()) }
    }
    const ch1 = supabase.channel('leaderboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, refetchScores)
      .subscribe()
    const ch2 = supabase.channel('score-updates')
      .on('broadcast', { event: 'refresh' }, refetchScores)
      .subscribe()

    const interval = setInterval(refetchScores, 10000)

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') refetchScores()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      supabase.removeChannel(ch1)
      supabase.removeChannel(ch2)
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [players])

  useEffect(() => {
    if (!isDaytona || !roundId) return
    const channel = supabase.channel('leaderboard-assignments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daytona_hole_assignments' }, async () => {
        const { data } = await supabase
          .from('daytona_hole_assignments').select('player_id, hole_number, side').eq('round_id', roundId)
        if (data) { setAssignments(data as DaytonaHoleAssignment[]); setLastUpdated(new Date()) }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [isDaytona, roundId])

  const frontHoles = holes.filter((h) => h.hole_number <= 9)
  const backHoles = holes.filter((h) => h.hole_number >= 10)

  const rows = isDaytona ? [] : initialTeams.map((team) => {
    const teamPlayers = players.filter((p) => p.team_id === team.id)
    const playerIds = teamPlayers.map((p) => p.id)
    const summary = computeTeamBallSummary(holes, playerIds, scores, ballsCount)
    const frontSummary = computeTeamBallSummary(frontHoles, playerIds, scores, ballsCount)
    const backSummary = computeTeamBallSummary(backHoles, playerIds, scores, ballsCount)
    return { team, summary, frontSummary, backSummary }
  }).sort((a, b) => {
    for (let i = 0; i < ballsCount; i++) {
      const av = a.summary?.ballVsPar[i] ?? null
      const bv = b.summary?.ballVsPar[i] ?? null
      if (av == null && bv == null) continue
      if (av == null) return 1
      if (bv == null) return -1
      if (av !== bv) return av - bv
    }
    return a.team.name.localeCompare(b.team.name)
  })

  const pointsMap = isDaytona ? computePlayerDaytonaPoints(holes, scores, assignments, daytonaVariant) : new Map<string, number>()
  const dtPlayerRows = isDaytona ? players.map((p) => ({
    player: p,
    points: pointsMap.get(p.id) ?? 0,
    thru: scores.filter((s) => s.player_id === p.id).length,
  })).sort((a, b) => {
    const aHas = a.thru > 0
    const bHas = b.thru > 0
    if (!aHas && !bHas) return a.player.name.localeCompare(b.player.name)
    if (!aHas) return 1
    if (!bHas) return -1
    return b.points - a.points
  }) : []

  // Payout computations (mirrors AdminDashboard)
  const frontHolesForPayouts = holes.filter((h) => h.hole_number <= 9)
  const backHolesForPayouts = holes.filter((h) => h.hole_number >= 10)
  const ballValueArr = Array.from({ length: ballsCount }, (_, i) => ballValues.find((bv) => bv.ball_number === i + 1)?.value_dollars ?? 0)
  const dtPayoutValue = ballValues.find((bv) => bv.ball_number === 1)?.value_dollars ?? 0

  const frontSummaries = !isDaytona ? new Map(initialTeams.map((team) => {
    const tp = players.filter((p) => p.team_id === team.id)
    return [team.id, computeTeamBallSummary(frontHolesForPayouts, tp.map((p) => p.id), scores, ballsCount)]
  })) : new Map()
  const backSummaries = !isDaytona ? new Map(initialTeams.map((team) => {
    const tp = players.filter((p) => p.team_id === team.id)
    return [team.id, computeTeamBallSummary(backHolesForPayouts, tp.map((p) => p.id), scores, ballsCount)]
  })) : new Map()
  const { results: ballResults, net: payoutNet, settlements: payoutSettlements } = !isDaytona
    ? calculateFrontBackPayouts(initialTeams, frontSummaries, backSummaries, ballValueArr, ballsCount)
    : { results: [], net: {} as Record<string, number>, settlements: [] }

  const dtSummaries = isDaytona ? new Map(initialTeams.map((team) => {
    const tp = players.filter((p) => p.team_id === team.id)
    const teamPlayerIds = tp.map((p) => p.id)
    const teamAssignments = assignments.filter((a) => teamPlayerIds.includes(a.player_id))
    return [team.id, computeDaytonaSidesSummary(holes, scores, teamAssignments)]
  })) : new Map()

  const formattedDate = new Date(roundDate + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })

  const scoreColW = '2rem'
  const dtColW = '3rem'

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>
      {showPin && <PinLoginModal teams={initialTeams} onClose={() => setShowPin(false)} />}

      {showPayouts && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowPayouts(false)}>
          <div className="bg-white rounded-t-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100 sticky top-0 bg-white">
              <h3 className="font-bold text-gray-900 text-base">Payouts</h3>
              <button onClick={() => setShowPayouts(false)} className="text-gray-400 text-xl font-bold leading-none">×</button>
            </div>
            <div className="px-4 py-4 space-y-4">
              {isDaytona ? (
                <>
                  {initialTeams.map((team) => {
                    const teamPlayers = players.filter((p) => p.team_id === team.id)
                    const teamPlayerIds = teamPlayers.map((p) => p.id)
                    const teamAssignments = assignments.filter((a) => teamPlayerIds.includes(a.player_id))
                    const teamScores = scores.filter((s) => teamPlayerIds.includes(s.player_id))
                    const pointTotals = computePlayerDaytonaPoints(holes, teamScores, teamAssignments, daytonaVariant)
                    const { net: playerNet, settlements: playerSettlements } = settleDaytonaPlayerPoints(teamPlayers, pointTotals, dtPayoutValue)
                    return (
                      <div key={team.id} className="bg-gray-50 rounded-2xl border border-gray-200 overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-100">
                          <h4 className="font-semibold text-gray-900 text-sm">{team.name}</h4>
                          <p className="text-xs text-gray-500">${dtPayoutValue}/point · lower DT wins each hole</p>
                        </div>
                        <div className="divide-y divide-gray-100">
                          {teamPlayers.map((p) => {
                            const pts = pointTotals.get(p.id) ?? 0
                            const dollars = playerNet[p.id] ?? 0
                            return (
                              <div key={p.id} className="flex items-center px-4 py-2.5 gap-2 bg-white">
                                <span className="flex-1 text-sm text-gray-900">{p.name}</span>
                                <span className="text-sm font-semibold tabular-nums w-16 text-right"
                                  style={{ color: pts > 0 ? '#16a34a' : pts < 0 ? '#dc2626' : '#6b7280' }}>
                                  {pts > 0 ? `+${pts}` : pts === 0 ? '0' : pts} pts
                                </span>
                                <span className="text-sm font-bold tabular-nums w-16 text-right"
                                  style={{ color: dollars > 0 ? '#16a34a' : dollars < 0 ? '#dc2626' : '#6b7280' }}>
                                  {dollars > 0 ? `+$${dollars.toFixed(2)}` : dollars < 0 ? `-$${Math.abs(dollars).toFixed(2)}` : 'Even'}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                        {(() => {
                          const summary = dtSummaries.get(team.id)
                          return summary && (summary.leftFront != null || summary.leftBack != null) ? (
                            <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
                              <div className="flex gap-4 text-xs">
                                {summary.leftFront != null && (
                                  <span className="text-gray-500">
                                    Front: <span style={{ color: '#2563eb' }}>L {summary.leftFront}</span>{' vs '}<span style={{ color: '#92400e' }}>R {summary.rightFront}</span>
                                  </span>
                                )}
                                {summary.leftBack != null && (
                                  <span className="text-gray-500">
                                    Back: <span style={{ color: '#2563eb' }}>L {summary.leftBack}</span>{' vs '}<span style={{ color: '#92400e' }}>R {summary.rightBack}</span>
                                  </span>
                                )}
                              </div>
                            </div>
                          ) : null
                        })()}
                        {playerSettlements.length > 0 && (
                          <div className="border-t border-gray-200 px-4 py-3">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Settlement</p>
                            {playerSettlements.map((s, i) => (
                              <div key={i} className="flex items-center py-1 gap-2 text-sm">
                                <span className="flex-1">
                                  <span className="font-semibold text-red-600">{s.fromName}</span>{' pays '}<span className="font-semibold text-green-700">{s.toName}</span>
                                </span>
                                <span className="font-bold text-gray-900">${s.amount.toFixed(2)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {playerSettlements.length === 0 && teamPlayers.length > 0 && (
                          <p className="text-xs text-gray-400 text-center py-3">
                            {[...pointTotals.values()].every((v) => v === 0) ? 'No holes scored yet.' : 'All even — no payments needed.'}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </>
              ) : (
                <>
                  <div className="bg-gray-50 rounded-2xl border border-gray-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100">
                      <h4 className="font-semibold text-gray-900 text-sm">Ball Results</h4>
                      <p className="text-xs text-gray-500">Ties wash · winner takes ${ballValueArr[0] ?? 0}/team per half</p>
                    </div>
                    <div className="px-4 py-4 space-y-4">
                      {Array.from({ length: ballsCount }, (_, bi) => {
                        const front = ballResults.find((r) => r.ball === bi + 1 && r.half === 'Front 9')
                        const back = ballResults.find((r) => r.ball === bi + 1 && r.half === 'Back 9')
                        return (
                          <div key={bi}>
                            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: gold }}>{BALL_NAMES[bi]}</p>
                            <div className="grid grid-cols-2 gap-2">
                              {[front, back].map((result, hi) => {
                                if (!result) return <div key={hi} />
                                const vp = result.winnerVsPar
                                const vpStr = vp == null ? '' : vp === 0 ? 'E' : vp > 0 ? `+${vp}` : `${vp}`
                                return (
                                  <div key={hi} className="bg-white rounded-lg px-3 py-2 border border-gray-100">
                                    <p className="text-xs text-gray-500 mb-0.5">{result.half}</p>
                                    {!result.played ? (
                                      <p className="text-sm text-gray-300 font-medium">–</p>
                                    ) : result.tied ? (
                                      <p className="text-sm text-gray-500 font-medium">Tie — Washes</p>
                                    ) : (
                                      <>
                                        <p className="text-sm font-semibold text-green-700 truncate">{result.winnerName}</p>
                                        {vpStr && <p className="text-xs text-gray-400">{vpStr}</p>}
                                      </>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-2xl border border-gray-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100">
                      <h4 className="font-semibold text-gray-900 text-sm">Team Net</h4>
                      <p className="text-xs text-gray-500">Based on scores entered so far</p>
                    </div>
                    {[...initialTeams].sort((a, b) => (payoutNet[b.id] ?? 0) - (payoutNet[a.id] ?? 0)).map((team) => {
                      const teamNet = payoutNet[team.id] ?? 0
                      return (
                        <div key={team.id} className="flex items-center px-4 py-2.5 border-b border-gray-100 last:border-0 bg-white">
                          <span className="flex-1 font-medium text-gray-900 text-sm">{team.name}</span>
                          <span className="font-bold text-base" style={{ color: teamNet > 0 ? '#16a34a' : teamNet < 0 ? '#dc2626' : '#6b7280' }}>
                            {teamNet === 0 ? 'Even' : teamNet > 0 ? `+$${teamNet}` : `-$${Math.abs(teamNet)}`}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  <div className="bg-gray-50 rounded-2xl border border-gray-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100">
                      <h4 className="font-semibold text-gray-900 text-sm">Settlement</h4>
                      <p className="text-xs text-gray-500">Who pays who</p>
                    </div>
                    {payoutSettlements.length === 0 ? (
                      <p className="text-sm text-gray-500 text-center py-6 bg-white">No payouts yet.</p>
                    ) : payoutSettlements.map((s, i) => (
                      <div key={i} className="flex items-center px-4 py-2.5 border-b border-gray-100 last:border-0 gap-2 bg-white">
                        <span className="flex-1 text-sm text-gray-900">
                          <span className="font-semibold text-red-600">{s.fromName}</span>{' pays '}<span className="font-semibold text-green-700">{s.toName}</span>
                        </span>
                        <span className="font-bold text-gray-900">${s.amount}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="h-6" />
          </div>
        </div>
      )}

      <header className="text-white py-5 px-4 shadow-md" style={{ background: navy }}>
        <div className="max-w-lg mx-auto">
          {viewOnly ? (
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest" style={{ color: gold }}>
                  Anything But Golf Group
                </p>
                <h1 className="text-lg font-bold leading-tight">{roundName}</h1>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  {roundCourse && `${roundCourse} · `}{formattedDate}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1.5 mt-0.5 flex-shrink-0">
                {scorecardTeamId ? (
                  <>
                    <a href={`/score/${scorecardTeamId}`}
                      className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                      style={{ background: gold, color: navy }}>
                      Enter Scores
                    </a>
                    {isAdmin && (
                      <a href="/admin/dashboard"
                        className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                        style={{ background: navy, color: '#9ca3af', border: '1px solid rgba(255,255,255,0.15)' }}>
                        Admin Hub
                      </a>
                    )}
                  </>
                ) : (
                  <>
                    <button onClick={() => setShowPin(true)}
                      className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                      style={{ background: gold, color: navy }}>
                      Team Pin
                    </button>
                    <a href="/admin"
                      className="text-xs px-3 py-1.5 rounded-lg font-medium"
                      style={{ borderColor: 'rgba(255,255,255,0.3)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.3)' }}>
                      Admin Login
                    </a>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div>
              {scorecardTeamId && (
                <a
                  href={`/score/${scorecardTeamId}`}
                  className="inline-flex items-center gap-1 text-xs font-semibold mb-3 px-3 py-1.5 rounded-lg"
                  style={{ background: gold, color: navy }}
                >
                  Enter Scores
                </a>
              )}
              <div className="text-center">
                <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: gold }}>
                  Anything But Golf Group
                </p>
                <h1 className="text-xl font-bold">{roundName}</h1>
                <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  {roundCourse && `${roundCourse} · `}{formattedDate}
                </p>
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 pt-5">
        <h2 className="text-lg font-bold text-gray-900 mb-2">Leaderboard</h2>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPayouts(true)}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border"
              style={{ borderColor: navy, color: navy }}>
              Payouts
            </button>
            {isDaytona && (
              <a href="/scorecards" className="text-xs font-semibold px-3 py-1.5 rounded-lg border"
                style={{ borderColor: navy, color: navy }}>
                All Scorecards
              </a>
            )}
            <a href="/matchup" className="text-xs font-semibold px-3 py-1.5 rounded-lg border"
              style={{ borderColor: navy, color: navy }}>
              Matchups
            </a>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" />
            Live
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Header */}
          <div style={{ background: navy }}>
            {isDaytona ? (
              <div className="flex items-center px-4 py-2.5 text-xs font-semibold uppercase"
                style={{ color: 'rgba(255,255,255,0.6)' }}>
                <span className="w-5 mr-2 flex-shrink-0">#</span>
                <span className="flex-1 min-w-0">Player</span>
                <span className="inline-flex justify-center flex-shrink-0" style={{ width: '4rem', color: gold }}>Points</span>
                <span className="inline-flex justify-center flex-shrink-0" style={{ width: '2.75rem' }}>Thru</span>
              </div>
            ) : (
              <>
                {/* Group labels row */}
                <div className="flex items-center px-4 pt-2 pb-0 text-xs font-semibold uppercase tracking-wide">
                  <span className="w-5 mr-2 flex-shrink-0" />
                  <span className="flex-1 min-w-0" />
                  <span
                    className="inline-flex justify-center flex-shrink-0"
                    style={{ width: `${ballsCount * 2}rem`, color: 'rgba(255,255,255,0.45)' }}>
                    Front 9
                  </span>
                  <span className="flex-shrink-0" style={{ width: '0.75rem' }} />
                  <span
                    className="inline-flex justify-center flex-shrink-0"
                    style={{ width: `${ballsCount * 2}rem`, color: 'rgba(255,255,255,0.45)' }}>
                    Back 9
                  </span>
                  <span className="flex-shrink-0" style={{ width: '2.75rem' }} />
                  <span className="flex-shrink-0" style={{ width: '1.5rem' }} />
                </div>
                {/* Column labels row */}
                <div className="flex items-center px-4 pb-2 pt-0.5 text-xs font-semibold uppercase"
                  style={{ color: 'rgba(255,255,255,0.6)' }}>
                  <span className="w-5 mr-2 flex-shrink-0">#</span>
                  <span className="flex-1 min-w-0">Team</span>
                  {Array.from({ length: ballsCount }, (_, i) => (
                    <span key={`fh${i}`} className="inline-flex justify-center flex-shrink-0" style={{ width: scoreColW, color: gold }}>{i + 1}B</span>
                  ))}
                  <span className="flex-shrink-0" style={{ width: '0.75rem' }} />
                  {Array.from({ length: ballsCount }, (_, i) => (
                    <span key={`bh${i}`} className="inline-flex justify-center flex-shrink-0" style={{ width: scoreColW, color: gold }}>{i + 1}B</span>
                  ))}
                  <span className="inline-flex justify-center flex-shrink-0" style={{ width: '2.75rem' }}>Thru</span>
                  <span className="flex-shrink-0" style={{ width: '1.5rem' }} />
                </div>
              </>
            )}
          </div>

          {isDaytona ? (
            <>
              {dtPlayerRows.length === 0 && (
                <p className="text-center text-gray-500 text-sm py-8">No scores yet.</p>
              )}
              {dtPlayerRows.map((row, i) => {
                const hasScores = row.thru > 0
                const isLeader = i === 0 && hasScores
                const pts = row.thru > 0 ? row.points : null
                const ptsColor = pts === null ? '#9ca3af' : pts > 0 ? '#16a34a' : pts < 0 ? '#dc2626' : '#111827'
                const ptsStr = pts === null ? '–' : pts > 0 ? `+${pts}` : String(pts)
                return (
                  <a key={row.player.id} href={`/player/${row.player.id}`}
                    className="flex items-center px-4 py-3 hover:bg-gray-50 transition border-b border-gray-100 last:border-0"
                    style={isLeader ? { background: '#fef9e7' } : {}}>
                    <span className="w-5 mr-2 text-sm font-bold flex-shrink-0" style={{ color: isLeader ? gold : '#9ca3af' }}>
                      {hasScores ? i + 1 : '–'}
                    </span>
                    <span className="flex-1 min-w-0 font-semibold text-gray-900 text-sm truncate">{row.player.name}</span>
                    <span className="inline-flex justify-center text-sm font-bold flex-shrink-0" style={{ width: '4rem', color: ptsColor }}>
                      {ptsStr}
                    </span>
                    <span className="inline-flex justify-center text-sm text-gray-500 flex-shrink-0" style={{ width: '2.75rem' }}>
                      {row.thru === 0 ? '–' : row.thru === 18 ? 'F' : row.thru}
                    </span>
                  </a>
                )
              })}
            </>
          ) : (
            <>
              {rows.length === 0 && (
                <p className="text-center text-gray-500 text-sm py-8">No scores yet.</p>
              )}
              {rows.map((row, i) => {
                const thruCount = row.summary?.holesPerBall?.[0] ?? 0
                const hasScores = thruCount > 0
                const isLeader = i === 0 && hasScores
                const isExpanded = expandedTeam === row.team.id
                const teamPlayers = players.filter((p) => p.team_id === row.team.id)
                return (
                  <div key={row.team.id} className="border-b border-gray-100 last:border-0">
                    <button
                      type="button"
                      onClick={() => setExpandedTeam(isExpanded ? null : row.team.id)}
                      className="w-full flex items-center px-4 py-3 hover:bg-gray-50 transition text-left"
                      style={isLeader ? { background: '#fef9e7' } : {}}>
                      <span className="w-5 mr-2 text-sm font-bold flex-shrink-0" style={{ color: isLeader ? gold : '#9ca3af' }}>
                        {hasScores ? i + 1 : '–'}
                      </span>
                      <span className="flex-1 min-w-0 font-semibold text-gray-900 text-sm truncate">{row.team.name}</span>
                      {Array.from({ length: ballsCount }, (_, bi) => (
                        <span key={`f${bi}`} className="inline-flex justify-center text-xs flex-shrink-0" style={{ width: scoreColW }}>
                          <ScoreCell vp={row.frontSummary?.ballVsPar[bi] ?? null} />
                        </span>
                      ))}
                      <span className="flex-shrink-0" style={{ width: '0.75rem' }} />
                      {Array.from({ length: ballsCount }, (_, bi) => (
                        <span key={`b${bi}`} className="inline-flex justify-center text-xs flex-shrink-0" style={{ width: scoreColW }}>
                          <ScoreCell vp={row.backSummary?.ballVsPar[bi] ?? null} />
                        </span>
                      ))}
                      <span className="inline-flex justify-center text-sm text-gray-500 flex-shrink-0" style={{ width: '2.75rem' }}>
                        {thruCount === 0 ? '–' : thruCount === 18 ? 'F' : thruCount}
                      </span>
                      <span className="inline-flex justify-center text-gray-400 text-xs flex-shrink-0" style={{ width: '1.5rem' }}>{isExpanded ? '▲' : '▼'}</span>
                    </button>

                    {isExpanded && (
                      <div className="bg-gray-50 border-t border-gray-100 px-4 py-2 space-y-1">
                        <div className="flex justify-end mb-1">
                          <a href={`/scorecard/${row.team.id}`}
                            className="text-xs font-medium underline underline-offset-2"
                            style={{ color: navy }}>
                            Team Scorecard →
                          </a>
                        </div>
                        {teamPlayers.map((player) => {
                          const playerScores = scores.filter((s) => s.player_id === player.id)
                          const frontScores = playerScores.filter((s) => s.hole_number <= 9)
                          const frontStrokes = frontScores.reduce((sum, s) => sum + s.strokes, 0)
                          const frontPar = holes.filter((h) => h.hole_number <= 9 && frontScores.some((s) => s.hole_number === h.hole_number)).reduce((sum, h) => sum + h.par, 0)
                          const frontVp: number | null = frontScores.length > 0 ? frontStrokes - frontPar : null
                          const backScores = playerScores.filter((s) => s.hole_number >= 10)
                          const backStrokes = backScores.reduce((sum, s) => sum + s.strokes, 0)
                          const backPar = holes.filter((h) => h.hole_number >= 10 && backScores.some((s) => s.hole_number === h.hole_number)).reduce((sum, h) => sum + h.par, 0)
                          const backVp: number | null = backScores.length > 0 ? backStrokes - backPar : null
                          const totalPar = holes.filter((h) => playerScores.some((s) => s.hole_number === h.hole_number)).reduce((sum, h) => sum + h.par, 0)
                          const totalVp: number | null = playerScores.length > 0 ? playerScores.reduce((sum, s) => sum + s.strokes, 0) - totalPar : null
                          return (
                            <a key={player.id} href={`/player/${player.id}`}
                              className="w-full flex items-center py-1.5 pl-2 pr-0 rounded-lg hover:bg-white transition">
                              <span className="flex-1 text-sm text-gray-800">{player.name}</span>
                              <span className="flex items-center text-xs flex-shrink-0" style={{ gap: '0.6rem' }}>
                                {([['Front', frontVp], ['Back', backVp], ['Total', totalVp]] as [string, number | null][]).map(([label, vp]) => (
                                  <span key={label} className="flex items-center" style={{ gap: '0.15rem' }}>
                                    <span className="text-gray-400">{label}:</span>
                                    <span className="font-semibold" style={{ color: vp === null ? '#9ca3af' : vpColor(vp), display: 'inline-block', width: '1rem', textAlign: 'right' }}>
                                      {vpDisplay(vp)}
                                    </span>
                                  </span>
                                ))}
                              </span>
                            </a>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-3">
          {isDaytona ? 'Tap a player for their scorecard' : 'Tap a team to expand · tap a player for their scorecard'}
        </p>
      </div>

    </div>
  )
}
