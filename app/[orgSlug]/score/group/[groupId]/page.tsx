import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getOrgAuth } from '@/lib/org-auth'
import { createServerClient } from '@/lib/supabase-server'
import PlayingGroupScoreEntry from '@/app/components/PlayingGroupScoreEntry'

export const dynamic = 'force-dynamic'

export default async function PlayingGroupScorecardPage({
  params,
}: {
  params: Promise<{ orgSlug: string; groupId: string }>
}) {
  const { orgSlug, groupId } = await params
  const cookieStore = await cookies()

  const auth = await getOrgAuth(orgSlug)
  if (!auth.ok) redirect(`/${orgSlug}`)
  const { orgId, isAdmin, isMaster } = auth

  if (!isAdmin && !isMaster && !cookieStore.get(`playing_group_auth_${groupId}`)?.value) redirect(`/${orgSlug}`)

  const sb = createServerClient()

  const { data: group } = await sb
    .from('playing_groups')
    .select('id, name, round_id, daytona_variant, banker_side_game, banker_side_game_min_bet, auto_strokes')
    .eq('id', groupId)
    .single()
  if (!group) redirect(`/${orgSlug}`)

  const { data: round } = await sb
    .from('rounds')
    .select('id, name, date, course, balls_count, format, is_active, is_started, org_id, mixed_groups, include_total')
    .eq('id', group.round_id)
    .single()
  if (!round || !round.is_active || round.org_id !== orgId || !round.mixed_groups) redirect(`/${orgSlug}`)

  const { data: orgRow } = await sb.from('organizations').select('name').eq('id', orgId).single()
  const orgName = orgRow?.name ?? orgSlug

  // Players in this playing group
  const { data: groupPlayerLinks } = await sb
    .from('playing_group_players')
    .select('player_id')
    .eq('playing_group_id', groupId)
  const groupPlayerIds = (groupPlayerLinks ?? []).map((r) => r.player_id)

  if (groupPlayerIds.length === 0) redirect(`/${orgSlug}`)

  // Fetch group players with their team info
  const { data: groupPlayersRaw } = await sb
    .from('players')
    .select('id, name, team_id, position, handicap')
    .in('id', groupPlayerIds)
    .order('position', { ascending: true })
  const groupPlayers = groupPlayersRaw ?? []

  const groupDaytonaRaw = (group as { daytona_variant?: string | null }).daytona_variant ?? null
  const isDaytonaSideGame = !!groupDaytonaRaw
  const [parsedDaytonaVariant, parsedPayoutStr] = groupDaytonaRaw?.includes('|')
    ? groupDaytonaRaw.split('|') : [groupDaytonaRaw ?? '4man', null]
  const defaultDtPayoutValue = parsedPayoutStr ? (parseFloat(parsedPayoutStr) || 0.25) : 0.25
  const isBankerSideGame = !!(group as { banker_side_game?: boolean }).banker_side_game
  const bankerMinBet = (group as { banker_side_game_min_bet?: number | null }).banker_side_game_min_bet ?? 2
  const autoStrokes = !!(group as { auto_strokes?: boolean }).auto_strokes

  // Fetch all teams in this round to get full team rosters for ball score popup
  const { data: allTeams } = await sb.from('teams').select('id, name').eq('round_id', round.id)
  const allTeamIds = (allTeams ?? []).map((t) => t.id)

  const { data: allPlayersRaw } = await sb
    .from('players')
    .select('id, name, team_id, position')
    .in('team_id', allTeamIds.length ? allTeamIds : [''])
    .order('position', { ascending: true })
  const allPlayers = allPlayersRaw ?? []
  const allPlayerIds = allPlayers.map((p) => p.id)

  // Always include this group's players in the scores query even if they are
  // "non-team" (org-roster) players whose team_id is not in allTeamIds.
  // Without this, saves succeed but scores disappear on reload for such groups.
  const scoreQueryIds = [...new Set([...allPlayerIds, ...groupPlayerIds])]

  const [{ data: holes }, { data: allScores }, { data: ballValuesRaw }, { data: assignmentsRaw }, { data: holeStrokesRaw }, { data: holeValuesRaw }, { data: bankerHolesRaw }, { data: bankerBetsRaw }] = await Promise.all([
    sb.from('holes').select('hole_number, par, stroke_index').eq('round_id', round.id).order('hole_number'),
    sb.from('scores').select('player_id, hole_number, strokes').in('player_id', scoreQueryIds.length ? scoreQueryIds : ['']),
    sb.from('ball_values').select('ball_number, value_dollars').eq('round_id', round.id).order('ball_number'),
    isDaytonaSideGame && groupPlayerIds.length
      ? sb.from('daytona_hole_assignments').select('player_id, hole_number, side').eq('round_id', round.id).in('player_id', groupPlayerIds)
      : Promise.resolve({ data: [] }),
    groupPlayerIds.length
      ? sb.from('hole_strokes').select('hole_number, player_id').eq('round_id', round.id).in('player_id', groupPlayerIds)
      : Promise.resolve({ data: [] }),
    isDaytonaSideGame
      ? sb.from('daytona_hole_values').select('hole_number, value_per_point').eq('round_id', round.id).eq('team_id', groupId)
      : Promise.resolve({ data: [] }),
    isBankerSideGame
      ? sb.from('banker_holes').select('hole_number, banker_player_id, max_bet').eq('round_id', round.id).eq('team_id', groupId)
      : Promise.resolve({ data: [] }),
    isBankerSideGame
      ? sb.from('banker_bets').select('hole_number, player_id, base_bet, player_doubled, banker_doubled').eq('round_id', round.id).eq('team_id', groupId)
      : Promise.resolve({ data: [] }),
  ])

  const initialHoleStrokes: Record<number, string[]> = {}
  for (const hs of (holeStrokesRaw ?? []) as { hole_number: number; player_id: string }[]) {
    if (!initialHoleStrokes[hs.hole_number]) initialHoleStrokes[hs.hole_number] = []
    initialHoleStrokes[hs.hole_number].push(hs.player_id)
  }
  const initialHoleValues: Record<number, number> = {}
  for (const hv of (holeValuesRaw ?? []) as { hole_number: number; value_per_point: number }[]) {
    initialHoleValues[hv.hole_number] = hv.value_per_point
  }
  const initialBankerHoles: Record<number, { bankerPlayerId: string | null; maxBet: number }> = {}
  for (const bh of (bankerHolesRaw ?? []) as { hole_number: number; banker_player_id: string | null; max_bet: number }[]) {
    initialBankerHoles[bh.hole_number] = { bankerPlayerId: bh.banker_player_id, maxBet: bh.max_bet }
  }
  const initialBankerBets: Record<number, Record<string, { baseBet: number; playerDoubled: boolean; bankerDoubled: boolean }>> = {}
  for (const bb of (bankerBetsRaw ?? []) as { hole_number: number; player_id: string; base_bet: number; player_doubled: boolean; banker_doubled: boolean }[]) {
    if (!initialBankerBets[bb.hole_number]) initialBankerBets[bb.hole_number] = {}
    initialBankerBets[bb.hole_number][bb.player_id] = { baseBet: bb.base_bet, playerDoubled: bb.player_doubled, bankerDoubled: bb.banker_doubled }
  }

  // Build team player map: teamId -> playerIds (in order)
  const teamPlayerMap: Record<string, string[]> = {}
  for (const p of allPlayers) {
    if (!teamPlayerMap[p.team_id]) teamPlayerMap[p.team_id] = []
    teamPlayerMap[p.team_id].push(p.id)
  }

  const teamMap: Record<string, string> = Object.fromEntries((allTeams ?? []).map((t) => [t.id, t.name]))

  const initialScores = (allScores ?? []).filter((s) => groupPlayerIds.includes(s.player_id))

  return (
    <PlayingGroupScoreEntry
      orgSlug={orgSlug}
      orgId={orgId}
      orgName={orgName}
      isMaster={isMaster}
      isAdmin={isAdmin}
      groupId={groupId}
      groupName={group.name}
      roundId={round.id}
      roundName={round.name}
      roundDate={round.date}
      roundCourse={round.course ?? ''}
      players={groupPlayers}
      holes={holes ?? []}
      initialScores={initialScores}
      allScores={allScores ?? []}
      ballsCount={round.balls_count}
      teamPlayerMap={teamPlayerMap}
      teamMap={teamMap}
      includeTotal={round.include_total ?? false}
      ballValues={ballValuesRaw ?? []}
      isStarted={round.is_started ?? false}
      daytonaVariant={isDaytonaSideGame ? parsedDaytonaVariant : undefined}
      isDaytonaSideGame={isDaytonaSideGame}
      defaultDtPayoutValue={defaultDtPayoutValue}
      initialAssignments={(assignmentsRaw ?? []) as { player_id: string; hole_number: number; side: string }[]}
      initialHoleStrokes={initialHoleStrokes}
      initialHoleValues={initialHoleValues}
      bankerSideGame={isBankerSideGame}
      bankerMinBet={bankerMinBet}
      initialBankerHoles={initialBankerHoles}
      initialBankerBets={initialBankerBets}
      autoStrokes={autoStrokes}
    />
  )
}
