'use client'

import { useState } from 'react'
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
type Player = { id: string; name: string; handicap?: number | null }

// shared style helpers
const thSt = (highlight?: boolean, isHoleNum?: boolean): React.CSSProperties => ({
  background: highlight ? steelBlue : isHoleNum ? holeBg : navy,
  color: highlight ? 'white' : isHoleNum ? navy : 'white',
  fontWeight: 700, fontSize: '0.65rem', textAlign: 'center', padding: '0.5rem 0.45rem', whiteSpace: 'nowrap',
})
const tdPar = (highlight?: boolean): React.CSSProperties => ({
  background: highlight ? '#dbeafe' : 'white',
  color: highlight ? '#1e40af' : '#6b7280',
  fontWeight: highlight ? 700 : 400, fontSize: '0.7rem', textAlign: 'center', padding: '0.45rem 0.45rem',
})
const tdSc = (highlight?: boolean): React.CSSProperties => ({
  background: highlight ? '#dbeafe' : 'white',
  fontWeight: highlight ? 700 : 400,
  color: highlight ? '#1e40af' : undefined,
  fontSize: '0.7rem', textAlign: 'center', padding: '0.42rem 0.42rem',
})
const stickyFirst: React.CSSProperties = { position: 'sticky', left: 0, zIndex: 1 }
const stickyFirstTh: React.CSSProperties = { position: 'sticky', left: 0, zIndex: 2 }

