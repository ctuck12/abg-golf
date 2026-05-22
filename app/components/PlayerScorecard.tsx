'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { ScoreNotation } from './ScoreNotation'

const navy = '#0f172a'
const gold = '#f59e0b'
const steelBlue = '#4a7fa5'
const steelBlueBg = '#dbeafe'

type Hole = { hole_number: number; par: number }
type Score = { hole_number: number; strokes: number }

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

export default function PlayerScorecard({
  player, teamName, teamId, holes, scores: initialScores,
}: {
  player: { id: string; name: string }
  teamName: string
  teamId: string
  holes: Hole[]
  scores: Score[]
}) {
  const [scores, setScores] = useState(initialScores)

  useEffect(() => {
    const channel = supabase.channel(`player-${player.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, async () => {
        const { data } = await supabase
          .from('scores')
          .select('hole_number, strokes')
          .eq('player_id', player.id)
        if (data) setScores(data)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [player.id])

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
  const tdScore = (highlight?: boolean): React.CSSProperties => ({
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
        <div className="max-w-4xl mx-auto">
          <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: gold }}>
            Player Scorecard
          </p>
          <h1 className="font-bold text-xl">{player.name}</h1>
          <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
            {teamName}
          </p>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 pt-4">
        {/* Summary banner */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-5 py-4 mb-4 flex items-center justify-around">
          {([['Front', frontVp], ['Back', backVp], ['Total', vsParThru]] as [string, number | null][]).map(([label, vp]) => (
            <div key={label} className="text-center">
              <p className="text-xs text-gray-500 mb-0.5">{label}</p>
              <p className="text-2xl font-bold" style={{ color: vpColor(vp) }}>{vpStr(vp)}</p>
            </div>
          ))}
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
              {/* SCORE row */}
              <tr>
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
            </tbody>
          </table>
        </div>

        <div className="flex justify-between text-sm pb-8">
          <a href={`/scorecard/${teamId}`} className="font-medium" style={{ color: navy }}>
            ← Team Scorecard
          </a>
          <a href="/" className="font-medium" style={{ color: navy }}>
            Leaderboard →
          </a>
        </div>
      </div>
    </div>
  )
}
