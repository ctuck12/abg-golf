// Rewriting stored stroke holes after a group's rounding changes.
//
// hole_strokes is written when a hole is saved, and effectiveStrokeIds treats
// any stored row as final — it can't tell a scorekeeper's override from a
// persisted automatic stroke. So changing the rounding afterwards left played
// holes on the old allowance while the breakdown popup showed the new one, and
// the leaderboard settled from the stored rows. This recomputes those rows so
// the two agree.
//
// Only holes already in play are touched. Unplayed holes have no stored rows
// and are computed live, so writing them here would freeze them at today's
// rounding for no reason.

import type { createServerClient } from './supabase-server'
import { daytonaAutoStrokeIds, bankerStrokeSplit, type StrokePlayer, type StrokeHole } from './scoring'

type Supabase = ReturnType<typeof createServerClient>

export type RecomputeResult = { holesChanged: number[] }

type Context = {
  roundId: string
  /** Players whose stroke rows this scope owns — the delete is scoped to these. */
  players: StrokePlayer[]
  /** The whole playing group's handicaps, which can be wider than `players`. */
  groupHandicaps: (number | null | undefined)[]
  isDaytonaMode: boolean
  isBanker: boolean
  autoStrokes: boolean
  rounding: string | null | undefined
  /** Owner of banker_holes rows: the team id, or the group id for playing groups. */
  bankerScopeId: string
}

async function recompute(sb: Supabase, ctx: Context): Promise<RecomputeResult> {
  // With automatic strokes off every stored row is the scorekeeper's own doing
  if (!ctx.autoStrokes || (!ctx.isDaytonaMode && !ctx.isBanker)) return { holesChanged: [] }
  const playerIds = ctx.players.map((p) => p.id)
  if (playerIds.length === 0) return { holesChanged: [] }

  const [{ data: holesRaw }, { data: scoresRaw }, { data: strokesRaw }, { data: bankerHolesRaw }] = await Promise.all([
    sb.from('holes').select('hole_number, stroke_index').eq('round_id', ctx.roundId).order('hole_number'),
    sb.from('scores').select('hole_number').in('player_id', playerIds),
    sb.from('hole_strokes').select('hole_number, player_id').eq('round_id', ctx.roundId).in('player_id', playerIds),
    ctx.isBanker
      ? sb.from('banker_holes').select('hole_number, banker_player_id').eq('round_id', ctx.roundId).eq('team_id', ctx.bankerScopeId)
      : Promise.resolve({ data: [] as { hole_number: number; banker_player_id: string | null }[] }),
  ])

  const holes = (holesRaw ?? []) as StrokeHole[]
  if (holes.length === 0) return { holesChanged: [] }

  // Holes in play — anything with a score for one of this scope's players
  const playedHoles = new Set<number>((scoresRaw ?? []).map((s: { hole_number: number }) => s.hole_number))
  if (playedHoles.size === 0) return { holesChanged: [] }

  const bankerByHole = new Map<number, string | null>()
  for (const bh of (bankerHolesRaw ?? []) as { hole_number: number; banker_player_id: string | null }[]) {
    bankerByHole.set(bh.hole_number, bh.banker_player_id)
  }

  const storedByHole = new Map<number, Set<string>>()
  for (const hs of (strokesRaw ?? []) as { hole_number: number; player_id: string }[]) {
    if (!storedByHole.has(hs.hole_number)) storedByHole.set(hs.hole_number, new Set())
    storedByHole.get(hs.hole_number)!.add(hs.player_id)
  }

  const holesChanged: number[] = []
  const rows: { round_id: string; hole_number: number; player_id: string }[] = []
  for (const hole of holes) {
    if (!playedHoles.has(hole.hole_number)) continue
    const next = ctx.isBanker
      ? bankerStrokeSplit(hole, ctx.players, bankerByHole.get(hole.hole_number) ?? null, ctx.rounding).all
      : daytonaAutoStrokeIds(hole, ctx.players, ctx.groupHandicaps, ctx.rounding)
    const stored = storedByHole.get(hole.hole_number) ?? new Set<string>()
    const same = next.length === stored.size && next.every((id) => stored.has(id))
    if (same) continue
    holesChanged.push(hole.hole_number)
    for (const pid of next) rows.push({ round_id: ctx.roundId, hole_number: hole.hole_number, player_id: pid })
  }

  if (holesChanged.length === 0) return { holesChanged: [] }
  // Scoped to this group's players so other groups on the same hole are untouched
  await sb.from('hole_strokes').delete()
    .eq('round_id', ctx.roundId).in('hole_number', holesChanged).in('player_id', playerIds)
  if (rows.length > 0) await sb.from('hole_strokes').insert(rows)
  return { holesChanged: holesChanged.sort((a, b) => a - b) }
}

