'use client'

import type { ReactNode } from 'react'
import { roundHcp } from '@/lib/scoring'
import { playerBankerStrokes } from '../../lib/banker-strokes'

type Player = { id: string; name: string; handicap?: number | null }
type Hole = { hole_number: number; par: number; stroke_index?: number | null }

/** One player's handicap strokes — if, where and why they apply.
 *
 *  Shared by both score screens (team-based and playing-group) so the two can't
 *  drift, and so the numbers here match the strokes the game actually assigns.
 *  Renders nothing for games where handicap strokes never come into play.
 */
export default function PlayerStrokesSection({
  player, players, holes, handicapRounding, isDaytonaMode, isBanker, autoStrokes,
  holeStrokes, strokeIdsForHole, groupHandicaps,
}: {
  player: Player
  players: Player[]
  holes: Hole[]
  handicapRounding?: string | null
  isDaytonaMode: boolean
  isBanker: boolean
  autoStrokes: boolean
  /** Scorekeeper's per-hole overrides — a hole absent here is left automatic. */
  holeStrokes: Record<number, string[]>
  /** Strokes currently assigned on a hole — auto or hand-picked, whichever is in force. */
  strokeIdsForHole: (holeNumber: number) => string[]
  /** Handicaps of the whole playing group when it's wider than `players` (Daytona
   *  side game: strokes come off the lowest handicap in the group, not the team).
   *  Defaults to the listed players' own handicaps. */
  groupHandicaps?: (number | null | undefined)[]
}) {
  if (!isDaytonaMode && !isBanker && !autoStrokes) return null

  const p = player
  const fmtH = (h: number) => h < 0 ? `+${Math.abs(h)}` : `${h}`
  const roundingLabel = handicapRounding === 'nearest' ? 'Round Up (7.5 → 8)' : 'Round Down (7.9 → 7)'
  const hasSI = holes.some((h) => h.stroke_index != null)

  // Manual (scorekeeper-set) stroke holes for this player
  const manualHoleNums = holes
    .filter((h) => (holeStrokes[h.hole_number] ?? []).includes(p.id))
    .map((h) => h.hole_number)

  // With automatic strokes off the scorekeeper gives strokes by hand, but the
  // handicap breakdown is exactly what they set them from — so it stays on
  // screen either way and this note says what's applied.
  const manualNote = autoStrokes ? null : (
    <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1.5 mb-2">
      Automatic strokes are OFF for this group — the scorekeeper gives strokes by hand, hole by hole.
      {manualHoleNums.length > 0
        ? ` So far ${p.name.split(' ')[0]} has been given a stroke on hole${manualHoleNums.length !== 1 ? 's' : ''} ${manualHoleNums.join(', ')}.`
        : ` ${p.name.split(' ')[0]} has no strokes yet.`}
    </p>
  )

  const section = (body: ReactNode) => (
    <div className="mt-4 border-t border-gray-100 pt-3">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Handicap Strokes</p>
      {manualNote}
      {body}
    </div>
  )

  if (p.handicap == null) {
    return section(
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-gray-700">No strokes — no handicap on file</p>
        <p className="text-xs text-gray-500">{p.name.split(' ')[0]} has no handicap set for this round, so no automatic strokes can be assigned. An admin can set it in the Admin Hub.</p>
      </div>
    )
  }

  if (!hasSI) {
    return section(
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-gray-700">No strokes — course has no hole rankings</p>
        <p className="text-xs text-gray-500">This course has no stroke index (hole difficulty ranking) data, so automatic strokes can&apos;t be assigned to specific holes.</p>
      </div>
    )
  }

  if (isBanker) {
    const effHoleNums = holes.filter((h) => strokeIdsForHole(h.hole_number).includes(p.id)).map((h) => h.hole_number)
    const view = playerBankerStrokes(p.id, players, holes, handicapRounding)
    const me = p.name.split(' ')[0]
    return section(
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-gray-700">Banker game — strokes are per hole, vs. the Banker</p>
        <p className="text-xs text-gray-500">Rounding for this round: <span className="font-semibold text-gray-700">{roundingLabel}</span></p>

        {/* Every pairing this player is in. Taking the bank doesn't change a
            handicap, so one row per opponent covers both "when they bank" and
            "when the other player banks". */}
        {view && view.rows.length > 0 && (
          <div className="bg-gray-50 rounded-lg px-3 py-2 space-y-1.5">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              {me} plays to {fmtH(view.playingHcp)} — whoever has the bank
            </p>
            {view.rows.map((r) => (
              <div key={r.opponentId} className="flex items-start justify-between gap-2">
                <p className="text-xs whitespace-nowrap pt-0.5">
                  <span className="font-semibold text-gray-800">{r.opponentName.split(' ')[0]}</span>
                  <span className="text-gray-400"> {fmtH(r.opponentHcp)}</span>
                  {r.direction === 'even'
                    ? <span className="text-gray-500"> — head up</span>
                    : r.direction === 'gets'
                    ? <span className="text-green-700"> — {me} gets {r.strokes}</span>
                    : <span className="text-blue-700"> — {me} gives {r.strokes}</span>}
                </p>
                {r.holes.length > 0 && (
                  <div className="flex flex-wrap gap-1 justify-end">
                    {r.holes.map((hn) => (
                      <span key={hn}
                        className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 border ${r.direction === 'gets' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
                        {hn}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {effHoleNums.length > 0
          ? <>
              <p className="text-xs text-green-700 bg-green-50 rounded px-2 py-1.5">So far {me} gets a stroke on hole{effHoleNums.length !== 1 ? 's' : ''} {effHoleNums.join(', ')}.</p>
              <div className="text-xs text-gray-500 space-y-0.5">
                <p>* Strokes count in the Banker game only</p>
                <p className="pl-2.5 text-[11px]">– Scores to par shown above are gross totals</p>
              </div>
            </>
          : <p className="text-xs text-gray-500">So far {me} has no stroke holes.</p>}
      </div>
    )
  }

  // Standard auto-strokes: each handicap rounds to a whole playing handicap
  // first, then strokes = difference from the group's lowest
  const effHcp = (h: number) => roundHcp(h, handicapRounding, 'trunc')
  const groupWithHcp = players.filter((pl) => pl.handicap != null)
  // The group can be wider than the players on this screen (Daytona side game)
  const groupHcps = (groupHandicaps ?? players.map((pl) => pl.handicap)).filter((h): h is number => h != null)
  if (groupHcps.length === 0) {
    return section(
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-gray-700">No strokes — no handicaps on file</p>
        <p className="text-xs text-gray-500">Nobody in this group has a handicap set for this round, so no automatic strokes can be assigned.</p>
      </div>
    )
  }
  const minEff = Math.min(...groupHcps.map(effHcp))
  const lowNames = groupWithHcp.filter((pl) => effHcp(pl.handicap!) === minEff).map((pl) => pl.name.split(' ')[0]).join(' & ')
  const pEff = effHcp(p.handicap)
  const isLow = pEff === minEff
  const rel = Math.max(0, pEff - minEff)
  const autoHoleNums = holes
    .filter((h) => h.stroke_index != null && h.stroke_index <= rel)
    .map((h) => h.hole_number)
  // Scorekeeper per-hole overrides of the automatic calculation
  const addedByKeeper: number[] = []
  const removedByKeeper: number[] = []
  for (const h of holes) {
    const manual = holeStrokes[h.hole_number]
    if (manual === undefined) continue
    const autoHas = h.stroke_index != null && h.stroke_index <= rel
    const manHas = manual.includes(p.id)
    if (manHas && !autoHas) addedByKeeper.push(h.hole_number)
    if (!manHas && autoHas) removedByKeeper.push(h.hole_number)
  }

  return section(
    <div className="space-y-2">
      {rel > 0 ? (
        <>
          <p className={`text-sm font-semibold ${autoStrokes ? 'text-green-700' : 'text-gray-700'}`}>
            {autoStrokes ? 'Receiving' : 'Handicap gives'} a stroke on {autoHoleNums.length} hole{autoHoleNums.length !== 1 ? 's' : ''}
          </p>
          <div className="flex flex-wrap gap-1">
            {autoHoleNums.map((hn) => (
              <span key={hn} className="text-xs font-bold bg-green-50 text-green-700 border border-green-200 rounded-full px-2 py-0.5">{hn}</span>
            ))}
          </div>
          <div className="text-xs text-gray-500 space-y-0.5">
            <p>* Strokes count in the {isDaytonaMode ? 'Daytona' : 'side'} game only</p>
            <p className="pl-2.5 text-[11px]">– Scores to par shown above are gross totals</p>
          </div>
        </>
      ) : (
        <p className="text-sm font-semibold text-gray-700">
          {isLow ? 'No strokes — lowest handicap in the group' : 'No strokes this round'}
        </p>
      )}
      <div className="bg-gray-50 rounded-lg px-3 py-2 space-y-1">
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">How this was calculated</p>
        <ul className="text-xs text-gray-600 space-y-1 list-disc pl-4">
          <li>Rounding: <span className="font-semibold text-gray-800">{roundingLabel}</span></li>
          {/* With a wider group the low player may not be on this screen at all */}
          <li>Strokes set by lowest hcp: <span className="font-semibold text-gray-800">{lowNames ? `${lowNames} (${fmtH(minEff)})` : `${fmtH(minEff)} (elsewhere in the group)`}</span></li>
          {isLow ? (
            <li><span className="font-semibold text-gray-800">{p.name.split(' ')[0]}</span> is the low player — receives no strokes</li>
          ) : (
            <li>
              {p.name.split(' ')[0]}: {fmtH(p.handicap)} → {fmtH(pEff)} · {fmtH(pEff)} − {fmtH(minEff)} = <span className="font-semibold text-gray-800">{rel} stroke{rel !== 1 ? 's' : ''}</span>
              {rel > 0 && <> on the {rel === 1 ? 'hardest hole' : `${rel} hardest holes`}</>}
            </li>
          )}
        </ul>
      </div>
      {/* Only an "override" when there was something automatic to override —
          with auto strokes off the note above covers it. */}
      {autoStrokes && (addedByKeeper.length > 0 || removedByKeeper.length > 0) && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1.5">
          Scorekeeper adjustments override the automatic strokes for {p.name.split(' ')[0]}:
          {addedByKeeper.length > 0 && ` stroke added on hole${addedByKeeper.length !== 1 ? 's' : ''} ${addedByKeeper.join(', ')}`}
          {addedByKeeper.length > 0 && removedByKeeper.length > 0 && ' ·'}
          {removedByKeeper.length > 0 && ` stroke removed on hole${removedByKeeper.length !== 1 ? 's' : ''} ${removedByKeeper.join(', ')}`}.
        </p>
      )}
    </div>
  )
}
