'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { computeHoleBallScores, computeHoleDaytonaWithSides, type DaytonaHoleAssignment } from '@/lib/scoring'
import { ScoreNotation } from './ScoreNotation'

type Player = { id: string; name: string }
type Hole = { hole_number: number; par: number; stroke_index?: number | null }
type Score = { player_id: string; hole_number: number; strokes: number }

const navy = '#0f172a'
const gold = '#f59e0b'
const steelBlue = '#4a7fa5'
const PRESS_COLORS = [gold, '#3b82f6', '#8b5cf6', '#ef4444', '#10b981']

function fmtAmt(val: number): string {
  if (val === Math.floor(val)) return `$${val}`
  return `$${val.toFixed(2).replace(/^0/, '')}`
}
const steelBlueBg = '#dbeafe'
const BALL_LABELS = ['1B', '2B', '3B', '4B']

const thStyle = (highlight?: boolean): React.CSSProperties => ({
  background: highlight ? steelBlue : navy,
  color: 'white',
  fontWeight: 700,
  fontSize: '0.65rem',
  textAlign: 'center',
  padding: '0.4rem 0.25rem',
  whiteSpace: 'nowrap',
})
const tdPar = (highlight?: boolean, isHcp?: boolean): React.CSSProperties => ({
  background: highlight ? steelBlueBg : isHcp ? '#dde4ee' : 'white',
  color: highlight ? '#1e40af' : '#6b7280',
  fontWeight: highlight ? 700 : 400,
  fontSize: '0.7rem',
  textAlign: 'center',
  padding: '0.35rem 0.25rem',
})
const tdScore = (highlight?: boolean, isBall?: boolean): React.CSSProperties => ({
  background: highlight ? steelBlueBg : isBall ? '#fafafa' : 'white',
  fontWeight: highlight ? 700 : 400,
  color: highlight ? '#1e40af' : undefined,
  fontSize: '0.7rem',
  textAlign: 'center',
  padding: '0.25rem 0.2rem',
})

