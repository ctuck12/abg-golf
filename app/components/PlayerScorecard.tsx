'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

const navy = '#0f172a'
const gold = '#f59e0b'

type Hole = { hole_number: number; par: number }
type Score = { hole_number: number; strokes: number }

function scoreColor(strokes: number, par: number): string {
  const d = strokes - par
  if (d <= -2) return '#7c3aed'
  if (d === -1) return '#2563eb'
  if (d === 0) return '#6b7280'
  if (d === 1) return '#dc2626'
  return '#7f1d1d'
}

function scoreLabel(strokes: number, par: number): string {
  const d = strokes - par
  if (d <= -2) return 'Eagle'
  if (d === -1) return 'Birdie'
  if (d === 0) return 'Par'
  if (d === 1) return 'Bogey'
  if (d === 2) return 'Double'
  return `+${d}`
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
  const frontStrokes = frontNine.reduce((s, h) => s + (scoreMap[h.hole_number] ?? 0), 0)
  const backStrokes = backNine.reduce((s, h) => s + (scoreMap[h.hole_number] ?? 0), 0)
  const frontComplete = frontNine.every((h) => scoreMap[h.hole_number] != null)
  const backComplete = backNine.length > 0 && backNine.every((h) => scoreMap[h.hole_number] != null)

  function vpStr(vp: number | null): string {
    if (vp === null) return '–'
    if (vp === 0) return 'E'
    return vp > 0 ? `+${vp}` : String(vp)
  }

  function vpColor(vp: number | null): string {
    if (vp === null) return '#9ca3af'
    if (vp < 0) return '#2563eb'
    if (vp > 0) return '#dc2626'
    return '#6b7280'
  }

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>
      <header className="text-white px-4 py-4 shadow-md" style={{ background: navy }}>
        <div className="max-w-lg mx-auto">
          <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: gold }}>
            Player Scorecard
          </p>
          <h1 className="font-bold text-xl">{player.name}</h1>
          <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
            {teamName}
          </p>
        </div>
      </header>

      {/* Summary banner */}
      <div className="max-w-lg mx-auto px-4 pt-4">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-5 py-3 mb-4 flex items-center gap-6">
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-0.5">Score</p>
            <p className="text-2xl font-bold text-gray-900">{thru > 0 ? totalStrokes : '–'}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-0.5">vs Par</p>
            <p className="text-2xl font-bold" style={{ color: vpColor(vsParThru) }}>
              {vpStr(vsParThru)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-0.5">Thru</p>
            <p className="text-2xl font-bold text-gray-900">
              {thru === 0 ? '–' : thru === 18 ? 'F' : thru}
            </p>
          </div>
          <div className="text-center flex-1">
            <p className="text-xs text-gray-500 mb-0.5">Par</p>
            <p className="text-2xl font-bold text-gray-500">{totalPar}</p>
          </div>
        </div>

        {/* Scorecard table */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mb-4">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr style={{ background: navy }}>
                <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>Hole</th>
                <th className="px-2 py-2 text-center text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>Par</th>
                <th className="px-2 py-2 text-center text-xs font-semibold" style={{ color: gold }}>Score</th>
                <th className="px-2 py-2 text-center text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>+/−</th>
              </tr>
            </thead>
            <tbody>
              {holes.map((hole) => {
                const strokes = scoreMap[hole.hole_number] ?? null
                const vp = strokes != null ? strokes - hole.par : null
                return (
                  <tr key={hole.hole_number} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <td className="px-3 py-2.5 font-bold text-gray-900">{hole.hole_number}</td>
                    <td className="px-2 py-2.5 text-center text-gray-500">{hole.par}</td>
                    <td className="px-2 py-2.5 text-center">
                      {strokes != null ? (
                        <span className="font-bold text-base" style={{ color: scoreColor(strokes, hole.par) }}>
                          {strokes}
                        </span>
                      ) : (
                        <span className="text-gray-300">–</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      {vp != null ? (
                        <span className="text-xs font-medium px-1.5 py-0.5 rounded"
                          style={{
                            background: vp < 0 ? '#eff6ff' : vp > 0 ? '#fef2f2' : '#f9fafb',
                            color: scoreColor(strokes!, hole.par),
                          }}>
                          {scoreLabel(strokes!, hole.par)}
                        </span>
                      ) : (
                        <span className="text-gray-300">–</span>
                      )}
                    </td>
                  </tr>
                )
              })}

              {/* Front nine subtotal */}
              {frontComplete && (
                <tr className="border-t border-gray-200 bg-gray-50">
                  <td colSpan={2} className="px-3 py-1.5 text-xs font-semibold text-gray-500">Front 9</td>
                  <td className="px-2 py-1.5 text-center text-xs font-bold text-gray-700">{frontStrokes}</td>
                  <td className="px-2 py-1.5 text-center text-xs font-semibold"
                    style={{ color: vpColor(frontStrokes - frontPar) }}>
                    {vpStr(frontStrokes - frontPar)}
                  </td>
                </tr>
              )}
              {/* Back nine subtotal */}
              {backComplete && (
                <tr className="bg-gray-50">
                  <td colSpan={2} className="px-3 py-1.5 text-xs font-semibold text-gray-500">Back 9</td>
                  <td className="px-2 py-1.5 text-center text-xs font-bold text-gray-700">{backStrokes}</td>
                  <td className="px-2 py-1.5 text-center text-xs font-semibold"
                    style={{ color: vpColor(backStrokes - backPar) }}>
                    {vpStr(backStrokes - backPar)}
                  </td>
                </tr>
              )}

              {/* Total row */}
              <tr className="border-t-2 border-gray-300 font-bold" style={{ background: '#f9fafb' }}>
                <td colSpan={2} className="px-3 py-2 text-gray-900">Total</td>
                <td className="px-2 py-2 text-center text-gray-900">{thru > 0 ? totalStrokes : '–'}</td>
                <td className="px-2 py-2 text-center font-bold" style={{ color: vpColor(vsParThru) }}>
                  {vpStr(vsParThru)}
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