/** Mirrors how /score/[teamId] decides which game is on and who sets the low. */
export async function recomputeTeamHoleStrokes(sb: Supabase, teamId: string): Promise<RecomputeResult> {
  const { data: team } = await sb
    .from('teams').select('id, round_id, daytona_variant, banker_side_game, auto_strokes, stroke_rounding')
    .eq('id', teamId).single()
  if (!team) return { holesChanged: [] }
  const { data: round } = await sb
    .from('rounds').select('id, format, auto_handicap, handicap_rounding').eq('id', team.round_id).single()
  if (!round) return { holesChanged: [] }

  const format = round.format ?? 'standard'
  const isDaytona = format === 'daytona'
  const teamDaytonaRaw = (team as { daytona_variant?: string | null }).daytona_variant ?? null
  const isDaytonaSideGame = (format === 'traditional' || format === 'standard') && !!teamDaytonaRaw
  const teamBankerSideGame = !!(team as { banker_side_game?: boolean }).banker_side_game
  const teamAutoStrokes = !!(team as { auto_strokes?: boolean }).auto_strokes

  const { data: playersRaw } = await sb.from('players').select('id, handicap').eq('team_id', teamId)
  const players = (playersRaw ?? []) as StrokePlayer[]

  // A side game strokes off the lowest handicap in the whole playing group,
  // which can reach past this team
  let groupHandicaps: (number | null | undefined)[] = players.map((p) => p.handicap)
  if (isDaytonaSideGame && players.length > 0) {
    const { data: link } = await sb.from('playing_group_players')
      .select('playing_group_id').in('player_id', players.map((p) => p.id)).limit(1)
    const pgId = link?.[0]?.playing_group_id
    if (pgId) {
      const { data: groupLinks } = await sb.from('playing_group_players').select('player_id').eq('playing_group_id', pgId)
      const groupIds = (groupLinks ?? []).map((l: { player_id: string }) => l.player_id)
      if (groupIds.length > 0) {
        const { data: groupPlayers } = await sb.from('players').select('id, handicap').in('id', groupIds)
        groupHandicaps = ((groupPlayers ?? []) as StrokePlayer[]).map((p) => p.handicap)
      }
    }
  }

  return recompute(sb, {
    roundId: round.id,
    players,
    groupHandicaps,
    isDaytonaMode: isDaytona || isDaytonaSideGame,
    isBanker: format === 'banker' || teamBankerSideGame,
    // Per group for every Daytona/Banker shape; the round flag only still
    // answers for formats with no per-group toggle
    autoStrokes: (isDaytona || format === 'banker' || isDaytonaSideGame || teamBankerSideGame)
      ? teamAutoStrokes
      : !!round.auto_handicap,
    rounding: (team as { stroke_rounding?: string | null }).stroke_rounding
      ?? (round as { handicap_rounding?: string | null }).handicap_rounding ?? 'down',
    bankerScopeId: teamId,
  })
}

/** Mirrors how /score/group/[groupId] decides the same things. */
export async function recomputePlayingGroupHoleStrokes(sb: Supabase, groupId: string): Promise<RecomputeResult> {
  const { data: group } = await sb
    .from('playing_groups').select('id, round_id, daytona_variant, banker_side_game, auto_strokes, stroke_rounding')
    .eq('id', groupId).single()
  if (!group) return { holesChanged: [] }
  const { data: round } = await sb
    .from('rounds').select('id, handicap_rounding').eq('id', group.round_id).single()
  if (!round) return { holesChanged: [] }

  const { data: links } = await sb.from('playing_group_players').select('player_id').eq('playing_group_id', groupId)
  const ids = (links ?? []).map((l: { player_id: string }) => l.player_id)
  if (ids.length === 0) return { holesChanged: [] }
  const { data: playersRaw } = await sb.from('players').select('id, handicap').in('id', ids)
  const players = (playersRaw ?? []) as StrokePlayer[]

  return recompute(sb, {
    roundId: round.id,
    players,
    groupHandicaps: players.map((p) => p.handicap),
    isDaytonaMode: !!(group as { daytona_variant?: string | null }).daytona_variant,
    isBanker: !!(group as { banker_side_game?: boolean }).banker_side_game,
    autoStrokes: !!(group as { auto_strokes?: boolean }).auto_strokes,
    rounding: (group as { stroke_rounding?: string | null }).stroke_rounding
      ?? (round as { handicap_rounding?: string | null }).handicap_rounding ?? 'down',
    bankerScopeId: groupId,
  })
}
