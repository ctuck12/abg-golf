'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { ScoreNotation } from './ScoreNotation'
import { computeHoleDaytonaWithSides, computeHoleDaytonaPointsFiveMan, type DaytonaHoleAssignment } from '@/lib/scoring'

const navy = '#0f172a'
const gold = '#f59e0b'
const steelBlue = '#4a7fa5'
const steelBlueBg = '#dbeafe'
const PRESS_COLORS = [gold, '#3b82f6', '#8b5cf6', '#ef4444', '#10b981']

function fmtAmt(val: number): string {
  if (val === Math.floor(val)) return `$${val}`
  return `$${val.toFixed(2).replace(/^0/, '')}`
}

type Hole = { hole_number: number; par: number }
type Score = { hole_number: number; strokes: number }
type RoundScore = { player_id: string; hole_number: number; strokes: number }

function vpStr(vp: number | null): string {
  if (vp === null) return '–'
  if (vp === 0) return 'E'
  return vp > 0 ? `+${vp}` : String(vp)
}

function vpColor(vp: number | null): string {
  if (vp === null) return '#9ca3af'
  if (vp < 0) return '#dc2626'
  return '#111827'
}

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

export default function PlayerScorecard({
  orgSlug, orgId, orgName, isMaster = false,
  player, teamName, teamId, holes, scores: initialScores, format = 'standard', dtData, isAdmin = false,
}: {
  orgSlug: string; orgId: string; orgName: string; isMaster?: boolean
  player: { id: string; name: string }
  teamName: string
  teamId: string
  holes: Hole[]
  scores: Score[]
  format?: string
  dtData?: {
    roundId: string
    allPlayerIds: string[]
    assignments: DaytonaHoleAssignment[]
    allRoundScores: RoundScore[]
    daytonaVariant?: string
    pressedHoles?: Record<number, number>
    dtPayoutValue?: number
  }
  isAdmin?: boolean
}) {
  const [scores, setScores] = useState(initialScores)
  const [allRoundScores, setAllRoundScores] = useState<RoundScore[]>(dtData?.allRoundScores ?? [])
  const [scorecardTeamId, setScorecardTeamId] = useState<string | null>(null)
  const [showOptions, setShowOptions] = useState(false)
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false)

  async function handleSignOut() {
    await fetch('/api/org-logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId }) })
    window.location.href = isMaster ? '/master/dashboard' : `/${orgSlug}`
  }
  const isDaytona = format === 'daytona'
  const assignments = dtData?.assignments ?? []

  useEffect(() => {
    fetch('/api/auth-status', { credentials: 'include', cache: 'no-store' })
      .then((r) => r.json())
      .then(({ scorecardTeamId: t }: { isAdmin: boolean; scorecardTeamId: string | null }) => setScorecardTeamId(t))
      .catch(() => {})
  }, [])

  useEffect(() => {
    async function refetchScores() {
      const { data } = await supabase
        .from('scores')
        .select('hole_number, strokes')
        .eq('player_id', player.id)
      if (data) setScores(data)
    }
    const ch1 = supabase.channel(`player-${player.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, refetchScores)
      .subscribe()
    const ch2 = supabase.channel(`player-updates-${player.id}`)
      .on('broadcast', { event: 'refresh' }, refetchScores)
      .subscribe()
    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2) }
  }, [player.id])

  useEffect(() => {
    if (!isDaytona || !dtData) return
    const allPlayerIds = dtData.allPlayerIds
    async function refetchDaytona() {
      const { data } = await supabase
        .from('scores').select('player_id, hole_number, strokes').in('player_id', allPlayerIds)
      if (data) setAllRoundScores(data)
    }
    const ch1 = supabase.channel(`player-dt-${player.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, refetchDaytona)
      .subscribe()
    const ch2 = supabase.channel(`player-dt-updates-${player.id}`)
      .on('broadcast', { event: 'refresh' }, refetchDaytona)
      .subscribe()
    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2) }
  }, [isDaytona, dtData?.roundId])

  // Compute per-hole points for this player (Daytona only)
  const daytonaVariant = dtData?.daytonaVariant ?? '4man'
  const is5Man = daytonaVariant === '5man-normal' || daytonaVariant === '5man-flares'
  const holePointsMap = new Map<number, number>()
  if (isDaytona) {
    for (const hole of holes) {
      const holeAssignments = assignments.filter((a) => a.hole_number === hole.hole_number)
      const leftIds = holeAssignments.filter((a) => a.side === 'left').map((a) => a.player_id)
      const rightIds = holeAssignments.filter((a) => a.side === 'right').map((a) => a.player_id)
      if (is5Man) {
        if (leftIds.length < 2 || rightIds.length < 3) continue
        const holePoints = computeHoleDaytonaPointsFiveMan(leftIds, rightIds, allRoundScores, hole.hole_number, hole.par)
        const pts = holePoints.get(player.id)
        if (pts !== undefined) holePointsMap.set(hole.hole_number, pts)
      } else {
        if (leftIds.length < 2 || rightIds.length < 2) continue
        const isOnLeft = leftIds.includes(player.id)
        const isOnRight = rightIds.includes(player.id)
        if (!isOnLeft && !isOnRight) continue
        const leftScores = leftIds.map((id) => allRoundScores.find((s) => s.player_id === id && s.hole_number === hole.hole_number)?.strokes).filter((s): s is number => s !== undefined)
        const rightScores = rightIds.map((id) => allRoundScores.find((s) => s.player_id === id && s.hole_number === hole.hole_number)?.strokes).filter((s): s is number => s !== undefined)
        if (leftScores.length < 2 || rightScores.length < 2) continue
        const { leftDt, rightDt } = computeHoleDaytonaWithSides(leftScores, rightScores, hole.par)
        if (leftDt === null || rightDt === null) continue
        const diff = Math.abs(leftDt - rightDt)
        const leftWins = leftDt < rightDt
        const rightWins = rightDt < leftDt
        const pts = isOnLeft
          ? (leftWins ? diff : rightWins ? -diff : 0)
          : (rightWins ? diff : leftWins ? -diff : 0)
        holePointsMap.set(hole.hole_number, pts)
      }
    }
  }

  const scoreMap = Object.fromEntries(scores.map((s) => [s.hole_number, s.strokes]))
  const thru = scores.length
  const totalStrokes = scores.reduce((sum, s) => sum + s.strokes, 0)
  const parForThru = holes
    .filter((h) => scoreMap[h.hole_number] != null)
    .reduce((sum, h) => sum + h.par, 0)
  const totalPar = holes.reduce((sum, h) => sum + h.par, 0)
  const vsParThru = thru > 0 ? totalStrokes - parForThru : null

  const frontNine = holes.filter((h) => h.hole_number <= 9)
  const backNine = holes.filter((h) => h.hole_number >= 10)
  const frontPar = frontNine.reduce((s, h) => s + h.par, 0)
  const backPar = backNine.reduce((s, h) => s + h.par, 0)

  const frontScored = frontNine.filter((h) => scoreMap[h.hole_number] != null)
  const frontVp: number | null = frontScored.length > 0
    ? frontScored.reduce((s, h) => s + scoreMap[h.hole_number]!, 0) - frontScored.reduce((s, h) => s + h.par, 0)
    : null
  const backScored = backNine.filter((h) => scoreMap[h.hole_number] != null)
  const backVp: number | null = backScored.length > 0
    ? backScored.reduce((s, h) => s + scoreMap[h.hole_number]!, 0) - backScored.reduce((s, h) => s + h.par, 0)
    : null

  const frontScoredStrokes = frontScored.reduce((s, h) => s + scoreMap[h.hole_number]!, 0)
  const backScoredStrokes = backScored.reduce((s, h) => s + scoreMap[h.hole_number]!, 0)

  // Points summary for Daytona
  const frontPtsHoles = frontNine.filter((h) => holePointsMap.has(h.hole_number))
  const frontPoints: number | null = frontPtsHoles.length > 0
    ? frontPtsHoles.reduce((s, h) => s + holePointsMap.get(h.hole_number)!, 0)
    : null
  const backPtsHoles = backNine.filter((h) => holePointsMap.has(h.hole_number))
  const backPoints: number | null = backPtsHoles.length > 0
    ? backPtsHoles.reduce((s, h) => s + holePointsMap.get(h.hole_number)!, 0)
    : null
  const totalPoints: number | null = holePointsMap.size > 0
    ? [...holePointsMap.values()].reduce((s, v) => s + v, 0)
    : null

  const thStyle = (highlight?: boolean): React.CSSProperties => ({
    background: highlight ? steelBlue : navy,
    color: 'white',
    fontWeight: 700,
    fontSize: '0.65rem',
    textAlign: 'center',
    padding: '0.4rem 0.25rem',
    whiteSpace: 'nowrap',
  })
  const tdPar = (highlight?: boolean, isParCell?: boolean): React.CSSProperties => ({
    background: highlight ? steelBlueBg : isParCell ? '#dde4ee' : 'white',
    color: highlight ? '#1e40af' : '#6b7280',
    fontWeight: highlight ? 700 : 400,
    fontSize: '0.7rem',
    textAlign: 'center',
    padding: '0.35rem 0.25rem',
  })
  const tdScore = (highlight?: boolean): React.CSSProperties => ({
    background: highlight ? steelBlueBg : 'white',
    fontWeight: highlight ? 700 : 400,
    color: highlight ? '#1e40af' : undefined,
    fontSize: '0.7rem',
    textAlign: 'center',
    padding: '0.25rem 0.2rem',
  })

  const optionsPopup = showOptions && (
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
  )

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>
      {optionsPopup}
      <header className="text-white px-4 py-4 shadow-md" style={{ background: navy }}>
        <div className="max-w-4xl mx-auto flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: gold }}>
              Player Scorecard
            </p>
            <h1 className="font-bold text-xl">{player.name}</h1>
            <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
              {teamName}
            </p>
          </div>
          <div className="flex items-center gap-2 mt-1 flex-shrink-0">
            {scorecardTeamId ? (
              <a href={`/${orgSlug}/score/${scorecardTeamId}`}
                className="text-xs px-3 py-1.5 rounded-lg font-semibold border"
                style={{ background: navy, color: '#9ca3af', borderColor: '#6b7280' }}>
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

      <div className="max-w-4xl mx-auto px-4 pt-4">
        {/* Summary banner */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-5 py-4 mb-4">
          <div className="flex items-center justify-around">
            {([['Front', frontVp], ['Back', backVp], ['Total', vsParThru]] as [string, number | null][]).map(([label, vp]) => (
              <div key={label} className="text-center">
                <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                <p className="text-2xl font-bold" style={{ color: vpColor(vp) }}>{vpStr(vp)}</p>
              </div>
            ))}
          </div>
          {isDaytona && (
            <div className="flex items-center justify-around mt-3 pt-3 border-t border-gray-100">
              {([['Front Pts', frontPoints], ['Back Pts', backPoints], ['Total Pts', totalPoints]] as [string, number | null][]).map(([label, pts]) => (
                <div key={label} className="text-center">
                  <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                  <p className="text-xl font-bold" style={{ color: ptsColor(pts) }}>{ptsStr(pts)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Horizontal scorecard */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-x-auto mb-4">
          <table className="border-collapse" style={{ minWidth: '600px', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ ...thStyle(), textAlign: 'left', paddingLeft: '0.6rem', minWidth: '3.5rem' }}>HOLE</th>
                {[1,2,3,4,5,6,7,8,9].map((n) => (
                  <th key={n} style={{ ...thStyle(), minWidth: '2.25rem' }}>{n}</th>
                ))}
                <th style={thStyle(true)}>Front</th>
                {[10,11,12,13,14,15,16,17,18].map((n) => (
                  <th key={n} style={{ ...thStyle(), minWidth: '2.25rem' }}>{n}</th>
                ))}
                <th style={thStyle(true)}>Back</th>
                <th style={thStyle()}>TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {/* PAR row */}
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ ...tdPar(false, true), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151' }}>PAR</td>
                {[1,2,3,4,5,6,7,8,9].map((n) => {
                  const hole = holes.find((h) => h.hole_number === n)
                  return <td key={n} style={tdPar(false, true)}>{hole?.par ?? '–'}</td>
                })}
                <td style={tdPar(true)}>{frontNine.length > 0 ? frontPar : '–'}</td>
                {[10,11,12,13,14,15,16,17,18].map((n) => {
                  const hole = holes.find((h) => h.hole_number === n)
                  return <td key={n} style={tdPar(false, true)}>{hole?.par ?? '–'}</td>
                })}
                <td style={tdPar(true)}>{backNine.length > 0 ? backPar : '–'}</td>
                <td style={{ ...tdPar(), fontWeight: 700, color: '#111827' }}>{totalPar}</td>
              </tr>
              {/* SCORE row */}
              <tr style={isDaytona ? { borderBottom: '1px solid #e5e7eb' } : {}}>
                <td style={{ ...tdScore(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151' }}>SCORE</td>
                {[1,2,3,4,5,6,7,8,9].map((n) => {
                  const hole = holes.find((h) => h.hole_number === n)
                  const strokes = scoreMap[n] ?? null
                  return (
                    <td key={n} style={tdScore()}>
                      {strokes != null && hole
                        ? <ScoreNotation strokes={strokes} par={hole.par} size="sm" />
                        : <span style={{ color: '#d1d5db' }}>–</span>}
                    </td>
                  )
                })}
                <td style={tdScore(true)}>
                  {frontScored.length > 0 ? frontScoredStrokes : '–'}
                </td>
                {[10,11,12,13,14,15,16,17,18].map((n) => {
                  const hole = holes.find((h) => h.hole_number === n)
                  const strokes = scoreMap[n] ?? null
                  return (
                    <td key={n} style={tdScore()}>
                      {strokes != null && hole
                        ? <ScoreNotation strokes={strokes} par={hole.par} size="sm" />
                        : <span style={{ color: '#d1d5db' }}>–</span>}
                    </td>
                  )
                })}
                <td style={tdScore(true)}>
                  {backScored.length > 0 ? backScoredStrokes : '–'}
                </td>
                <td style={{ ...tdScore(), fontWeight: 700, color: '#111827' }}>
                  {thru > 0 ? totalStrokes : '–'}
                </td>
              </tr>
              {/* PTS + AMT + TEAM rows — Daytona only */}
              {isDaytona && (() => {
                const pressedHoles = dtData?.pressedHoles ?? {}
                const dtPayoutValue = dtData?.dtPayoutValue ?? 0
                const hasPress = Object.keys(pressedHoles).length > 0
                const isFlares = daytonaVariant === '5man-flares'
                const sortedRates = [...new Set(Object.values(pressedHoles))].sort((a, b) => a - b)
                const pressColor = (val: number) => PRESS_COLORS[sortedRates.indexOf(val) % PRESS_COLORS.length]
                return (
                  <>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ ...tdScore(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151' }}>PTS</td>
                      {[1,2,3,4,5,6,7,8,9].map((n) => {
                        const pts = holePointsMap.has(n) ? holePointsMap.get(n)! : null
                        return <td key={n} style={tdScore()}><span style={{ fontWeight: 600, color: ptsColor(pts), fontSize: '0.7rem' }}>{ptsStr(pts)}</span></td>
                      })}
                      <td style={tdScore(true)}><span style={{ fontWeight: 700, color: ptsColor(frontPoints) }}>{ptsStr(frontPoints)}</span></td>
                      {[10,11,12,13,14,15,16,17,18].map((n) => {
                        const pts = holePointsMap.has(n) ? holePointsMap.get(n)! : null
                        return <td key={n} style={tdScore()}><span style={{ fontWeight: 600, color: ptsColor(pts), fontSize: '0.7rem' }}>{ptsStr(pts)}</span></td>
                      })}
                      <td style={tdScore(true)}><span style={{ fontWeight: 700, color: ptsColor(backPoints) }}>{ptsStr(backPoints)}</span></td>
                      <td style={{ ...tdScore(), fontWeight: 700, color: ptsColor(totalPoints) }}>{ptsStr(totalPoints)}</td>
                    </tr>
                    {(
                      <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ ...tdScore(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151' }}>AMT</td>
                        {[1,2,3,4,5,6,7,8,9].map((n) => {
                          if (!holePointsMap.has(n)) return <td key={n} style={tdScore()}><span style={{ color: '#d1d5db' }}>–</span></td>
                          const rate = pressedHoles[n] !== undefined ? pressedHoles[n] : dtPayoutValue
                          const color = pressedHoles[n] !== undefined ? pressColor(pressedHoles[n]) : '#9ca3af'
                          return <td key={n} style={tdScore()}><span style={{ fontWeight: 600, fontSize: '0.65rem', color }}>{fmtAmt(rate)}</span></td>
                        })}
                        <td style={tdScore(true)} />
                        {[10,11,12,13,14,15,16,17,18].map((n) => {
                          if (!holePointsMap.has(n)) return <td key={n} style={tdScore()}><span style={{ color: '#d1d5db' }}>–</span></td>
                          const rate = pressedHoles[n] !== undefined ? pressedHoles[n] : dtPayoutValue
                          const color = pressedHoles[n] !== undefined ? pressColor(pressedHoles[n]) : '#9ca3af'
                          return <td key={n} style={tdScore()}><span style={{ fontWeight: 600, fontSize: '0.65rem', color }}>{fmtAmt(rate)}</span></td>
                        })}
                        <td style={tdScore(true)} />
                        <td style={tdScore()} />
                      </tr>
                    )}
                    <tr>
                      <td style={{ ...tdScore(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151' }}>TEAM</td>
                      {[1,2,3,4,5,6,7,8,9].map((n) => {
                        const a = assignments.find((a) => a.player_id === player.id && a.hole_number === n)
                        const side = a?.side ?? null
                        const par = holes.find((h) => h.hole_number === n)?.par ?? 4
                        const leftChar = isFlares ? (par === 3 ? 'C' : 'O') : 'L'
                        const rightChar = isFlares ? (par === 3 ? 'F' : 'I') : 'R'
                        return (
                          <td key={n} style={tdScore()}>
                            {side != null
                              ? <span style={{ fontWeight: 700, fontSize: '0.7rem', color: side === 'left' ? '#2563eb' : '#92400e' }}>{side === 'left' ? leftChar : rightChar}</span>
                              : <span style={{ color: '#d1d5db' }}>–</span>}
                          </td>
                        )
                      })}
                      <td style={tdScore(true)} />
                      {[10,11,12,13,14,15,16,17,18].map((n) => {
                        const a = assignments.find((a) => a.player_id === player.id && a.hole_number === n)
                        const side = a?.side ?? null
                        const par = holes.find((h) => h.hole_number === n)?.par ?? 4
                        const leftChar = isFlares ? (par === 3 ? 'C' : 'O') : 'L'
                        const rightChar = isFlares ? (par === 3 ? 'F' : 'I') : 'R'
                        return (
                          <td key={n} style={tdScore()}>
                            {side != null
                              ? <span style={{ fontWeight: 700, fontSize: '0.7rem', color: side === 'left' ? '#2563eb' : '#92400e' }}>{side === 'left' ? leftChar : rightChar}</span>
                              : <span style={{ color: '#d1d5db' }}>–</span>}
                          </td>
                        )
                      })}
                      <td style={tdScore(true)} />
                      <td style={tdScore()} />
                    </tr>
                  </>
                )
              })()}
            </tbody>
          </table>
        </div>

        <div className="pb-8" />
      </div>
    </div>
  )
}
