'use client'

import { roundHcp } from '@/lib/scoring'
import { bankerStrokeMatrix, effectiveHcp } from '../../lib/banker-strokes'

type Player = { id: string; name: string; handicap?: number | null }
type Hole = { hole_number: number; stroke_index?: number | null }

/** The handicap breakdown behind the group name in the score entry header.
 *
 *  Shared by both score screens (team-based and playing-group) so the two can't
 *  drift — the numbers here have to match the strokes the game actually assigns.
 */
export default function GroupStrokesSheet({
  title, players, holes, handicapRounding, isBanker, isDaytonaMode, strokeIdsForHole, groupHandicaps, onClose,
}: {
  title: string
  players: Player[]
  holes: Hole[]
  handicapRounding?: string | null
  isBanker: boolean
  isDaytonaMode: boolean
  /** Strokes currently assigned on a hole — auto or hand-picked, whichever is in force. */
  strokeIdsForHole: (holeNumber: number) => string[]
  /** Handicaps of the whole playing group when it's wider than `players` (Daytona
   *  side game: strokes come off the lowest handicap in the group, not the team).
   *  Defaults to the listed players' own handicaps. */
  groupHandicaps?: (number | null | undefined)[]
  onClose: () => void
}) {
  const fmtH = (h: number) => h < 0 ? `+${Math.abs(h)}` : `${h}`
  const roundingLabel = handicapRounding === 'nearest' ? 'Round Up (7.5 → 8)' : 'Round Down (7.9 → 7)'
  const hasSI = holes.some((h) => h.stroke_index != null)

  function body() {
    if (!hasSI) {
      return <p className="text-sm text-gray-500 py-3">This course has no stroke index (hole difficulty) data, so automatic strokes can&apos;t be assigned.</p>
    }

    if (isBanker) {
      const matrix = bankerStrokeMatrix(players, holes, handicapRounding)
      return (
        <div className="mt-2">
          <p className="text-xs text-gray-500 mb-2">
            Banker game — each bet is played separately against the Banker, so the shot goes to whoever of the two is the higher handicap. Rounding: <span className="font-semibold text-gray-700">{roundingLabel}</span>.
          </p>
          <p className="text-[11px] text-gray-400 mb-2">
            <span className="font-semibold text-green-700">gets</span> = that player takes the shot ·{' '}
            <span className="font-semibold text-blue-700">gives</span> = the Banker takes it
          </p>

          {/* Every pairing, whoever ends up with the bank. Fixed for
              the round — only which pair is live changes hole to hole. */}
          {matrix.length > 1 && (
            <div className="space-y-2 mb-3">
              {matrix.map((block) => (
                <div key={block.bankerId} className="bg-gray-50 rounded-lg px-3 py-2">
                  <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">
                    If {block.bankerName.split(' ')[0]} banks
                  </p>
                  <div className="space-y-1">
                    {block.rows.map((r) => (
                      <div key={r.opponentId} className="flex items-start justify-between gap-2">
                        <p className="text-xs whitespace-nowrap pt-0.5">
                          <span className="font-semibold text-gray-800">{r.opponentName.split(' ')[0]}</span>
                          {r.direction === 'even'
                            ? <span className="text-gray-500"> — head up</span>
                            : r.direction === 'opponent'
                            ? <span className="text-green-700"> gets {r.strokes}</span>
                            : <span className="text-blue-700"> gives {r.strokes}</span>}
                        </p>
                        {r.holes.length > 0 && (
                          <div className="flex flex-wrap gap-1 justify-end">
                            {r.holes.map((hn) => (
                              <span key={hn}
                                className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 border ${r.direction === 'opponent' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
                                {hn}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Strokes assigned so far</p>
          {players.map((p) => {
            const effHoleNums = holes.filter((h) => strokeIdsForHole(h.hole_number).includes(p.id)).map((h) => h.hole_number)
            return (
              <div key={p.id} className="flex items-start justify-between py-2 border-t border-gray-100 gap-2">
                <p className="text-sm font-semibold text-gray-800 whitespace-nowrap">
                  {p.name.split(' ')[0]}{' '}
                  {p.handicap != null && (
                    <span className="text-xs font-normal text-gray-400">
                      {fmtH(p.handicap)} HCP
                      {/* What the rounding actually makes them play to */}
                      <span className="text-gray-300"> → </span>
                      <span className="font-semibold text-gray-600">{effectiveHcp(p.handicap, handicapRounding)}</span>
                    </span>
                  )}
                </p>
                {effHoleNums.length > 0
                  ? <div className="flex flex-wrap gap-1 justify-end">{effHoleNums.map((hn) => <span key={hn} className="text-xs font-bold bg-green-50 text-green-700 border border-green-200 rounded-full px-2 py-0.5">{hn}</span>)}</div>
                  : <p className="text-xs text-gray-400 pt-0.5">No stroke holes yet</p>}
              </div>
            )
          })}
        </div>
      )
    }

    const effHcpF = (h: number) => roundHcp(h, handicapRounding, 'trunc')
    const withHcp = players.filter((pl) => pl.handicap != null)
    // The group can be wider than the players on this screen (Daytona side game),
    // and the group's lowest handicap is what everyone strokes off.
    const groupHcps = (groupHandicaps ?? players.map((pl) => pl.handicap)).filter((h): h is number => h != null)
    if (withHcp.length === 0 || groupHcps.length === 0) {
      return <p className="text-sm text-gray-500 py-3">No handicaps on file for this group, so no automatic strokes can be assigned.</p>
    }
    const minEff = Math.min(...groupHcps.map(effHcpF))
    const lowNames = withHcp.filter((pl) => effHcpF(pl.handicap!) === minEff).map((pl) => pl.name.split(' ')[0]).join(' & ')
    return (
      <div className="mt-2">
        <div className="bg-gray-50 rounded-lg px-3 py-2 space-y-1">
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">How this was calculated</p>
          <ul className="text-xs text-gray-600 space-y-1 list-disc pl-4">
            <li>Rounding: <span className="font-semibold text-gray-800">{roundingLabel}</span></li>
            {/* With a wider group the low player may not be on this screen at all */}
            <li>Strokes set by lowest hcp: <span className="font-semibold text-gray-800">{lowNames ? `${lowNames} (${fmtH(minEff)})` : `${fmtH(minEff)} (elsewhere in the group)`}</span></li>
            <li>Playing hcp − {fmtH(minEff)} = strokes, taken on the hardest holes</li>
          </ul>
        </div>
        <p className="text-xs text-gray-500 mt-1.5 mb-1">* Strokes count in the {isDaytonaMode ? 'Daytona' : 'side'} game only</p>
        {[...players].sort((a, b) => {
          // Group low first (alphabetical), then least → most strokes; no-HCP last
          if (a.handicap == null && b.handicap == null) return a.name.localeCompare(b.name)
          if (a.handicap == null) return 1
          if (b.handicap == null) return -1
          const aRel = Math.max(0, effHcpF(a.handicap) - minEff)
          const bRel = Math.max(0, effHcpF(b.handicap) - minEff)
          if (aRel !== bRel) return aRel - bRel
          return a.name.localeCompare(b.name)
        }).map((p) => {
          if (p.handicap == null) {
            return (
              <div key={p.id} className="flex items-center justify-between py-2 border-t border-gray-100">
                <p className="text-sm font-semibold text-gray-800">{p.name.split(' ')[0]}</p>
                <p className="text-xs text-gray-400">No handicap on file</p>
              </div>
            )
          }
          const pEff = effHcpF(p.handicap)
          const rel = Math.max(0, pEff - minEff)
          const holeNums = holes.filter((h) => h.stroke_index != null && h.stroke_index <= rel).map((h) => h.hole_number)
          return (
            <div key={p.id} className="py-2 border-t border-gray-100">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-800">
                  {p.name.split(' ')[0]}{' '}
                  <span className="text-xs font-normal text-gray-400">
                    {fmtH(p.handicap)} HCP
                    {/* What the group's rounding actually makes them play to */}
                    <span className="text-gray-300"> → </span>
                    <span className="font-semibold text-gray-600">{fmtH(pEff)}</span>
                  </span>
                </p>
                <p className={`text-sm font-semibold ${rel > 0 ? 'text-green-700' : 'text-gray-400'}`}>
                  {rel > 0 ? `${rel} stroke${rel !== 1 ? 's' : ''}` : 'Group low'}
                </p>
              </div>
              {rel > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {holeNums.map((hn) => (
                    <span key={hn} className="text-xs font-bold bg-green-50 text-green-700 border border-green-200 rounded-full px-2 py-0.5">{hn}</span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="bg-white rounded-t-3xl w-full max-w-lg p-5 pb-8 overflow-y-auto" style={{ maxHeight: '85dvh' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-gray-900">{title} — Handicap Strokes</h3>
          <button onClick={onClose} className="text-gray-400 text-xl leading-none">✕</button>
        </div>
        {body()}
      </div>
    </div>
  )
}