function bankerMult(net: number, par: number): number {
  if (net <= par - 2) return 3
  if (net === par - 1) return 2
  return 1
}
function fmtBankerCell(amt: number | null): React.ReactNode {
  if (amt === null) return <span style={{ color: '#d1d5db' }}>–</span>
  if (amt === 0) return <span style={{ color: '#6b7280', fontSize: '0.65rem' }}>$0</span>
  return <span style={{ fontWeight: 600, fontSize: '0.65rem', color: amt > 0 ? '#16a34a' : '#dc2626', whiteSpace: 'nowrap' }}>${Math.round(Math.abs(amt))}</span>
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
function fmtAmt(val: number): string {
  return val === Math.floor(val) ? `$${val}` : `$${val.toFixed(2).replace(/^0/, '')}`
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

export default function ScorecardBottomSheet({
  title, players, holes, scores, onClose,
  isDaytonaMode = false,
  assignments = {},
  holeStrokes = {},
  holeValues = {},
  dtPayoutValue = 0,
  is5Man = false,
  isFlares = false,
  isBankerMode = false,
  bankerHoles = {},
  bankerBets = {},
  bankerMinBet = 2,
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
  isBankerMode?: boolean
  bankerHoles?: Record<number, { bankerPlayerId: string | null }>
  bankerBets?: Record<number, Record<string, { baseBet: number; playerDoubled: boolean; bankerDoubled: boolean }>>
  bankerMinBet?: number
}) {
  const [hcpVisible, setHcpVisible] = useState<Set<string>>(new Set())
  const toggleHcp = (id: string) => setHcpVisible((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })

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

  // ── Banker per-hole amounts ─────────────────────────────────────────────────
  const holeBankerAmts = new Map<number, Map<string, number>>()
  const totalBankerAmts = new Map<string, number>()
  if (isBankerMode) {
    for (const hole of holes) {
      const hd = bankerHoles[hole.hole_number]
      if (!hd?.bankerPlayerId) continue
      const bankerId = hd.bankerPlayerId
      const strokeIds = holeStrokes[hole.hole_number] ?? []
      const netOf = (pid: string) => {
        const gross = scores.find((s) => s.player_id === pid && s.hole_number === hole.hole_number)?.strokes
        return gross === undefined ? undefined : gross - (strokeIds.includes(pid) ? 1 : 0)
      }
      const bankerNet = netOf(bankerId)
      if (bankerNet === undefined) continue
      const holeAmts = new Map<string, number>()
      let bankerTotal = 0
      for (const p of players) {
        if (p.id === bankerId) continue
        const pNet = netOf(p.id)
        if (pNet === undefined) continue
        const bet = bankerBets[hole.hole_number]?.[p.id] ?? { baseBet: bankerMinBet, playerDoubled: false, bankerDoubled: false }
        const eff = bet.baseBet * (bet.playerDoubled ? 2 : 1) * (bet.bankerDoubled ? 2 : 1)
        let result = 0
        if (pNet < bankerNet) result = eff * bankerMult(pNet, hole.par)
        else if (pNet > bankerNet) result = -eff * bankerMult(bankerNet, hole.par)
        holeAmts.set(p.id, result)
        bankerTotal -= result
      }
      holeAmts.set(bankerId, bankerTotal)
      holeBankerAmts.set(hole.hole_number, holeAmts)
      for (const [pid, amt] of holeAmts) totalBankerAmts.set(pid, (totalBankerAmts.get(pid) ?? 0) + amt)
    }
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
    : isBankerMode && totalBankerAmts.size > 0
      ? [...players].sort((a, b) => (totalBankerAmts.get(b.id) ?? 0) - (totalBankerAmts.get(a.id) ?? 0))
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
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="font-bold text-gray-900 text-base flex-shrink-0">{title}</h3>
            {isDaytonaMode && dtPayoutValue > 0 && (
              <span className="text-xs text-gray-400 flex-shrink-0">{isFlares ? '5-Man Flares' : is5Man ? '5-Man Daytona' : 'Daytona'} – {fmtAmt(dtPayoutValue)}/point</span>
            )}
            {isBankerMode && (
              <span className="text-xs text-gray-400 flex-shrink-0">Banker – ${bankerMinBet} min. bet</span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 text-xl font-bold leading-none ml-2">×</button>
        </div>
        <div className="px-4 py-4 space-y-3">
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
            const frontVspar = frontScored.length > 0
              ? frontScored.reduce((s, h) => s + scoreMap[h.hole_number]! - h.par, 0)
              : null
            const backVspar = backScored.length > 0
              ? backScored.reduce((s, h) => s + scoreMap[h.hole_number]! - h.par, 0)
              : null
            const vspar = frontVspar !== null || backVspar !== null
              ? (frontVspar ?? 0) + (backVspar ?? 0)
              : null
            const fmtVsp = (n: number | null) => n === null ? '–' : n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`
            const vpColor = (n: number | null) => n === null ? 'rgba(255,255,255,0.55)'
              : n < 0 ? '#f87171' : n > 0 ? '#fbbf24' : 'rgba(255,255,255,0.8)'

            const totalPoints = totalPtsMap.has(player.id) ? totalPtsMap.get(player.id)! : null
            const frontPtsHoles = frontNine.filter((h) => holePtsMaps.get(h.hole_number)?.has(player.id))
            const frontPoints = frontPtsHoles.length > 0
              ? frontPtsHoles.reduce((s, h) => s + (holePtsMaps.get(h.hole_number)?.get(player.id) ?? 0), 0)
              : null
            const backPtsHoles = backNine.filter((h) => holePtsMaps.get(h.hole_number)?.has(player.id))
            const backPoints = backPtsHoles.length > 0
              ? backPtsHoles.reduce((s, h) => s + (holePtsMaps.get(h.hole_number)?.get(player.id) ?? 0), 0)
              : null

            const playerBankerTotal = totalBankerAmts.get(player.id) ?? null
            const frontBankerTotal = (() => {
              const played = frontNine.filter((h) => holeBankerAmts.get(h.hole_number)?.has(player.id))
              return played.length > 0 ? played.reduce((s, h) => s + (holeBankerAmts.get(h.hole_number)!.get(player.id) ?? 0), 0) : null
            })()
            const backBankerTotal = (() => {
              const played = backNine.filter((h) => holeBankerAmts.get(h.hole_number)?.has(player.id))
              return played.length > 0 ? played.reduce((s, h) => s + (holeBankerAmts.get(h.hole_number)!.get(player.id) ?? 0), 0) : null
            })()

            return (
              <div key={player.id} className="rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-2" style={{ background: navy }}>
                  {(isDaytonaMode || (isBankerMode && totalBankerAmts.size > 0)) && (
                    <span className="text-base font-bold w-8 flex-shrink-0"
                      style={{ color: thru > 0 ? gold : 'rgba(255,255,255,0.25)' }}>
                      {thru > 0 ? `#${rank + 1}` : '–'}
                    </span>
                  )}
                  <span className="font-bold text-white text-sm">{player.name}</span>
                  <span className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => toggleHcp(player.id)} className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: hcpVisible.has(player.id) ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.07)', color: hcpVisible.has(player.id) ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.15)' }}>HCP</button>
                    {player.handicap != null && <span className="text-[10px] font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>{player.handicap < 0 ? `+${Math.abs(player.handicap)}` : player.handicap}</span>}
                  </span>
                  <span className="flex-1" />
                  <div className="flex items-center gap-3 text-[10px] font-semibold flex-shrink-0" style={{ color: 'rgba(255,255,255,0.55)' }}>
                    <span>Front: <span style={{ color: vpColor(frontVspar) }}>{fmtVsp(frontVspar)}</span></span>
                    <span>Back: <span style={{ color: vpColor(backVspar) }}>{fmtVsp(backVspar)}</span></span>
                    <span>Total: <span style={{ color: vpColor(vspar) }}>{fmtVsp(vspar)}</span></span>
                  </div>
                </div>
                <div className="overflow-x-auto bg-white">
                  <table className="border-collapse" style={{ minWidth: '600px', width: '100%', tableLayout: 'fixed' }}>
                    <thead style={{ borderTop: '1px solid #e5e7eb' }}>
                      <tr>
                        <th style={{ ...thSt(false, true), textAlign: 'left', paddingLeft: '0.6rem', width: '3.5rem', ...stickyFirstTh }}>HOLE</th>
                        {frontNine.map((h) => {
                          const hasStroke = (holeStrokes[h.hole_number] ?? []).includes(player.id)
                          return (
                            <th key={h.hole_number} style={{ ...thSt(false, true), width: '2rem' }}>
                              <span style={{ position: 'relative', display: 'inline-block' }}>{h.hole_number}{hasStroke && <span style={{ position: 'absolute', top: '50%', left: '100%', transform: 'translateY(-50%)', color: '#16a34a', fontSize: '0.75rem', fontWeight: 700, lineHeight: 1, marginLeft: '1px' }}>*</span>}</span>
                            </th>
                          )
                        })}
                        {frontNine.length > 0 && <th style={{ ...thSt(true), width: '2.8rem' }}>Out</th>}
                        {backNine.map((h) => {
                          const hasStroke = (holeStrokes[h.hole_number] ?? []).includes(player.id)
                          return (
                            <th key={h.hole_number} style={{ ...thSt(false, true), width: '2rem' }}>
                              <span style={{ position: 'relative', display: 'inline-block' }}>{h.hole_number}{hasStroke && <span style={{ position: 'absolute', top: '50%', left: '100%', transform: 'translateY(-50%)', color: '#16a34a', fontSize: '0.75rem', fontWeight: 700, lineHeight: 1, marginLeft: '1px' }}>*</span>}</span>
                            </th>
                          )
                        })}
                        {backNine.length > 0 && <th style={{ ...thSt(true), width: '2.8rem' }}>In</th>}
                        <th style={{ ...thSt(), width: '2.8rem' }}>TOT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* HCP — hidden by default, toggled per player */}
                      {hcpVisible.has(player.id) && (
                        <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                          <td style={{ ...tdPar(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>HCP</td>
                          {frontNine.map((h) => <td key={h.hole_number} style={tdPar()}>{h.stroke_index ?? '–'}</td>)}
                          {frontNine.length > 0 && <td style={tdPar(true)} />}
                          {backNine.map((h) => <td key={h.hole_number} style={tdPar()}>{h.stroke_index ?? '–'}</td>)}
                          {backNine.length > 0 && <td style={tdPar(true)} />}
                          <td style={tdPar()} />
                        </tr>
                      )}
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
                          return (
                            <td key={h.hole_number} style={tdSc()}>
                              {s != null ? <ScoreNotation strokes={s} par={h.par} size="sm" /> : <span style={{ color: '#d1d5db' }}>–</span>}
                            </td>
                          )
                        })}
                        {frontNine.length > 0 && <td style={tdSc(true)}>{frontScored.length > 0 ? frontStrokes : '–'}</td>}
                        {backNine.map((h) => {
                          const s = scoreMap[h.hole_number] ?? null
                          return (
                            <td key={h.hole_number} style={tdSc()}>
                              {s != null ? <ScoreNotation strokes={s} par={h.par} size="sm" /> : <span style={{ color: '#d1d5db' }}>–</span>}
                            </td>
                          )
                        })}
                        {backNine.length > 0 && <td style={tdSc(true)}>{backScored.length > 0 ? backStrokes : '–'}</td>}
                        <td style={{ ...tdSc(), fontWeight: 700, color: '#111827' }}>{thru > 0 ? totalStrokes : '–'}</td>
                      </tr>
                      {/* AMT + BKR — Banker only */}
                      {isBankerMode && <>
                        <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                          <td style={{ ...tdSc(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>AMT</td>
                          {frontNine.map((h) => (
                            <td key={h.hole_number} style={tdSc()}>
                              {fmtBankerCell(holeBankerAmts.has(h.hole_number) ? (holeBankerAmts.get(h.hole_number)!.get(player.id) ?? 0) : null)}
                            </td>
                          ))}
                          <td style={tdSc(true)}>{fmtBankerCell(frontBankerTotal)}</td>
                          {backNine.map((h) => (
                            <td key={h.hole_number} style={tdSc()}>
                              {fmtBankerCell(holeBankerAmts.has(h.hole_number) ? (holeBankerAmts.get(h.hole_number)!.get(player.id) ?? 0) : null)}
                            </td>
                          ))}
                          {backNine.length > 0 && <td style={tdSc(true)}>{fmtBankerCell(backBankerTotal)}</td>}
                          <td style={tdSc()}>{fmtBankerCell(playerBankerTotal)}</td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                          <td style={{ ...tdSc(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>BKR</td>
                          {frontNine.map((h) => (
                            <td key={h.hole_number} style={tdSc()}>
                              {bankerHoles[h.hole_number]?.bankerPlayerId === player.id
                                ? <span style={{ fontSize: '0.75rem' }}>🏦</span>
                                : <span style={{ color: '#d1d5db' }}>–</span>}
                            </td>
                          ))}
                          {(() => { const n = frontNine.filter(h => bankerHoles[h.hole_number]?.bankerPlayerId === player.id).length; return <td style={tdSc(true)}>{n > 0 ? <span style={{ fontWeight: 700, color: '#374151', fontSize: '0.7rem' }}>{n}</span> : null}</td> })()}
                          {backNine.map((h) => (
                            <td key={h.hole_number} style={tdSc()}>
                              {bankerHoles[h.hole_number]?.bankerPlayerId === player.id
                                ? <span style={{ fontSize: '0.75rem' }}>🏦</span>
                                : <span style={{ color: '#d1d5db' }}>–</span>}
                            </td>
                          ))}
                          {backNine.length > 0 && (() => { const n = backNine.filter(h => bankerHoles[h.hole_number]?.bankerPlayerId === player.id).length; return <td style={tdSc(true)}>{n > 0 ? <span style={{ fontWeight: 700, color: '#374151', fontSize: '0.7rem' }}>{n}</span> : null}</td> })()}
                          {(() => { const n = [...frontNine, ...backNine].filter(h => bankerHoles[h.hole_number]?.bankerPlayerId === player.id).length; return <td style={tdSc()}>{n > 0 ? <span style={{ fontWeight: 700, color: '#374151', fontSize: '0.7rem' }}>{n}</span> : null}</td> })()}
                        </tr>
                      </>}
                      {/* PTS + AMT + TEAM — Daytona only */}
                      {isDaytonaMode && <>
                        <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                          <td style={{ ...tdSc(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>PTS</td>
                          {frontNine.map((h) => {
                            const pts = holePtsMaps.get(h.hole_number)?.has(player.id) ? holePtsMaps.get(h.hole_number)!.get(player.id)! : null
                            return <td key={h.hole_number} style={tdSc()}>{renderPts(pts, 600, ptsColor(pts))}</td>
                          })}
                          <td style={tdSc(true)}>{renderPts(frontPoints, 700, ptsColor(frontPoints))}</td>
                          {backNine.map((h) => {
                            const pts = holePtsMaps.get(h.hole_number)?.has(player.id) ? holePtsMaps.get(h.hole_number)!.get(player.id)! : null
                            return <td key={h.hole_number} style={tdSc()}>{renderPts(pts, 600, ptsColor(pts))}</td>
                          })}
                          <td style={tdSc(true)}>{renderPts(backPoints, 700, ptsColor(backPoints))}</td>
                          <td style={tdSc()}>{renderPts(totalPoints, 700, ptsColor(totalPoints))}</td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
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
                        {Object.keys(holeValues).length > 0 && <tr>
                          <td style={{ ...tdSc(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>PRESS</td>
                          {frontNine.map((h) => {
                            const pressRate = holeValues[h.hole_number]
                            const color = pressRate !== undefined ? pressColor(pressRate) : '#9ca3af'
                            return <td key={h.hole_number} style={tdSc()}>{pressRate !== undefined ? <span style={{ fontWeight: 600, fontSize: '0.65rem', color }}>{fmtAmt(pressRate)}</span> : <span style={{ color: '#d1d5db' }}>–</span>}</td>
                          })}
                          <td style={tdSc(true)} />
                          {backNine.map((h) => {
                            const pressRate = holeValues[h.hole_number]
                            const color = pressRate !== undefined ? pressColor(pressRate) : '#9ca3af'
                            return <td key={h.hole_number} style={tdSc()}>{pressRate !== undefined ? <span style={{ fontWeight: 600, fontSize: '0.65rem', color }}>{fmtAmt(pressRate)}</span> : <span style={{ color: '#d1d5db' }}>–</span>}</td>
                          })}
                          <td style={tdSc(true)} /><td style={tdSc()} />
                        </tr>}
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
