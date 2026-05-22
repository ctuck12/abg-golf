'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { computeTeamBallSummary } from '@/lib/scoring'
import PinLoginModal from './PinLoginModal'

type Team = { id: string; name: string }
type Player = { id: string; team_id: string; name: string }
type Hole = { hole_number: number; par: number }
type Score = { player_id: string; hole_number: number; strokes: number }

const navy = '#0f172a'
const gold = '#f59e0b'
const BALL_LABELS = ['1-Ball', '2-Ball', '3-Ball', '4-Ball']

function ScoreCell({ vp }: { vp: number | null }) {
  if (vp === null) return <span className="text-gray-300">–</span>
  if (vp === 0) return <span className="text-gray-500">E</span>
  if (vp < 0) return <span className="font-semibold text-blue-600">{vp}</span>
  return <span className="font-semibold text-red-500">+{vp}</span>
}

export default function LeaderboardClient({
  initialTeams, players, holes, initialScores, ballsCount, roundName, roundDate, roundCourse, viewOnly = false,
}: {
  initialTeams: Team[]
  players: Player[]
  holes: Hole[]
  initialScores: Score[]
  ballsCount: number
  roundName: string
  roundDate: string
  roundCourse: string
  viewOnly?: boolean
}) {
  const [scores, setScores] = useState<Score[]>(initialScores)
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const [showPin, setShowPin] = useState(false)
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null)

  useEffect(() => {
    const playerIds = players.map((p) => p.id)
    const channel = supabase.channel('leaderboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, async () => {
        const { data } = await supabase
          .from('scores').select('player_id, hole_number, strokes').in('player_id', playerIds)
        if (data) { setScores(data); setLastUpdated(new Date()) }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [players])

  const rows = initialTeams.map((team) => {
    const teamPlayers = players.filter((p) => p.team_id === team.id)
    const summary = computeTeamBallSummary(holes, teamPlayers.map((p) => p.id), scores, ballsCount)
    return { team, summary }
  }).sort((a, b) => {
    for (let i = 0; i < ballsCount; i++) {
      const av = a.summary.ballVsPar[i]
      const bv = b.summary.ballVsPar[i]
      if (av == null && bv == null) continue
      if (av == null) return 1
      if (bv == null) return -1
      if (av !== bv) return av - bv
    }
    return a.team.name.localeCompare(b.team.name)
  })

  const formattedDate = new Date(roundDate + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })

  const colWidth = ballsCount <= 3 ? '4rem' : '3.5rem'

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>
      {showPin && <PinLoginModal teams={initialTeams} onClose={() => setShowPin(false)} />}

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
              <div className="flex flex-col items-end gap-1.5 mt-0.5">
                <a
                  href="/admin"
                  className="text-xs px-3 py-1 rounded-lg border font-medium"
                  style={{ borderColor: 'rgba(255,255,255,0.3)', color: 'rgba(255,255,255,0.8)' }}
                >
                  Admin
                </a>
                <button
                  onClick={() => setShowPin(true)}
                  className="text-xs px-3 py-1 rounded-lg font-medium"
                  style={{ background: gold, color: navy }}
                >
                  Team PIN
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: gold }}>
                Anything But Golf Group
              </p>
              <h1 className="text-xl font-bold">{roundName}</h1>
              <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
                {roundCourse && `${roundCourse} · `}{formattedDate}
              </p>
            </div>
          )}
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 pt-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-gray-900">Leaderboard</h2>
          <div className="flex items-center gap-3">
            {viewOnly && (
              <a href="/matchup" className="text-xs font-semibold px-3 py-1.5 rounded-lg border"
                style={{ borderColor: navy, color: navy }}>
                Matchup ⚔
              </a>
            )}
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" />
              Live · {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="flex items-center px-4 py-2 text-xs font-semibold uppercase"
            style={{ background: navy, color: 'rgba(255,255,255,0.6)' }}>
            <span className="w-6 mr-3">#</span>
            <span className="flex-1">Team</span>
            {Array.from({ length: ballsCount }, (_, i) => (
              <span key={i} className="text-center" style={{ width: colWidth }}>{BALL_LABELS[i]}</span>
            ))}
            <span className="text-center" style={{ width: '3rem' }}>Thru</span>
          </div>

          {rows.length === 0 && (
            <p className="text-center text-gray-500 text-sm py-8">No scores yet.</p>
          )}

          {rows.map((row, i) => {
            const hasScores = row.summary.holesPerBall[0] > 0
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
                  <span className="w-6 mr-3 text-sm font-bold flex-shrink-0" style={{ color: isLeader ? gold : '#9ca3af' }}>
                    {hasScores ? i + 1 : '–'}
                  </span>
                  <span className="flex-1 font-semibold text-gray-900 text-sm truncate">{row.team.name}</span>
                  {Array.from({ length: ballsCount }, (_, bi) => (
                    <span key={bi} className="text-center text-sm flex-shrink-0" style={{ width: colWidth }}>
                      <ScoreCell vp={row.summary.ballVsPar[bi]} />
                    </span>
                  ))}
                  <span className="text-center text-sm text-gray-500 flex-shrink-0" style={{ width: '3rem' }}>
                    {row.summary.holesPerBall[0] === 0 ? '–'
                      : row.summary.holesPerBall[0] === 18 ? 'F'
                      : row.summary.holesPerBall[0]}
                  </span>
                  <span className="ml-2 text-gray-400 text-xs flex-shrink-0">{isExpanded ? '▲' : '▼'}</span>
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
                      const thru = playerScores.length
                      const total = playerScores.reduce((sum, s) => sum + s.strokes, 0)
                      const parSoFar = holes
                        .filter((h) => playerScores.some((s) => s.hole_number === h.hole_number))
                        .reduce((sum, h) => sum + h.par, 0)
                      const vp = thru > 0 ? total - parSoFar : null
                      return (
                        <a key={player.id} href={`/player/${player.id}`}
                          className="flex items-center py-1.5 px-2 rounded-lg hover:bg-white transition">
                          <span className="flex-1 text-sm text-gray-800">{player.name}</span>
                          <span className="text-xs text-gray-400 mr-3">
                            {thru === 0 ? 'No scores' : thru === 18 ? 'F' : `Thru ${thru}`}
                          </span>
                          <span className="text-sm font-semibold w-8 text-right"
                            style={{ color: vp == null ? '#9ca3af' : vp < 0 ? '#2563eb' : vp > 0 ? '#dc2626' : '#6b7280' }}>
                            {vp == null ? '–' : vp === 0 ? 'E' : vp > 0 ? `+${vp}` : vp}
                          </span>
                        </a>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <p className="text-center text-xs text-gray-400 mt-3">Tap a team to expand · tap a player for their scorecard</p>

        {!viewOnly && (
          <div className="mt-4 text-center">
            <a href="/" className="text-sm font-medium" style={{ color: navy }}>← Enter Scores</a>
          </div>
        )}

        {viewOnly && (
          <div className="mt-4 text-center">
            <a href="/matchup" className="text-sm font-medium" style={{ color: navy }}>Player Matchup →</a>
          </div>
        )}
      </div>
    </div>
  )
}
