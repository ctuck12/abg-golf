'use client'

import { ScoreNotation } from './ScoreNotation'
import {
  computeHoleDaytonaWithSides,
  computeHoleDaytonaPointsFiveMan,
} from '@/lib/scoring'

const navy = '#0f172a'
const gold = '#f59e0b'
const steelBlue = '#4a7fa5'
const holeBg = '#dde4ee'
const PRESS_COLORS = [gold, '#3b82f6', '#8b5cf6', '#ef4444', '#10b981']

type Hole = { hole_number: number; par: number; stroke_index?: number | null }
type Score = { player_id: string; hole_number: number; strokes: number }
type Player = { id: string; name: string }

// shared style helpers
const thSt = (highlight?: boolean, isHoleNum?: boolean): React.CSSProperties => ({
  background: highlight ? steelBlue : isHoleNum ? holeBg : navy,
  color: highlight ? 'white' : isHoleNum ? navy : 'white',
  fontWeight: 700, fontSize: '0.65rem', textAlign: 'center', padding: '0.4rem 0.25rem', whiteSpace: 'nowrap',
})
const tdPar = (highlight?: boolean): React.CSSProperties => ({
  background: highlight ? '#dbeafe' : 'white',
  color: highlight ? '#1e40af' : '#6b7280',
  fontWeight: highlight ? 700 : 400, fontSize: '0.7rem', textAlign: 'center', padding: '0.35rem 0.25rem',
})
const tdSc = (highlight?: boolean): React.CSSProperties => ({
  background: highlight ? '#dbeafe' : 'white',
  fontWeight: highlight ? 700 : 400,
  color: highlight ? '#1e40af' : undefined,
  fontSize: '0.7rem', textAlign: 'center', padding: '0.25rem 0.2rem',
})
const stickyFirst: React.CSSProperties = { position: 'sticky', left: 0, zIndex: 1 }
const stickyFirstTh: React.CSSProperties = { position: 'sticky', left: 0, zIndex: 2 }

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
function fmtAmt(val: number): string {
  return val === Math.floor(val) ? `$${val}` : `$${val.toFixed(2)}`
}

