'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { computeHoleBallScores, computeHoleDaytona } from '@/lib/scoring'
import { ScoreNotation } from './ScoreNotation'

type Player = { id: string; name: string }
type Hole = { hole_number: number; par: number }
type Score = { player_id: string; hole_number: number; strokes: number }

const navy = '#0f172a'
const gold = '#f59e0b'
const steelBlue = '#4a7fa5'
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
const tdPar = (highlight?: boolean): React.CSSProperties => ({
  background: highlight ? steelBlueBg : 'white',
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
  teamName, players, holes, scores: initialScores, ballsCount, format = 'standard',
}: {
  teamName: string
  players: Player[]
  holes: Hole[]
  scores: Score[]
  ballsCount: number
  format?: string
}) {
  const [scores, setScores] = useState(initialScores)
  const isDaytona = format === 'daytona'

  useEffect(() => {
    const playerIds = players.map((p) => p.id)
    const channel = supabase.channel('scorecard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, async () => {
        const { data } = await supabase
          .from('scores').select('player_id, hole_number, strokes').in('player_id', playerIds)
        if (data) setScores(data)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
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
    const dtScore: number | null = isDaytona && validScores.length >= 2
      ? computeHoleDaytona(validScores, hole.par)
      : null
    return { hole, playerScores, ballScores, dtScore }
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

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>
      <header className="text-white px-4 py-4 shadow-md" style={{ background: navy }}>
        <div className="max-w-4xl mx-auto flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide" style={{ color: gold }}>Scorecard</p>
            <h1 className="font-bold text-lg">{teamName}</h1>
          </div>
          <a href="/leaderboard" className="text-xs px-3 py-1.5 rounded-lg font-semibold mt-0.5 flex-shrink-0"
            style={{ background: gold, color: navy }}>
            Leaderboard
          </a>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-3 py-4 overflow-x-auto">
        <table className="border-collapse bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-200" style={{ minWidth: '600px', width: '100%' }}>
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
            {/* PAR row */}
            <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={{ ...tdPar(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151' }}>PAR</td>
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
                <td style={{ ...tdScore(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', whiteSpace: 'nowrap' }}>
                  <a href={`/player/${p.id}`} className="underline underline-offset-2" style={{ color: navy }}>
                    {p.name.split(' ')[0]}
                  </a>
                </td>
                {[1,2,3,4,5,6,7,8,9].map((n) => {
                  const d = holeData.find((d) => d.hole.hole_number === n)
                  const s = d?.playerScores[pi] ?? null
                  return (
                    <td key={n} style={tdScore()}>
                      {s != null && d ? <ScoreNotation strokes={s} par={d.hole.par} size="sm" /> : <span style={{ color: '#d1d5db' }}>–</span>}
                    </td>
                  )
                })}
                <td style={tdScore(true)}>
                  {sumScored(frontData, (d) => d.playerScores[pi]) ?? '–'}
                </td>
                {[10,11,12,13,14,15,16,17,18].map((n) => {
                  const d = holeData.find((d) => d.hole.hole_number === n)
                  const s = d?.playerScores[pi] ?? null
                  return (
                    <td key={n} style={tdScore()}>
                      {s != null && d ? <ScoreNotation strokes={s} par={d.hole.par} size="sm" /> : <span style={{ color: '#d1d5db' }}>–</span>}
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

            {/* Daytona row OR ball rows */}
            {isDaytona ? (
              <tr>
                <td style={{ ...tdScore(false, true), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#92400e' }}>
                  DT
                </td>
                {[1,2,3,4,5,6,7,8,9].map((n) => {
                  const d = holeData.find((d) => d.hole.hole_number === n)
                  return (
                    <td key={n} style={tdScore(false, true)}>
                      {d?.dtScore != null
                        ? <span style={{ fontWeight: 700, color: '#111827' }}>{d.dtScore}</span>
                        : <span style={{ color: '#d1d5db' }}>–</span>}
                    </td>
                  )
                })}
                <td style={{ ...tdScore(true, true) }}>
                  {sumScored(frontData, (d) => d.dtScore) ?? '–'}
                </td>
                {[10,11,12,13,14,15,16,17,18].map((n) => {
                  const d = holeData.find((d) => d.hole.hole_number === n)
                  return (
                    <td key={n} style={tdScore(false, true)}>
                      {d?.dtScore != null
                        ? <span style={{ fontWeight: 700, color: '#111827' }}>{d.dtScore}</span>
                        : <span style={{ color: '#d1d5db' }}>–</span>}
                    </td>
                  )
                })}
                <td style={{ ...tdScore(true, true) }}>
                  {sumScored(backData, (d) => d.dtScore) ?? '–'}
                </td>
                <td style={{ ...tdScore(false, true), fontWeight: 700, color: '#111827' }}>
                  {sumScored(holeData, (d) => d.dtScore) ?? '–'}
                </td>
              </tr>
            ) : (
              Array.from({ length: ballsCount }, (_, bi) => (
                <tr key={bi}>
                  <td style={{ ...tdScore(false, true), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#92400e' }}>
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

        <div className="pb-8" />
      </div>
    </div>
  )
}
