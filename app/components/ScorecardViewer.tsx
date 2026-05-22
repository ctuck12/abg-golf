'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { computeHoleBallScores } from '@/lib/scoring'

type Player = { id: string; name: string }
type Hole = { hole_number: number; par: number }
type Score = { player_id: string; hole_number: number; strokes: number }

const navy = '#0f172a'
const gold = '#f59e0b'
const BALL_LABELS = ['1B', '2B', '3B', '4B']

function cellColor(strokes: number | null, par: number): string {
  if (strokes == null) return '#9ca3af'
  const d = strokes - par
  if (d <= -2) return '#7c3aed'
  if (d === -1) return '#2563eb'
  if (d === 0) return '#6b7280'
  if (d === 1) return '#dc2626'
  return '#7f1d1d'
}

function fmt(strokes: number | null, par: number): string {
  if (strokes == null) return '–'
  const d = strokes - par
  if (d === 0) return 'E'
  return d > 0 ? `+${d}` : String(d)
}

export default function ScorecardViewer({
  teamName, players, holes, scores: initialScores, ballsCount,
}: {
  teamName: string
  players: Player[]
  holes: Hole[]
  scores: Score[]
  ballsCount: number
}) {
  const [scores, setScores] = useState(initialScores)

  useEffect(() => {
    const playerIds = players.map((p) => p.id)
    const channel = supabase.channel('scorecard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, async () => {
        const { data } = await supabase
          .from('scores')
          .select('player_id, hole_number, strokes')
          .in('player_id', playerIds)
        if (data) setScores(data)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [players])

  const parMap = Object.fromEntries(holes.map((h) => [h.hole_number, h.par]))

  // Build totals
  const ballTotals = Array(ballsCount).fill(0) as number[]
  const ballParTotals = Array(ballsCount).fill(0) as number[]

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>
      <header className="text-white px-4 py-4 shadow-md" style={{ background: navy }}>
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide" style={{ color: gold }}>Scorecard</p>
            <h1 className="font-bold text-lg">{teamName}</h1>
          </div>
          <a href="/leaderboard" className="text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>← Leaderboard</a>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-3 py-4 overflow-x-auto">
        <table className="w-full text-sm border-collapse bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-200">
          <thead>
            <tr style={{ background: navy, color: 'rgba(255,255,255,0.7)' }}>
              <th className="px-3 py-2 text-left text-xs font-semibold">Hole</th>
              <th className="px-2 py-2 text-center text-xs font-semibold">Par</th>
              {players.map((p) => (
                <th key={p.id} className="px-2 py-2 text-center text-xs font-semibold truncate max-w-16">
                  <a href={`/player/${p.id}`} className="underline underline-offset-2" style={{ color: gold }}>
                    {p.name.split(' ')[0]}
                  </a>
                </th>
              ))}
              {Array.from({ length: ballsCount }, (_, i) => (
                <th key={i} className="px-2 py-2 text-center text-xs font-semibold" style={{ color: gold }}>
                  {BALL_LABELS[i]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {holes.map((hole) => {
              const par = hole.par
              const playerScores = players.map((p) =>
                scores.find((s) => s.player_id === p.id && s.hole_number === hole.hole_number)?.strokes ?? null
              )
              const validScores = playerScores.filter((s): s is number => s !== null)
              const ballScores = validScores.length > 0
                ? computeHoleBallScores(validScores, ballsCount)
                : Array(ballsCount).fill(null)

              ballScores.forEach((b, i) => {
                if (b !== null) { ballTotals[i] += b; ballParTotals[i] += par }
              })

              return (
                <tr key={hole.hole_number} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 font-bold text-gray-900">{hole.hole_number}</td>
                  <td className="px-2 py-2 text-center text-gray-500">{par}</td>
                  {playerScores.map((s, i) => (
                    <td key={i} className="px-2 py-2 text-center font-medium" style={{ color: s != null ? cellColor(s, par) : '#9ca3af' }}>
                      {s ?? '–'}
                    </td>
                  ))}
                  {ballScores.map((b, i) => (
                    <td key={i} className="px-2 py-2 text-center font-bold"
                      style={{ color: b != null ? cellColor(b, par) : '#9ca3af', background: '#fafafa' }}>
                      {b ?? '–'}
                    </td>
                  ))}
                </tr>
              )
            })}

            {/* Totals row */}
            <tr className="font-bold border-t-2 border-gray-300" style={{ background: '#f9fafb' }}>
              <td className="px-3 py-2 text-gray-900">Total</td>
              <td className="px-2 py-2 text-center text-gray-600">
                {holes.reduce((s, h) => s + h.par, 0)}
              </td>
              {players.map((p) => {
                const total = scores.filter((s) => s.player_id === p.id).reduce((sum, s) => sum + s.strokes, 0)
                return <td key={p.id} className="px-2 py-2 text-center text-gray-700">{total || '–'}</td>
              })}
              {ballTotals.map((t, i) => {
                const vp = t - ballParTotals[i]
                return (
                  <td key={i} className="px-2 py-2 text-center" style={{ background: '#fafafa' }}>
                    <span style={{ color: vp < 0 ? '#2563eb' : vp > 0 ? '#dc2626' : '#6b7280' }}>
                      {ballParTotals[i] === 0 ? '–' : vp === 0 ? 'E' : vp > 0 ? `+${vp}` : vp}
                    </span>
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>

        <div className="mt-4 text-center">
          <a href="/leaderboard" className="text-sm font-medium" style={{ color: navy }}>← Back to Leaderboard</a>
        </div>
      </div>
    </div>
  )
}
