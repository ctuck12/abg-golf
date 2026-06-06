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
const PRESS_COLORS = [gold, '#3b82f6', '#8b5cf6', '#ef4444', '#10b981']
const steelBlueBg = '#dbeafe'
const holeBg = '#dde4ee'

type Hole = { hole_number: number; par: number; stroke_index?: number | null }
type Score = { player_id: string; hole_number: number; strokes: number }
type PlayerInfo = { id: string; name: string; teamName: string; teamId?: string; handicap?: number | null }

function ptsStr(pts: number | null): string {
  if (pts === null) return '–'
  if (pts === 0) return '0'
  return pts > 0 ? `+${pts}` : String(pts)
}

function fmtVsp(n: number | null) { return n === null ? '–' : n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}` }
function vpColor(n: number | null) { return n === null ? 'rgba(255,255,255,0.55)' : n < 0 ? '#f87171' : n > 0 ? '#fbbf24' : 'rgba(255,255,255,0.8)' }

function fmtAmt(val: number): string {
  if (val === Math.floor(val)) return `$${val}`
  return `$${val.toFixed(2).replace(/^0/, '')}`
}

function renderPts(pts: number | null, fw: number, color: string, fs = '0.7rem') {
  if (pts === null) return <span style={{ color: '#d1d5db' }}>–</span>
  return (
    <span style={{ position: 'relative', display: 'inline-block', fontWeight: fw, color, fontSize: fs }}>
      {pts !== 0 && <span style={{ position: 'absolute', right: '100%', paddingRight: '1px' }}>{pts > 0 ? '+' : '-'}</span>}
      <span>{pts === 0 ? '0' : String(Math.abs(pts))}</span>
    </span>
  )
}

function ptsColor(pts: number | null): string {
  if (pts === null) return '#d1d5db'
  if (pts > 0) return '#16a34a'
  if (pts < 0) return '#dc2626'
  return '#374151'
}

export default function AllScorecardsView({
  orgSlug, orgId, orgName, isMaster = false,
  roundId, players: initialPlayers, allPlayerIds, holes, initialScores, initialAssignments, daytonaVariant, isAdmin = false, scorecardTeamId: scorecardTeamIdProp = null, teamHoleValues = {}, dtPayoutValue = 0, initialHoleStrokes = {},
}: {
  orgSlug: string; orgId: string; orgName: string; isMaster?: boolean
  roundId: string
  players: PlayerInfo[]
  allPlayerIds: string[]
  holes: Hole[]
  initialScores: Score[]
  initialAssignments: DaytonaHoleAssignment[]
  daytonaVariant: string
  isAdmin?: boolean
  scorecardTeamId?: string | null
  teamHoleValues?: Record<string, Record<number, number>>
  dtPayoutValue?: number
  initialHoleStrokes?: Record<string, number[]>
}) {
  const [scores, setScores] = useState(initialScores)
  const [showOptions, setShowOptions] = useState(false)
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false)
  const [assignments, setAssignments] = useState(initialAssignments)
  const [scorecardTeamId] = useState<string | null>(scorecardTeamIdProp)
  const [hcpVisible, setHcpVisible] = useState<Set<string>>(new Set())
  const toggleHcp = (id: string) => setHcpVisible((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })

  async function handleSignOut() {
    await fetch('/api/org-logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId }) })
    window.location.href = isMaster ? '/master/dashboard' : '/'
  }
  const is5Man = daytonaVariant.startsWith('5man')
  const isFlares = daytonaVariant === '5man-flares'

  useEffect(() => {
    async function refetchScores() {
      const { data } = await supabase
        .from('scores').select('player_id, hole_number, strokes').in('player_id', allPlayerIds)
      if (data) setScores(data)
    }
    const ch1 = supabase.channel('all-sc-scores')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, refetchScores)
      .subscribe()
    const ch2 = supabase.channel('all-sc-assignments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daytona_hole_assignments' }, async () => {
        const { data } = await supabase
          .from('daytona_hole_assignments').select('player_id, hole_number, side').eq('round_id', roundId)
        if (data) setAssignments(data as DaytonaHoleAssignment[])
      }).subscribe()
    const ch3 = supabase.channel('score-updates')
      .on('broadcast', { event: 'refresh' }, refetchScores)
      .subscribe()
    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2); supabase.removeChannel(ch3) }
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

  const thStyle = (highlight?: boolean, isHoleNum?: boolean): React.CSSProperties => ({
    background: highlight ? steelBlue : isHoleNum ? holeBg : navy,
    color: highlight ? 'white' : isHoleNum ? navy : 'white',
    fontWeight: 700,
    fontSize: '0.65rem',
    textAlign: 'center',
    padding: '0.5rem 0.45rem',
    whiteSpace: 'nowrap',
  })
  const tdPar = (highlight?: boolean): React.CSSProperties => ({
    background: highlight ? steelBlueBg : 'white',
    color: highlight ? '#1e40af' : '#6b7280',
    fontWeight: highlight ? 700 : 400,
    fontSize: '0.7rem',
    textAlign: 'center',
    padding: '0.45rem 0.45rem',
  })
  const tdCell = (highlight?: boolean): React.CSSProperties => ({
    background: highlight ? steelBlueBg : 'white',
    fontWeight: highlight ? 700 : 400,
    color: highlight ? '#1e40af' : undefined,
    fontSize: '0.7rem',
    textAlign: 'center',
    padding: '0.42rem 0.42rem',
  })
  const stickyFirst: React.CSSProperties = { position: 'sticky', left: 0, zIndex: 1 }
  const stickyFirstTh: React.CSSProperties = { position: 'sticky', left: 0, zIndex: 2 }

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>
      {showOptions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowOptions(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-gray-900">Options</h2>
              <button onClick={() => setShowOptions(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="flex flex-col gap-3">
              {isAdmin
                ? <a href={`/${orgSlug}/admin/dashboard`} className="w-full text-center py-3 rounded-xl font-semibold text-sm" style={{ background: navy, color: 'white' }}>Admin Hub</a>
                : <a href={`/${orgSlug}/admin`} className="w-full text-center py-3 rounded-xl font-semibold text-sm" style={{ background: navy, color: 'white' }}>Admin Login</a>
              }
              {isMaster && <a href="/master/dashboard" className="w-full text-center py-3 rounded-xl font-semibold text-sm border" style={{ borderColor: '#f59e0b', color: '#92400e', background: '#fffbeb' }}>← Master Admin</a>}
              {!isMaster && (showSignOutConfirm ? (
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
              ))}
            </div>
          </div>
        </div>
      )}
      <header className="text-white px-4 py-4 shadow-md" style={{ background: navy }}>
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide" style={{ color: gold }}>{isFlares ? '5-Man Flares' : is5Man ? '5-Man Daytona' : 'Daytona'}{dtPayoutValue > 0 ? ` – ${fmtAmt(dtPayoutValue)}/point` : ''}</p>
            <h1 className="font-bold text-lg">All Scorecards</h1>
            {(isAdmin || scorecardTeamId) && (
              <div className="flex items-center gap-1.5 mt-1">
                {isAdmin && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full text-white" style={{ background: '#dc2626' }}>Admin</span>}
                {scorecardTeamId && <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#16a34a' }}>Scorer</span>}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {scorecardTeamId ? (
              <a href={`/${orgSlug}/score/${scorecardTeamId}`}
                className="text-xs px-3 py-1.5 rounded-lg font-semibold border"
                style={{ background: navy, color: '#d1d5db', borderColor: 'rgba(255,255,255,0.4)' }}>
                Enter Scores
              </a>
            ) : (
              <button onClick={() => setShowOptions(true)}
                className="text-xs px-3 py-1.5 rounded-lg border font-medium text-white"
                style={{ borderColor: 'rgba(255,255,255,0.5)' }}>
                Options
              </button>
            )}
            <a href={`/${orgSlug}`} className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ background: gold, color: navy }}>Leaderboard</a>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-3 py-4 pb-10"><div className="overflow-x-auto"><div style={{ minWidth: '600px' }} className="space-y-3">
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

          const frontVspar = frontScored.length > 0 ? frontStrokes - frontScored.reduce((s, h) => s + h.par, 0) : null
          const backVspar = backScored.length > 0 ? backStrokes - backScored.reduce((s, h) => s + h.par, 0) : null
          const totalVspar = frontVspar !== null || backVspar !== null ? (frontVspar ?? 0) + (backVspar ?? 0) : null

          return (
            <div key={player.id} className="rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              {/* Player card header */}
              <div className="flex items-center gap-3 px-4 py-2" style={{ background: navy }}>
                <span className="text-base font-bold w-8 flex-shrink-0"
                  style={{ color: thru > 0 ? gold : 'rgba(255,255,255,0.25)' }}>
                  {thru > 0 ? `#${rank + 1}` : '–'}
                </span>
                <span className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="font-bold text-white text-sm truncate">{player.name}</span>
                  <span className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => toggleHcp(player.id)} className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: hcpVisible.has(player.id) ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.07)', color: hcpVisible.has(player.id) ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.15)' }}>HCP</button>
                    {player.handicap != null && <span className="text-[10px] font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>{player.handicap < 0 ? `+${Math.abs(player.handicap)}` : player.handicap}</span>}
                  </span>
                </span>
                <div className="flex items-center gap-4 text-[10px] font-semibold flex-shrink-0" style={{ color: 'rgba(255,255,255,0.55)' }}>
                  <span>Front: <span style={{ color: vpColor(frontVspar) }}>{fmtVsp(frontVspar)}</span></span>
                  <span>Back: <span style={{ color: vpColor(backVspar) }}>{fmtVsp(backVspar)}</span></span>
                  <span>Total: <span style={{ color: vpColor(totalVspar) }}>{fmtVsp(totalVspar)}</span></span>
                </div>
              </div>

              {/* Scorecard table */}
              <div className="bg-white">
                <table className="border-collapse" style={{ width: '100%', tableLayout: 'fixed' }}>
                  <thead style={{ borderTop: '1px solid #e5e7eb' }}>
                    <tr>
                      <th style={{ ...thStyle(false, true), textAlign: 'left', paddingLeft: '0.6rem', width: '3.5rem', ...stickyFirstTh }}>HOLE</th>
                      {[1,2,3,4,5,6,7,8,9].map((n) => {
                        const hasStroke = !!(initialHoleStrokes[player.id]?.includes(n))
                        return (
                          <th key={n} style={{ ...thStyle(false, true), width: '2.25rem' }}>
                            <span style={{ position: 'relative', display: 'inline-block' }}>{n}{hasStroke && <span style={{ position: 'absolute', top: '50%', left: '100%', transform: 'translateY(-50%)', color: '#16a34a', fontSize: '0.75rem', fontWeight: 700, lineHeight: 1, marginLeft: '1px' }}>*</span>}</span>
                          </th>
                        )
                      })}
                      <th style={{ ...thStyle(true), width: '2.8rem' }}>Front</th>
                      {[10,11,12,13,14,15,16,17,18].map((n) => {
                        const hasStroke = !!(initialHoleStrokes[player.id]?.includes(n))
                        return (
                          <th key={n} style={{ ...thStyle(false, true), width: '2.25rem' }}>
                            <span style={{ position: 'relative', display: 'inline-block' }}>{n}{hasStroke && <span style={{ position: 'absolute', top: '50%', left: '100%', transform: 'translateY(-50%)', color: '#16a34a', fontSize: '0.75rem', fontWeight: 700, lineHeight: 1, marginLeft: '1px' }}>*</span>}</span>
                          </th>
                        )
                      })}
                      <th style={{ ...thStyle(true), width: '2.8rem' }}>Back</th>
                      <th style={{ ...thStyle(), width: '2.8rem' }}>TOTAL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* HCP — hidden by default, toggled per player */}
                    {hcpVisible.has(player.id) && (
                      <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ ...tdPar(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>HCP</td>
                        {[1,2,3,4,5,6,7,8,9].map((n) => {
                          const hole = holes.find((h) => h.hole_number === n)
                          return <td key={n} style={tdPar()}>{hole?.stroke_index ?? '–'}</td>
                        })}
                        <td style={tdPar(true)} />
                        {[10,11,12,13,14,15,16,17,18].map((n) => {
                          const hole = holes.find((h) => h.hole_number === n)
                          return <td key={n} style={tdPar()}>{hole?.stroke_index ?? '–'}</td>
                        })}
                        <td style={tdPar(true)} /><td style={tdPar()} />
                      </tr>
                    )}
                    {/* PAR */}
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ ...tdPar(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>PAR</td>
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
                      <td style={{ ...tdCell(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>SCORE</td>
                      {[1,2,3,4,5,6,7,8,9].map((n) => {
                        const hole = holes.find((h) => h.hole_number === n)
                        const strokes = scoreMap[n] ?? null
                        return (
                          <td key={n} style={tdCell()}>
                            {strokes != null && hole ? <ScoreNotation strokes={strokes} par={hole.par} size="sm" /> : <span style={{ color: '#d1d5db' }}>–</span>}
                          </td>
                        )
                      })}
                      <td style={tdCell(true)}>{frontScored.length > 0 ? frontStrokes : '–'}</td>
                      {[10,11,12,13,14,15,16,17,18].map((n) => {
                        const hole = holes.find((h) => h.hole_number === n)
                        const strokes = scoreMap[n] ?? null
                        return (
                          <td key={n} style={tdCell()}>
                            {strokes != null && hole ? <ScoreNotation strokes={strokes} par={hole.par} size="sm" /> : <span style={{ color: '#d1d5db' }}>–</span>}
                          </td>
                        )
                      })}
                      <td style={tdCell(true)}>{backScored.length > 0 ? backStrokes : '–'}</td>
                      <td style={{ ...tdCell(), fontWeight: 700, color: '#111827' }}>
                        {thru > 0 ? playerScores.reduce((s, sc) => s + sc.strokes, 0) : '–'}
                      </td>
                    </tr>
                    {/* PTS + AMT */}
                    {(() => {
                      const teamVals = player.teamId ? teamHoleValues[player.teamId] ?? {} : {}
                      const hasPress = Object.keys(teamVals).length > 0
                      const sortedPressRates = [...new Set(Object.values(teamVals))].sort((a, b) => a - b)
                      const pressColor = (val: number) => PRESS_COLORS[sortedPressRates.indexOf(val) % PRESS_COLORS.length]
                      return (
                        <>
                          <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                            <td style={{ ...tdCell(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>PTS</td>
                            {[1,2,3,4,5,6,7,8,9].map((n) => {
                              const holePts = holePtsMaps.get(n)?.has(player.id) ? holePtsMaps.get(n)!.get(player.id)! : null
                              return (
                                <td key={n} style={tdCell()}>
                                  {renderPts(holePts, 600, ptsColor(holePts))}
                                </td>
                              )
                            })}
                            <td style={tdCell(true)}>{renderPts(frontPoints, 700, ptsColor(frontPoints))}</td>
                            {[10,11,12,13,14,15,16,17,18].map((n) => {
                              const holePts = holePtsMaps.get(n)?.has(player.id) ? holePtsMaps.get(n)!.get(player.id)! : null
                              return (
                                <td key={n} style={tdCell()}>
                                  {renderPts(holePts, 600, ptsColor(holePts))}
                                </td>
                              )
                            })}
                            <td style={tdCell(true)}>{renderPts(backPoints, 700, ptsColor(backPoints))}</td>
                            <td style={tdCell()}>{renderPts(totalPoints, 700, ptsColor(totalPoints))}</td>
                          </tr>
                          <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                              <td style={{ ...tdCell(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>TEAM</td>
                      {[1,2,3,4,5,6,7,8,9].map((n) => {
                        const a = assignments.find((a) => a.player_id === player.id && a.hole_number === n)
                        const side = a?.side ?? null
                        const par = holes.find((h) => h.hole_number === n)?.par ?? 4
                        const leftChar = isFlares ? (par === 3 ? 'C' : 'O') : 'L'
                        const rightChar = isFlares ? (par === 3 ? 'F' : 'I') : 'R'
                        return (
                          <td key={n} style={tdCell()}>
                            {side != null
                              ? <span style={{ fontWeight: 700, fontSize: '0.7rem', color: side === 'left' ? '#2563eb' : '#92400e' }}>{side === 'left' ? leftChar : rightChar}</span>
                              : <span style={{ color: '#d1d5db' }}>–</span>}
                          </td>
                        )
                      })}
                      <td style={tdCell(true)} />
                      {[10,11,12,13,14,15,16,17,18].map((n) => {
                        const a = assignments.find((a) => a.player_id === player.id && a.hole_number === n)
                        const side = a?.side ?? null
                        const par = holes.find((h) => h.hole_number === n)?.par ?? 4
                        const leftChar = isFlares ? (par === 3 ? 'C' : 'O') : 'L'
                        const rightChar = isFlares ? (par === 3 ? 'F' : 'I') : 'R'
                        return (
                          <td key={n} style={tdCell()}>
                            {side != null
                              ? <span style={{ fontWeight: 700, fontSize: '0.7rem', color: side === 'left' ? '#2563eb' : '#92400e' }}>{side === 'left' ? leftChar : rightChar}</span>
                              : <span style={{ color: '#d1d5db' }}>–</span>}
                          </td>
                        )
                      })}
                      <td style={tdCell(true)} /><td style={tdCell()} />
                    </tr>
                        </>
                      )
                    })()}
                    {Object.keys(player.teamId ? teamHoleValues[player.teamId] ?? {} : {}).length > 0 && <tr>
                      <td style={{ ...tdCell(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>PRESS</td>
                      {[1,2,3,4,5,6,7,8,9].map((n) => {
                        const teamVals2 = player.teamId ? teamHoleValues[player.teamId] ?? {} : {}
                        const pressRate = teamVals2[n]
                        const sortedRates2 = [...new Set(Object.values(teamVals2))].sort((a, b) => a - b)
                        const pressCol2 = (val: number) => PRESS_COLORS[sortedRates2.indexOf(val) % PRESS_COLORS.length]
                        const color = pressRate !== undefined ? pressCol2(pressRate) : '#9ca3af'
                        return <td key={n} style={tdCell()}>{pressRate !== undefined ? <span style={{ fontWeight: 600, fontSize: '0.65rem', color }}>{fmtAmt(pressRate)}</span> : <span style={{ color: '#d1d5db' }}>–</span>}</td>
                      })}
                      <td style={tdCell(true)} />
                      {[10,11,12,13,14,15,16,17,18].map((n) => {
                        const teamVals2 = player.teamId ? teamHoleValues[player.teamId] ?? {} : {}
                        const pressRate = teamVals2[n]
                        const sortedRates2 = [...new Set(Object.values(teamVals2))].sort((a, b) => a - b)
                        const pressCol2 = (val: number) => PRESS_COLORS[sortedRates2.indexOf(val) % PRESS_COLORS.length]
                        const color = pressRate !== undefined ? pressCol2(pressRate) : '#9ca3af'
                        return <td key={n} style={tdCell()}>{pressRate !== undefined ? <span style={{ fontWeight: 600, fontSize: '0.65rem', color }}>{fmtAmt(pressRate)}</span> : <span style={{ color: '#d1d5db' }}>–</span>}</td>
                      })}
                      <td style={tdCell(true)} /><td style={tdCell()} />
                    </tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}
      </div></div></div>
    </div>
  )
}