export default function ScorecardViewer({
  orgSlug, orgId, orgName, isMaster = false,
  teamName, players, holes, scores: initialScores, ballsCount, format = 'standard', daytonaVariant = '4man', dtAssignments = [], isAdmin = false, pressedHoles = {}, dtPayoutValue = 0, holeStrokes = {}, scorecardTeamId: scorecardTeamIdProp = null,
}: {
  orgSlug: string; orgId: string; orgName: string; isMaster?: boolean
  teamName: string
  players: Player[]
  holes: Hole[]
  scores: Score[]
  ballsCount: number
  format?: string
  daytonaVariant?: string
  dtAssignments?: DaytonaHoleAssignment[]
  isAdmin?: boolean
  pressedHoles?: Record<number, number>
  dtPayoutValue?: number
  holeStrokes?: Record<string, number[]>
  scorecardTeamId?: string | null
}) {
  const [scores, setScores] = useState(initialScores)
  const [scorecardTeamId] = useState<string | null>(scorecardTeamIdProp)
  const [showOptions, setShowOptions] = useState(false)
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false)

  async function handleSignOut() {
    await fetch('/api/org-logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId }) })
    window.location.href = isMaster ? '/master/dashboard' : '/'
  }
  const isDaytona = format === 'daytona'
  const isFlares = daytonaVariant === '5man-flares'
  const sortedPressRates = [...new Set(Object.values(pressedHoles))].sort((a, b) => a - b)
  const pressColor = (val: number) => PRESS_COLORS[sortedPressRates.indexOf(val) % PRESS_COLORS.length]
  const leftLabel = isFlares ? 'Outside' : 'Left'
  const rightLabel = isFlares ? 'Inside' : 'Right'

  useEffect(() => {
    const playerIds = players.map((p) => p.id)
    async function refetch() {
      const { data } = await supabase
        .from('scores').select('player_id, hole_number, strokes').in('player_id', playerIds)
      if (data) setScores(data)
    }
    const ch1 = supabase.channel('scorecard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, refetch)
      .subscribe()
    const ch2 = supabase.channel('scorecard-updates')
      .on('broadcast', { event: 'refresh' }, refetch)
      .subscribe()
    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2) }
  }, [players])

  // Pre-compute per-hole data (player scores + ball scores)
  const holeData = holes.map((hole) => {
    const playerScores = players.map((p) =>
      scores.find((s) => s.player_id === p.id && s.hole_number === hole.hole_number)?.strokes ?? null
    )
    const validScores = playerScores.filter((s): s is number => s !== null)
    const ballScores: (number | null)[] = !isDaytona && validScores.length > 0
      ? computeHoleBallScores(validScores, ballsCount)
      : Array(ballsCount).fill(null)

    let leftDt: number | null = null
    let rightDt: number | null = null
    if (isDaytona) {
      const holeAssignments = dtAssignments.filter((a) => a.hole_number === hole.hole_number)
      const leftIds = holeAssignments.filter((a) => a.side === 'left').map((a) => a.player_id)
      const rightIds = holeAssignments.filter((a) => a.side === 'right').map((a) => a.player_id)
      const leftScores = leftIds.map((id) => scores.find((s) => s.player_id === id && s.hole_number === hole.hole_number)?.strokes).filter((s): s is number => s !== undefined)
      const rightScores = rightIds.map((id) => scores.find((s) => s.player_id === id && s.hole_number === hole.hole_number)?.strokes).filter((s): s is number => s !== undefined)
      const dt = computeHoleDaytonaWithSides(leftScores, rightScores, hole.par)
      leftDt = dt.leftDt
      rightDt = dt.rightDt
    }

    return { hole, playerScores, ballScores, leftDt, rightDt }
  })

  const frontData = holeData.filter((d) => d.hole.hole_number <= 9)
  const backData = holeData.filter((d) => d.hole.hole_number >= 10)

  const frontPar = frontData.reduce((s, d) => s + d.hole.par, 0)
  const backPar = backData.reduce((s, d) => s + d.hole.par, 0)
  const totalPar = holes.reduce((s, h) => s + h.par, 0)

  function sumScored(data: typeof holeData, getValue: (d: typeof holeData[0]) => number | null): number | null {
    const played = data.filter((d) => getValue(d) != null)
    if (played.length === 0) return null
    return played.reduce((s, d) => s + getValue(d)!, 0)
  }

  const stickyFirst: React.CSSProperties = { position: 'sticky', left: 0, zIndex: 1 }
  const stickyFirstTh: React.CSSProperties = { position: 'sticky', left: 0, zIndex: 2 }

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
          {scorecardTeamId && (
            <a href={`/${orgSlug}/score/${scorecardTeamId}`} className="w-full text-center py-3 rounded-xl font-semibold text-sm border" style={{ borderColor: navy, color: navy }}>
              Enter Scores
            </a>
          )}
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
            <p className="text-xs uppercase tracking-wide" style={{ color: gold }}>Team Scorecard</p>
            <h1 className="font-bold text-lg">{teamName}</h1>
            {(isAdmin || scorecardTeamId) && (
              <div className="flex items-center gap-1.5 mt-1">
                {isAdmin && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full text-white" style={{ background: '#dc2626' }}>Admin</span>}
                {scorecardTeamId && <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#16a34a' }}>Scorer</span>}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-shrink-0">
            <button onClick={() => setShowOptions(true)}
              className="text-xs px-3 py-1.5 rounded-lg border font-medium text-white"
              style={{ borderColor: 'rgba(255,255,255,0.5)' }}>
              Options
            </button>
            <a href={`/${orgSlug}`} className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ background: gold, color: navy }}>Leaderboard</a>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-3 py-4">
        <div className="bg-white rounded-2xl overflow-hidden overflow-x-auto shadow-sm border border-gray-200">
        <table className="border-collapse" style={{ minWidth: '600px', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ ...thStyle(), textAlign: 'left', paddingLeft: '0.6rem', minWidth: '3.5rem', ...stickyFirstTh }}>HOLE</th>
              {[1,2,3,4,5,6,7,8,9].map((n) => (
                <th key={n} style={{ ...thStyle(), minWidth: '2.25rem' }}>
                  {n}
                  {isDaytona && pressedHoles[n] !== undefined && (
                    <span style={{ display: 'block', fontSize: '0.55rem', color: pressColor(pressedHoles[n]), lineHeight: 1, fontWeight: 800 }}>↑</span>
                  )}
                </th>
              ))}
              <th style={thStyle(true)}>Front</th>
              {[10,11,12,13,14,15,16,17,18].map((n) => (
                <th key={n} style={{ ...thStyle(), minWidth: '2.25rem' }}>
                  {n}
                  {isDaytona && pressedHoles[n] !== undefined && (
                    <span style={{ display: 'block', fontSize: '0.55rem', color: pressColor(pressedHoles[n]), lineHeight: 1, fontWeight: 800 }}>↑</span>
                  )}
                </th>
              ))}
              <th style={thStyle(true)}>Back</th>
              <th style={thStyle()}>TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {/* HCP row */}
            <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={{ ...tdPar(false, true), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>HCP</td>
              {[1,2,3,4,5,6,7,8,9].map((n) => {
                const d = holeData.find((d) => d.hole.hole_number === n)
                return <td key={n} style={tdPar(false, true)}>{d?.hole.stroke_index ?? '–'}</td>
              })}
              <td style={tdPar(true)} />
              {[10,11,12,13,14,15,16,17,18].map((n) => {
                const d = holeData.find((d) => d.hole.hole_number === n)
                return <td key={n} style={tdPar(false, true)}>{d?.hole.stroke_index ?? '–'}</td>
              })}
              <td style={tdPar(true)} /><td style={tdPar()} />
            </tr>
            {/* PAR row */}
            <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={{ ...tdPar(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>PAR</td>
              {[1,2,3,4,5,6,7,8,9].map((n) => {
                const d = holeData.find((d) => d.hole.hole_number === n)
                return <td key={n} style={tdPar()}>{d?.hole.par ?? '–'}</td>
              })}
              <td style={tdPar(true)}>{frontData.length > 0 ? frontPar : '–'}</td>
              {[10,11,12,13,14,15,16,17,18].map((n) => {
                const d = holeData.find((d) => d.hole.hole_number === n)
                return <td key={n} style={tdPar()}>{d?.hole.par ?? '–'}</td>
              })}
              <td style={tdPar(true)}>{backData.length > 0 ? backPar : '–'}</td>
              <td style={{ ...tdPar(), fontWeight: 700, color: '#111827' }}>{totalPar}</td>
            </tr>

            {/* One row per player */}
            {players.map((p, pi) => (
              <tr key={p.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ ...tdScore(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', whiteSpace: 'nowrap', ...stickyFirst }}>
                  <a href={`/player/${p.id}`} className="underline underline-offset-2" style={{ color: navy }}>
                    {p.name.split(' ')[0]}
                  </a>
                </td>
                {[1,2,3,4,5,6,7,8,9].map((n) => {
                  const d = holeData.find((d) => d.hole.hole_number === n)
                  const s = d?.playerScores[pi] ?? null
                  const hasStroke = isDaytona && !!(holeStrokes[p.id]?.includes(n))
                  return (
                    <td key={n} style={tdScore()}>
                      {s != null && d ? <span style={{ position: 'relative', display: 'inline-block' }}><ScoreNotation strokes={s} par={d.hole.par} size="sm" />{hasStroke && <span style={{ position: 'absolute', top: '50%', right: s - d.hole.par === 0 ? '-3px' : '-9px', transform: 'translateY(-50%)', color: '#16a34a', fontSize: '0.75rem', fontWeight: 700, lineHeight: 1 }}>*</span>}</span> : <span style={{ color: '#d1d5db' }}>–</span>}
                    </td>
                  )
                })}
                <td style={tdScore(true)}>
                  {sumScored(frontData, (d) => d.playerScores[pi]) ?? '–'}
                </td>
                {[10,11,12,13,14,15,16,17,18].map((n) => {
                  const d = holeData.find((d) => d.hole.hole_number === n)
                  const s = d?.playerScores[pi] ?? null
                  const hasStroke = isDaytona && !!(holeStrokes[p.id]?.includes(n))
                  return (
                    <td key={n} style={tdScore()}>
                      {s != null && d ? <span style={{ position: 'relative', display: 'inline-block' }}><ScoreNotation strokes={s} par={d.hole.par} size="sm" />{hasStroke && <span style={{ position: 'absolute', top: '50%', right: s - d.hole.par === 0 ? '-3px' : '-9px', transform: 'translateY(-50%)', color: '#16a34a', fontSize: '0.75rem', fontWeight: 700, lineHeight: 1 }}>*</span>}</span> : <span style={{ color: '#d1d5db' }}>–</span>}
                    </td>
                  )
                })}
                <td style={tdScore(true)}>
                  {sumScored(backData, (d) => d.playerScores[pi]) ?? '–'}
                </td>
                <td style={{ ...tdScore(), fontWeight: 700, color: '#111827' }}>
                  {sumScored(holeData, (d) => d.playerScores[pi]) ?? '–'}
                </td>
              </tr>
            ))}

            {/* Divider before ball / DT rows */}
            <tr><td colSpan={23} style={{ height: '2px', background: '#e5e7eb', padding: 0 }} /></tr>

            {/* Daytona rows OR ball rows */}
            {isDaytona ? (
              <>
                {(['left', 'right'] as const).map((side) => {

                  const label = side === 'left' ? leftLabel : rightLabel
                  const color = side === 'left' ? '#2563eb' : '#92400e'
                  const getDt = (d: typeof holeData[0]) => side === 'left' ? d.leftDt : d.rightDt
                  return (
                    <tr key={side}>
                      <td style={{ ...tdScore(false, true), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color, ...stickyFirst }}>
                        {label}
                      </td>
                      {[1,2,3,4,5,6,7,8,9].map((n) => {
                        const d = holeData.find((d) => d.hole.hole_number === n)
                        const val = d ? getDt(d) : null
                        return (
                          <td key={n} style={tdScore(false, true)}>
                            {val != null
                              ? <span style={{ fontWeight: 700, color: '#111827' }}>{val}</span>
                              : <span style={{ color: '#d1d5db' }}>–</span>}
                          </td>
                        )
                      })}
                      <td style={{ ...tdScore(true, true) }}>
                        {sumScored(frontData, getDt) ?? '–'}
                      </td>
                      {[10,11,12,13,14,15,16,17,18].map((n) => {
                        const d = holeData.find((d) => d.hole.hole_number === n)
                        const val = d ? getDt(d) : null
                        return (
                          <td key={n} style={tdScore(false, true)}>
                            {val != null
                              ? <span style={{ fontWeight: 700, color: '#111827' }}>{val}</span>
                              : <span style={{ color: '#d1d5db' }}>–</span>}
                          </td>
                        )
                      })}
                      <td style={{ ...tdScore(true, true) }}>
                        {sumScored(backData, getDt) ?? '–'}
                      </td>
                      <td style={{ ...tdScore(false, true), fontWeight: 700, color: '#111827' }}>
                        {sumScored(holeData, getDt) ?? '–'}
                      </td>
                    </tr>
                  )
                })}
                {Object.keys(pressedHoles).length > 0 && (() => {
                  const sortedRates = [...new Set(Object.values(pressedHoles))].sort((a, b) => a - b)
                  const pressColor = (val: number) => PRESS_COLORS[sortedRates.indexOf(val) % PRESS_COLORS.length]
                  return (
                    <tr>
                      <td style={{ ...tdScore(false, true), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>AMT</td>
                      {[1,2,3,4,5,6,7,8,9].map((n) => {
                        const rate = pressedHoles[n] !== undefined ? pressedHoles[n] : dtPayoutValue
                        const color = pressedHoles[n] !== undefined ? pressColor(pressedHoles[n]) : '#9ca3af'
                        return <td key={n} style={tdScore(false, true)}><span style={{ fontWeight: 600, fontSize: '0.65rem', color }}>{fmtAmt(rate)}</span></td>
                      })}
                      <td style={tdScore(true, true)} />
                      {[10,11,12,13,14,15,16,17,18].map((n) => {
                        const rate = pressedHoles[n] !== undefined ? pressedHoles[n] : dtPayoutValue
                        const color = pressedHoles[n] !== undefined ? pressColor(pressedHoles[n]) : '#9ca3af'
                        return <td key={n} style={tdScore(false, true)}><span style={{ fontWeight: 600, fontSize: '0.65rem', color }}>{fmtAmt(rate)}</span></td>
                      })}
                      <td style={tdScore(true, true)} />
                      <td style={tdScore(false, true)} />
                    </tr>
                  )
                })()}
              </>
            ) : (
              Array.from({ length: ballsCount }, (_, bi) => (
                <tr key={bi}>
                  <td style={{ ...tdScore(false, true), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#92400e', ...stickyFirst }}>
                    {BALL_LABELS[bi]}
                  </td>
                  {[1,2,3,4,5,6,7,8,9].map((n) => {
                    const d = holeData.find((d) => d.hole.hole_number === n)
                    const b = d?.ballScores[bi] ?? null
                    return (
                      <td key={n} style={tdScore(false, true)}>
                        {b != null && d ? <ScoreNotation strokes={b} par={d.hole.par} size="sm" /> : <span style={{ color: '#d1d5db' }}>–</span>}
                      </td>
                    )
                  })}
                  <td style={{ ...tdScore(true, true) }}>
                    {sumScored(frontData, (d) => d.ballScores[bi]) ?? '–'}
                  </td>
                  {[10,11,12,13,14,15,16,17,18].map((n) => {
                    const d = holeData.find((d) => d.hole.hole_number === n)
                    const b = d?.ballScores[bi] ?? null
                    return (
                      <td key={n} style={tdScore(false, true)}>
                        {b != null && d ? <ScoreNotation strokes={b} par={d.hole.par} size="sm" /> : <span style={{ color: '#d1d5db' }}>–</span>}
                      </td>
                    )
                  })}
                  <td style={{ ...tdScore(true, true) }}>
                    {sumScored(backData, (d) => d.ballScores[bi]) ?? '–'}
                  </td>
                  <td style={{ ...tdScore(false, true), fontWeight: 700, color: '#111827' }}>
                    {sumScored(holeData, (d) => d.ballScores[bi]) ?? '–'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>

        <div className="pb-8" />
      </div>
    </div>
  )
}
