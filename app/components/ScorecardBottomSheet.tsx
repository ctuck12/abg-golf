'use client'

import { ScoreNotation } from './ScoreNotation'

const navy = '#0f172a'
const gold = '#f59e0b'

type Hole = { hole_number: number; par: number; stroke_index?: number | null }
type Score = { player_id: string; hole_number: number; strokes: number }
type Player = { id: string; name: string }

const thSt = (highlight?: boolean, isHoleNum?: boolean): React.CSSProperties => ({
  background: highlight ? '#4a7fa5' : isHoleNum ? '#dde4ee' : navy,
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

export default function ScorecardBottomSheet({
  title, players, holes, scores, onClose,
}: {
  title: string
  players: Player[]
  holes: Hole[]
  scores: Score[]
  onClose: () => void
}) {
  const frontNine = holes.filter((h) => h.hole_number <= 9)
  const backNine = holes.filter((h) => h.hole_number > 9)
  const frontPar = frontNine.reduce((s, h) => s + h.par, 0)
  const backPar = backNine.reduce((s, h) => s + h.par, 0)
  const totalPar = frontPar + backPar

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
          {players.map((player) => {
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

            return (
              <div key={player.id} className="rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-1.5" style={{ background: navy }}>
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
                      <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ ...tdPar(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>HCP</td>
                        {frontNine.map((h) => <td key={h.hole_number} style={tdPar()}>{h.stroke_index ?? '–'}</td>)}
                        {frontNine.length > 0 && <td style={tdPar(true)} />}
                        {backNine.map((h) => <td key={h.hole_number} style={tdPar()}>{h.stroke_index ?? '–'}</td>)}
                        {backNine.length > 0 && <td style={tdPar(true)} />}
                        <td style={tdPar()} />
                      </tr>
                      <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ ...tdPar(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>PAR</td>
                        {frontNine.map((h) => <td key={h.hole_number} style={tdPar()}>{h.par}</td>)}
                        {frontNine.length > 0 && <td style={tdPar(true)}>{frontPar}</td>}
                        {backNine.map((h) => <td key={h.hole_number} style={tdPar()}>{h.par}</td>)}
                        {backNine.length > 0 && <td style={tdPar(true)}>{backPar}</td>}
                        <td style={{ ...tdPar(), fontWeight: 700, color: '#111827' }}>{totalPar}</td>
                      </tr>
                      <tr>
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
