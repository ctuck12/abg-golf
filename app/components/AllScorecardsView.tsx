'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import {
  computeHoleDaytonaWithSides, computeHoleDaytonaPointsFiveMan,
  type DaytonaHoleAssignment,
} from '@/lib/scoring'
import { ScoreNotation } from './ScoreNotation'

const navy = '#0f172a'
const gold = '#f59e0b'
const steelBlue = '#4a7fa5'
const steelBlueBg = '#dbeafe'

type Hole = { hole_number: number; par: number }
type Score = { player_id: string; hole_number: number; strokes: number }
type PlayerInfo = { id: string; name: string; teamName: string }

function ptsStr(pts: number | null): string {
  if (pts === null) return '–'
  if (pts === 0) return '0'
  return pts > 0 ? `+${pts}` : String(pts)
}

function ptsColor(pts: number | null): string {
  if (pts === null) return '#d1d5db'
  if (pts > 0) return '#16a34a'
  if (pts < 0) return '#dc2626'
  return '#374151'
}

export default function AllScorecardsView({
  roundId, players: initialPlayers, allPlayerIds, holes, initialScores, initialAssignments, daytonaVariant,
}: {
  roundId: string
  players: PlayerInfo[]
  allPlayerIds: string[]
  holes: Hole[]
  initialScores: Score[]
  initialAssignments: DaytonaHoleAssignment[]
  daytonaVariant: string
}) {
  const [scores, setScores] = useState(initialScores)
  const [assignments, setAssignments] = useState(initialAssignments)
  const is5Man = daytonaVariant.startsWith('5man')

  useEffect(() => {
    const ch1 = supabase.channel('all-sc-scores')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, async () => {
        const { data } = await supabase
          .from('scores').select('player_id, hole_number, strokes').in('player_id', allPlayerIds)
        if (data) setScores(data)
      }).subscribe()
    const ch2 = supabase.channel('all-sc-assignments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daytona_hole_assignments' }, async () => {
        const { data } = await supabase
          .from('daytona_hole_assignments').select('player_id, hole_number, side').eq('round_id', roundId)
        if (data) setAssignments(data as DaytonaHoleAssignment[])
      }).subscribe()
    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2) }
  }, [roundId, allPlayerIds])

  // Pre-compute per-hole points maps once
  const holePtsMaps = new Map<number, Map<string, number>>()
  for (const hole of holes) {
    const holeAssignments = assignments.filter((a) => a.hole_number === hole.hole_number)
    const leftIds = holeAssignments.filter((a) => a.side === 'left').map((a) => a.player_id)
    const rightIds = holeAssignments.filter((a) => a.side === 'right').map((a) => a.player_id)
    if (is5Man) {
      if (leftIds.length >= 2 && rightIds.length >= 3) {
        holePtsMaps.set(hole.hole_number, computeHoleDaytonaPointsFiveMan(leftIds, rightIds, scores, hole.hole_number, hole.par))
      }
    } else {
      if (leftIds.length >= 2 && rightIds.length >= 2) {
        const leftSc = leftIds.map((id) => scores.find((s) => s.player_id === id && s.hole_number === hole.hole_number)?.strokes).filter((s): s is number => s !== undefined)
        const rightSc = rightIds.map((id) => scores.find((s) => s.player_id === id && s.hole_number === hole.hole_number)?.strokes).filter((s): s is number => s !== undefined)
        if (leftSc.length >= 2 && rightSc.length >= 2) {
          const { leftDt, rightDt } = computeHoleDaytonaWithSides(leftSc, rightSc, hole.par)
          if (leftDt !== null && rightDt !== null) {
            const diff = Math.abs(leftDt - rightDt)
            const leftWins = leftDt < rightDt; const rightWins = rightDt < leftDt
            const m = new Map<string, number>()
            for (const id of leftIds) m.set(id, leftWins ? diff : rightWins ? -diff : 0)
            for (const id of rightIds) m.set(id, rightWins ? diff : leftWins ? -diff : 0)
            holePtsMaps.set(hole.hole_number, m)
          }
        }
      }
    }
  }

  // Total points per player
  const totalPtsMap = new Map<string, number>()
  for (const [, m] of holePtsMaps) {
    for (const [pid, pts] of m) totalPtsMap.set(pid, (totalPtsMap.get(pid) ?? 0) + pts)
  }

  // Re-rank based on live totals
  const rankedPlayers = [...initialPlayers].sort((a, b) => {
    const aThru = scores.filter((s) => s.player_id === a.id).length
    const bThru = scores.filter((s) => s.player_id === b.id).length
    if (aThru === 0 && bThru === 0) return a.name.localeCompare(b.name)
    if (aThru === 0) return 1
    if (bThru === 0) return -1
    return (totalPtsMap.get(b.id) ?? 0) - (totalPtsMap.get(a.id) ?? 0)
  })

  const frontNine = holes.filter((h) => h.hole_number <= 9)
  const backNine = holes.filter((h) => h.hole_number >= 10)
  const frontPar = frontNine.reduce((s, h) => s + h.par, 0)
  const backPar = backNine.reduce((s, h) => s + h.par, 0)
  const totalPar = holes.reduce((s, h) => s + h.par, 0)

  const thStyle = (highlight?: boolean): React.CSSProperties => ({
    background: highlight ? steelBlue : navy,
    color: 'white',
    fontWeight: 700,
    fontSize: '0.65rem',
    textAlign: 'center',
    padding: '0.4rem 0.25rem',
    whiteSpace: 'nowrap',
  })
  const tdPar = (highlight?: boolean): React.CSSProperties => ({
    background: highlight ? steelBlueBg : 'white',
    color: highlight ? '#1e40af' : '#6b7280',
    fontWeight: highlight ? 700 : 400,
    fontSize: '0.7rem',
    textAlign: 'center',
    padding: '0.35rem 0.25rem',
  })
  const tdCell = (highlight?: boolean): React.CSSProperties => ({
    background: highlight ? steelBlueBg : 'white',
    fontWeight: highlight ? 700 : 400,
    color: highlight ? '#1e40af' : undefined,
    fontSize: '0.7rem',
    textAlign: 'center',
    padding: '0.25rem 0.2rem',
  })

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>
      <header className="text-white px-4 py-4 shadow-md" style={{ background: navy }}>
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide" style={{ color: gold }}>Daytona</p>
            <h1 className="font-bold text-lg">All Scorecards</h1>
          </div>
          <a href="/" className="text-xs px-3 py-1.5 rounded-lg font-semibold"
            style={{ background: gold, color: navy }}>
            Leaderboard
          </a>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-3 py-4 space-y-6 pb-10">
        {rankedPlayers.map((player, rank) => {
          const playerScores = scores.filter((s) => s.player_id === player.id)
          const scoreMap = Object.fromEntries(playerScores.map((s) => [s.hole_number, s.strokes]))
          const thru = playerScores.length
          const totalPoints = totalPtsMap.has(player.id) ? totalPtsMap.get(player.id)! : null

          const frontScored = frontNine.filter((h) => scoreMap[h.hole_number] != null)
          const frontStrokes = frontScored.reduce((s, h) => s + scoreMap[h.hole_number]!, 0)
          const frontPtsHoles = frontNine.filter((h) => holePtsMaps.get(h.hole_number)?.has(player.id))
          const frontPoints: number | null = frontPtsHoles.length > 0
            ? frontPtsHoles.reduce((s, h) => s + (holePtsMaps.get(h.hole_number)?.get(player.id) ?? 0), 0)
            : null

          const backScored = backNine.filter((h) => scoreMap[h.hole_number] != null)
          const backStrokes = backScored.reduce((s, h) => s + scoreMap[h.hole_number]!, 0)
          const backPtsHoles = backNine.filter((h) => holePtsMaps.get(h.hole_number)?.has(player.id))
          const backPoints: number | null = backPtsHoles.length > 0
            ? backPtsHoles.reduce((s, h) => s + (holePtsMaps.get(h.hole_number)?.get(player.id) ?? 0), 0)
            : null

          return (
            <div key={player.id} className="rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              {/* Player card header */}
              <div className="flex items-center justify-between px-4 py-3" style={{ background: navy }}>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold w-8 flex-shrink-0"
                    style={{ color: thru > 0 ? gold : 'rgba(255,255,255,0.25)' }}>
                    {thru > 0 ? `#${rank + 1}` : '–'}
                  </span>
                  <div>
                    <p className="font-bold text-white text-sm leading-tight">{player.name}</p>
                    <p className="text-xs leading-tight" style={{ color: 'rgba(255,255,255,0.5)' }}>{player.teamName}</p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>Points</p>
                  <p className="font-bold text-sm" style={{ color: ptsColor(totalPoints) }}>
                    {ptsStr(totalPoints)}
                  </p>
                </div>
              </div>

              {/* Scorecard table */}
              <div className="overflow-x-auto bg-white">
                <table className="border-collapse" style={{ minWidth: '600px', width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ ...thStyle(), textAlign: 'left', paddingLeft: '0.6rem', minWidth: '3.5rem' }}>HOLE</th>
                      {[1,2,3,4,5,6,7,8,9].map((n) => <th key={n} style={{ ...thStyle(), minWidth: '2.25rem' }}>{n}</th>)}
                      <th style={thStyle(true)}>Front</th>
                      {[10,11,12,13,14,15,16,17,18].map((n) => <th key={n} style={{ ...thStyle(), minWidth: '2.25rem' }}>{n}</th>)}
                      <th style={thStyle(true)}>Back</th>
                      <th style={thStyle()}>TOTAL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* PAR */}
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ ...tdPar(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151' }}>PAR</td>
                      {[1,2,3,4,5,6,7,8,9].map((n) => {
                        const hole = holes.find((h) => h.hole_number === n)
                        return <td key={n} style={tdPar()}>{hole?.par ?? '–'}</td>
                      })}
                      <td style={tdPar(true)}>{frontNine.length > 0 ? frontPar : '–'}</td>
                      {[10,11,12,13,14,15,16,17,18].map((n) => {
                        const hole = holes.find((h) => h.hole_number === n)
                        return <td key={n} style={tdPar()}>{hole?.par ?? '–'}</td>
                      })}
                      <td style={tdPar(true)}>{backNine.length > 0 ? backPar : '–'}</td>
                      <td style={{ ...tdPar(), fontWeight: 700, color: '#111827' }}>{totalPar}</td>
                    </tr>
                    {/* SCORE */}
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ ...tdCell(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151' }}>SCORE</td>
                      {[1,2,3,4,5,6,7,8,9].map((n) => {
                        const hole = holes.find((h) => h.hole_number === n)
                        const strokes = scoreMap[n] ?? null
                        return (
                          <td key={n} style={tdCell()}>
                            {strokes != null && hole
                              ? <ScoreNotation strokes={strokes} par={hole.par} size="sm" />
                              : <span style={{ color: '#d1d5db' }}>–</span>}
                          </td>
                        )
                      })}
                      <td style={tdCell(true)}>{frontScored.length > 0 ? frontStrokes : '–'}</td>
                      {[10,11,12,13,14,15,16,17,18].map((n) => {
                        const hole = holes.find((h) => h.hole_number === n)
                        const strokes = scoreMap[n] ?? null
                        return (
                          <td key={n} style={tdCell()}>
                            {strokes != null && hole
                              ? <ScoreNotation strokes={strokes} par={hole.par} size="sm" />
                              : <span style={{ color: '#d1d5db' }}>–</span>}
                          </td>
                        )
                      })}
                      <td style={tdCell(true)}>{backScored.length > 0 ? backStrokes : '–'}</td>
                      <td style={{ ...tdCell(), fontWeight: 700, color: '#111827' }}>
                        {thru > 0 ? playerScores.reduce((s, sc) => s + sc.strokes, 0) : '–'}
                      </td>
                    </tr>
                    {/* PTS */}
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ ...tdCell(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151' }}>PTS</td>
                      {[1,2,3,4,5,6,7,8,9].map((n) => {
                        const holePts = holePtsMaps.get(n)?.has(player.id) ? holePtsMaps.get(n)!.get(player.id)! : null
                        return (
                          <td key={n} style={tdCell()}>
                            <span style={{ fontWeight: 600, color: ptsColor(holePts), fontSize: '0.7rem' }}>{ptsStr(holePts)}</span>
                          </td>
                        )
                      })}
                      <td style={tdCell(true)}>
                        <span style={{ fontWeight: 700, color: ptsColor(frontPoints) }}>{ptsStr(frontPoints)}</span>
                      </td>
                      {[10,11,12,13,14,15,16,17,18].map((n) => {
                        const holePts = holePtsMaps.get(n)?.has(player.id) ? holePtsMaps.get(n)!.get(player.id)! : null
                        return (
                          <td key={n} style={tdCell()}>
                            <span style={{ fontWeight: 600, color: ptsColor(holePts), fontSize: '0.7rem' }}>{ptsStr(holePts)}</span>
                          </td>
                        )
                      })}
                      <td style={tdCell(true)}>
                        <span style={{ fontWeight: 700, color: ptsColor(backPoints) }}>{ptsStr(backPoints)}</span>
                      </td>
                      <td style={{ ...tdCell(), fontWeight: 700, color: ptsColor(totalPoints) }}>
                        {ptsStr(totalPoints)}
                      </td>
                    </tr>
                    {/* TEAM */}
                    <tr>
                      <td style={{ ...tdCell(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151' }}>TEAM</td>
                      {[1,2,3,4,5,6,7,8,9].map((n) => {
                        const a = assignments.find((a) => a.player_id === player.id && a.hole_number === n)
                        const side = a?.side ?? null
                        return (
                          <td key={n} style={tdCell()}>
                            {side != null
                              ? <span style={{ fontWeight: 700, fontSize: '0.7rem', color: side === 'left' ? '#2563eb' : '#92400e' }}>{side === 'left' ? 'L' : 'R'}</span>
                              : <span style={{ color: '#d1d5db' }}>–</span>}
                          </td>
                        )
                      })}
                      <td style={tdCell(true)} />
                      {[10,11,12,13,14,15,16,17,18].map((n) => {
                        const a = assignments.find((a) => a.player_id === player.id && a.hole_number === n)
                        const side = a?.side ?? null
                        return (
                          <td key={n} style={tdCell()}>
                            {side != null
                              ? <span style={{ fontWeight: 700, fontSize: '0.7rem', color: side === 'left' ? '#2563eb' : '#92400e' }}>{side === 'left' ? 'L' : 'R'}</span>
                              : <span style={{ color: '#d1d5db' }}>–</span>}
                          </td>
                        )
                      })}
                      <td style={tdCell(true)} />
                      <td style={tdCell()} />
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