export default function ScorecardBottomSheet({
  title, players, holes, scores, onClose,
  isDaytonaMode = false,
  assignments = {},
  holeStrokes = {},
  holeValues = {},
  dtPayoutValue = 0,
  is5Man = false,
  isFlares = false,
}: {
  title: string
  players: Player[]
  holes: Hole[]
  scores: Score[]
  onClose: () => void
  isDaytonaMode?: boolean
  assignments?: Record<number, Record<string, 'left' | 'right'>>
  holeStrokes?: Record<number, string[]>
  holeValues?: Record<number, number>
  dtPayoutValue?: number
  is5Man?: boolean
  isFlares?: boolean
}) {
  const frontNine = holes.filter((h) => h.hole_number <= 9)
  const backNine = holes.filter((h) => h.hole_number > 9)
  const frontPar = frontNine.reduce((s, h) => s + h.par, 0)
  const backPar = backNine.reduce((s, h) => s + h.par, 0)
  const totalPar = frontPar + backPar

  // ── Daytona points computation ─────────────────────────────────────────────
  const holePtsMaps = new Map<number, Map<string, number>>()
  if (isDaytonaMode) {
    for (const hole of holes) {
      const holeAssign = assignments[hole.hole_number] ?? {}
      const leftIds = Object.entries(holeAssign).filter(([, s]) => s === 'left').map(([id]) => id)
      const rightIds = Object.entries(holeAssign).filter(([, s]) => s === 'right').map(([id]) => id)
      const strokeIds = holeStrokes[hole.hole_number] ?? []
      const netScores = scores.map((s) => ({
        ...s, strokes: s.strokes - (strokeIds.includes(s.player_id) && s.hole_number === hole.hole_number ? 1 : 0),
      }))
      if (is5Man) {
        if (leftIds.length >= 2 && rightIds.length >= 3)
          holePtsMaps.set(hole.hole_number, computeHoleDaytonaPointsFiveMan(leftIds, rightIds, netScores, hole.hole_number, hole.par))
      } else {
        if (leftIds.length >= 2 && rightIds.length >= 2) {
          const leftSc = leftIds.map((id) => netScores.find((s) => s.player_id === id && s.hole_number === hole.hole_number)?.strokes).filter((s): s is number => s !== undefined)
          const rightSc = rightIds.map((id) => netScores.find((s) => s.player_id === id && s.hole_number === hole.hole_number)?.strokes).filter((s): s is number => s !== undefined)
          if (leftSc.length >= 2 && rightSc.length >= 2) {
            const { leftDt, rightDt } = computeHoleDaytonaWithSides(leftSc, rightSc, hole.par)
            if (leftDt !== null && rightDt !== null) {
              const diff = Math.abs(leftDt - rightDt)
              const lWins = leftDt < rightDt, rWins = rightDt < leftDt
              const m = new Map<string, number>()
              for (const id of leftIds) m.set(id, lWins ? diff : rWins ? -diff : 0)
              for (const id of rightIds) m.set(id, rWins ? diff : lWins ? -diff : 0)
              holePtsMaps.set(hole.hole_number, m)
            }
          }
        }
      }
    }
  }

  const totalPtsMap = new Map<string, number>()
  for (const [, m] of holePtsMaps) {
    for (const [pid, pts] of m) totalPtsMap.set(pid, (totalPtsMap.get(pid) ?? 0) + pts)
  }

  const sortedPressRates = [...new Set(Object.values(holeValues))].sort((a, b) => a - b)
  const pressColor = (val: number) => PRESS_COLORS[sortedPressRates.indexOf(val) % PRESS_COLORS.length]

  // Rank by Daytona pts when in Daytona mode, otherwise leave original order
  const rankedPlayers = isDaytonaMode
    ? [...players].sort((a, b) => {
        const aThru = scores.filter((s) => s.player_id === a.id).length
        const bThru = scores.filter((s) => s.player_id === b.id).length
        if (aThru === 0 && bThru === 0) return a.name.localeCompare(b.name)
        if (aThru === 0) return 1
        if (bThru === 0) return -1
        return (totalPtsMap.get(b.id) ?? 0) - (totalPtsMap.get(a.id) ?? 0)
      })
    : players

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col justify-end"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h3 className="font-bold text-gray-900 text-base">{title}</h3>
          <button onClick={onClose} className="text-gray-400 text-xl font-bold leading-none">×</button>
        </div>
        <div className="px-4 py-4 space-y-4">
          {rankedPlayers.map((player, rank) => {
            const scoreMap = Object.fromEntries(
              scores.filter((s) => s.player_id === player.id).map((s) => [s.hole_number, s.strokes])
            )
            const frontScored = frontNine.filter((h) => scoreMap[h.hole_number] != null)
            const backScored = backNine.filter((h) => scoreMap[h.hole_number] != null)
            const frontStrokes = frontScored.reduce((s, h) => s + scoreMap[h.hole_number]!, 0)
            const backStrokes = backScored.reduce((s, h) => s + scoreMap[h.hole_number]!, 0)
            const totalStrokes = frontStrokes + backStrokes
            const thru = frontScored.length + backScored.length
            const allScored = holes.filter((h) => scoreMap[h.hole_number] != null)
            const vspar = allScored.length > 0
              ? allScored.reduce((s, h) => s + scoreMap[h.hole_number]! - h.par, 0)
              : null
            const vpStr = vspar === null ? '–' : vspar === 0 ? 'E' : vspar > 0 ? `+${vspar}` : `${vspar}`

            const totalPoints = totalPtsMap.has(player.id) ? totalPtsMap.get(player.id)! : null
            const frontPtsHoles = frontNine.filter((h) => holePtsMaps.get(h.hole_number)?.has(player.id))
            const frontPoints = frontPtsHoles.length > 0
              ? frontPtsHoles.reduce((s, h) => s + (holePtsMaps.get(h.hole_number)?.get(player.id) ?? 0), 0)
              : null
            const backPtsHoles = backNine.filter((h) => holePtsMaps.get(h.hole_number)?.has(player.id))
            const backPoints = backPtsHoles.length > 0
              ? backPtsHoles.reduce((s, h) => s + (holePtsMaps.get(h.hole_number)?.get(player.id) ?? 0), 0)
              : null

            return (
              <div key={player.id} className="rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-1.5" style={{ background: navy }}>
                  {isDaytonaMode && (
                    <span className="text-base font-bold w-8 flex-shrink-0"
                      style={{ color: thru > 0 ? gold : 'rgba(255,255,255,0.25)' }}>
                      {thru > 0 ? `#${rank + 1}` : '–'}
                    </span>
                  )}
                  <span className="font-bold text-white text-sm flex-1">{player.name}</span>
                  <span className="text-xs font-bold" style={{
                    color: vspar !== null && vspar < 0 ? '#f87171'
                      : vspar !== null && vspar > 0 ? '#fbbf24'
                      : 'rgba(255,255,255,0.7)',
                  }}>{vpStr}</span>
                </div>
                <div className="overflow-x-auto bg-white">
                  <table className="border-collapse" style={{ minWidth: '560px', width: '100%' }}>
                    <thead style={{ borderTop: '1px solid #e5e7eb' }}>
                      <tr>
                        <th style={{ ...thSt(false, true), textAlign: 'left', paddingLeft: '0.6rem', minWidth: '3.5rem', ...stickyFirstTh }}>HOLE</th>
                        {frontNine.map((h) => <th key={h.hole_number} style={{ ...thSt(false, true), minWidth: '2rem' }}>{h.hole_number}</th>)}
                        {frontNine.length > 0 && <th style={thSt(true)}>Out</th>}
                        {backNine.map((h) => <th key={h.hole_number} style={{ ...thSt(false, true), minWidth: '2rem' }}>{h.hole_number}</th>)}
                        {backNine.length > 0 && <th style={thSt(true)}>In</th>}
                        <th style={thSt()}>TOT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* HCP */}
                      <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ ...tdPar(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>HCP</td>
                        {frontNine.map((h) => <td key={h.hole_number} style={tdPar()}>{h.stroke_index ?? '–'}</td>)}
                        {frontNine.length > 0 && <td style={tdPar(true)} />}
                        {backNine.map((h) => <td key={h.hole_number} style={tdPar()}>{h.stroke_index ?? '–'}</td>)}
                        {backNine.length > 0 && <td style={tdPar(true)} />}
                        <td style={tdPar()} />
                      </tr>
                      {/* PAR */}
                      <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ ...tdPar(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>PAR</td>
                        {frontNine.map((h) => <td key={h.hole_number} style={tdPar()}>{h.par}</td>)}
                        {frontNine.length > 0 && <td style={tdPar(true)}>{frontPar}</td>}
                        {backNine.map((h) => <td key={h.hole_number} style={tdPar()}>{h.par}</td>)}
                        {backNine.length > 0 && <td style={tdPar(true)}>{backPar}</td>}
                        <td style={{ ...tdPar(), fontWeight: 700, color: '#111827' }}>{totalPar}</td>
                      </tr>
                      {/* SCORE */}
                      <tr style={{ borderBottom: isDaytonaMode ? '1px solid #e5e7eb' : undefined }}>
                        <td style={{ ...tdSc(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>SCORE</td>
                        {frontNine.map((h) => {
                          const s = scoreMap[h.hole_number] ?? null
                          const hasStroke = (holeStrokes[h.hole_number] ?? []).includes(player.id)
                          return (
                            <td key={h.hole_number} style={tdSc()}>
                              {s != null
                                ? <span style={{ position: 'relative', display: 'inline-block' }}>
                                    <ScoreNotation strokes={s} par={h.par} size="sm" />
                                    {hasStroke && <span style={{ position: 'absolute', top: '50%', right: s - h.par === 0 ? '-3px' : '-9px', transform: 'translateY(-50%)', color: '#16a34a', fontSize: '0.75rem', fontWeight: 700, lineHeight: 1 }}>*</span>}
                                  </span>
                                : <span style={{ color: '#d1d5db' }}>–</span>}
                            </td>
                          )
                        })}
                        {frontNine.length > 0 && <td style={tdSc(true)}>{frontScored.length > 0 ? frontStrokes : '–'}</td>}
                        {backNine.map((h) => {
                          const s = scoreMap[h.hole_number] ?? null
                          const hasStroke = (holeStrokes[h.hole_number] ?? []).includes(player.id)
                          return (
                            <td key={h.hole_number} style={tdSc()}>
                              {s != null
                                ? <span style={{ position: 'relative', display: 'inline-block' }}>
                                    <ScoreNotation strokes={s} par={h.par} size="sm" />
                                    {hasStroke && <span style={{ position: 'absolute', top: '50%', right: s - h.par === 0 ? '-3px' : '-9px', transform: 'translateY(-50%)', color: '#16a34a', fontSize: '0.75rem', fontWeight: 700, lineHeight: 1 }}>*</span>}
                                  </span>
                                : <span style={{ color: '#d1d5db' }}>–</span>}
                            </td>
                          )
                        })}
                        {backNine.length > 0 && <td style={tdSc(true)}>{backScored.length > 0 ? backStrokes : '–'}</td>}
                        <td style={{ ...tdSc(), fontWeight: 700, color: '#111827' }}>{thru > 0 ? totalStrokes : '–'}</td>
                      </tr>
                      {/* PTS + AMT + TEAM — Daytona only */}
                      {isDaytonaMode && <>
                        <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                          <td style={{ ...tdSc(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>PTS</td>
                          {frontNine.map((h) => {
                            const pts = holePtsMaps.get(h.hole_number)?.has(player.id) ? holePtsMaps.get(h.hole_number)!.get(player.id)! : null
                            return <td key={h.hole_number} style={tdSc()}><span style={{ fontWeight: 600, color: ptsColor(pts), fontSize: '0.7rem' }}>{ptsStr(pts)}</span></td>
                          })}
                          <td style={tdSc(true)}><span style={{ fontWeight: 700, color: ptsColor(frontPoints) }}>{ptsStr(frontPoints)}</span></td>
                          {backNine.map((h) => {
                            const pts = holePtsMaps.get(h.hole_number)?.has(player.id) ? holePtsMaps.get(h.hole_number)!.get(player.id)! : null
                            return <td key={h.hole_number} style={tdSc()}><span style={{ fontWeight: 600, color: ptsColor(pts), fontSize: '0.7rem' }}>{ptsStr(pts)}</span></td>
                          })}
                          <td style={tdSc(true)}><span style={{ fontWeight: 700, color: ptsColor(backPoints) }}>{ptsStr(backPoints)}</span></td>
                          <td style={{ ...tdSc(), fontWeight: 700, color: ptsColor(totalPoints) }}>{ptsStr(totalPoints)}</td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                          <td style={{ ...tdSc(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>AMT</td>
                          {frontNine.map((h) => {
                            const scored = scoreMap[h.hole_number] != null
                            const rate = holeValues[h.hole_number] !== undefined ? holeValues[h.hole_number] : dtPayoutValue
                            const color = holeValues[h.hole_number] !== undefined ? pressColor(holeValues[h.hole_number]) : '#9ca3af'
                            return <td key={h.hole_number} style={tdSc()}>{scored ? <span style={{ fontWeight: 600, fontSize: '0.65rem', color }}>{fmtAmt(rate)}</span> : <span style={{ color: '#d1d5db' }}>–</span>}</td>
                          })}
                          <td style={tdSc(true)} />
                          {backNine.map((h) => {
                            const scored = scoreMap[h.hole_number] != null
                            const rate = holeValues[h.hole_number] !== undefined ? holeValues[h.hole_number] : dtPayoutValue
                            const color = holeValues[h.hole_number] !== undefined ? pressColor(holeValues[h.hole_number]) : '#9ca3af'
                            return <td key={h.hole_number} style={tdSc()}>{scored ? <span style={{ fontWeight: 600, fontSize: '0.65rem', color }}>{fmtAmt(rate)}</span> : <span style={{ color: '#d1d5db' }}>–</span>}</td>
                          })}
                          <td style={tdSc(true)} /><td style={tdSc()} />
                        </tr>
                        <tr>
                          <td style={{ ...tdSc(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>TEAM</td>
                          {frontNine.map((h) => {
                            const side = assignments[h.hole_number]?.[player.id] ?? null
                            const leftChar = isFlares ? (h.par === 3 ? 'C' : 'O') : 'L'
                            const rightChar = isFlares ? (h.par === 3 ? 'F' : 'I') : 'R'
                            return (
                              <td key={h.hole_number} style={tdSc()}>
                                {side != null
                                  ? <span style={{ fontWeight: 700, fontSize: '0.7rem', color: side === 'left' ? '#2563eb' : '#92400e' }}>{side === 'left' ? leftChar : rightChar}</span>
                                  : <span style={{ color: '#d1d5db' }}>–</span>}
                              </td>
                            )
                          })}
                          <td style={tdSc(true)} />
                          {backNine.map((h) => {
                            const side = assignments[h.hole_number]?.[player.id] ?? null
                            const leftChar = isFlares ? (h.par === 3 ? 'C' : 'O') : 'L'
                            const rightChar = isFlares ? (h.par === 3 ? 'F' : 'I') : 'R'
                            return (
                              <td key={h.hole_number} style={tdSc()}>
                                {side != null
                                  ? <span style={{ fontWeight: 700, fontSize: '0.7rem', color: side === 'left' ? '#2563eb' : '#92400e' }}>{side === 'left' ? leftChar : rightChar}</span>
                                  : <span style={{ color: '#d1d5db' }}>–</span>}
                              </td>
                            )
                          })}
                          <td style={tdSc(true)} /><td style={tdSc()} />
                        </tr>
                      </>}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
