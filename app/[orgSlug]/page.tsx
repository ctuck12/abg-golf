import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import { getOrgAuth } from '@/lib/org-auth'
import OrgLoginGate from '@/app/components/OrgLoginGate'
import LeaderboardClient from '@/app/components/LeaderboardClient'
import PreRoundHome from '@/app/components/PreRoundHome'

export const dynamic = 'force-dynamic'

export default async function OrgPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const sb = createServerClient()

  const { data: org } = await sb
    .from('organizations')
    .select('id, name, slug, is_active')
    .eq('slug', orgSlug)
    .single()

  if (!org || !org.is_active) {
    return <OrgLoginGate orgSlug={orgSlug} orgName={null} error="Group not found." />
  }

  const auth = await getOrgAuth(orgSlug)
  if (!auth.ok) {
    return <OrgLoginGate orgSlug={orgSlug} orgName={org.name} />
  }

  const cookieStore = await cookies()
  const { orgId, isAdmin, isMaster } = auth

  const hasGroupSession = cookieStore.getAll().some((c) => c.name.startsWith('playing_group_auth_') && c.value === 'true')

  const { data: round } = await sb
    .from('rounds')
    .select('id, name, date, course, balls_count, format, daytona_variant, is_started, include_total, skins_enabled, skins_amount, mixed_groups')
    .eq('is_active', true)
    .eq('org_id', orgId)
    .single()

  if (isAdmin && !hasGroupSession && !round?.is_started) redirect(`/${orgSlug}/admin/dashboard`)

  const { data: teamsRaw } = round
    ? await sb.from('teams').select('id, name, daytona_variant').eq('round_id', round.id).order('name')
    : { data: [] }
  const teams = teamsRaw ?? []

  const isMixedGroups = round?.mixed_groups ?? false

  // Detect active scorecard session from cookies
  const scorecardTeamId = teams.find((t) => cookieStore.get(`team_auth_${t.id}`)?.value === 'true')?.id ?? null
  const groupAuthCookie = cookieStore.getAll().find((c) => c.name.startsWith('playing_group_auth_') && c.value === 'true')
  const scorecardGroupId = groupAuthCookie ? groupAuthCookie.name.replace('playing_group_auth_', '') : null

  if (!round || !round.is_started) {
    // Fetch playing groups for pre-round PIN entry in mixed mode
    const { data: playingGroupsRaw } = isMixedGroups && round
      ? await sb.from('playing_groups').select('id, name').eq('round_id', round.id).order('name')
      : { data: [] }

    return (
      <PreRoundHome
        teams={isMixedGroups ? [] : teams}
        playingGroups={isMixedGroups ? (playingGroupsRaw ?? []) : []}
        isMixedGroups={isMixedGroups}
        round={round ? { name: round.name, date: round.date, course: round.course ?? '', format: round.format ?? '' } : null}
        orgSlug={orgSlug}
        orgId={orgId}
        orgName={org.name}
        isMaster={isMaster}
      />
    )
  }

  // For live mixed-groups rounds: scorecardTeamId stays null, scorecardGroupId used for "Enter Scores" link

  const teamIds = teams.map((t) => t.id)
  const isDaytona = (round.format ?? 'standard') === 'daytona'
  const isTraditional = (round.format ?? 'standard') === 'traditional'

  const [{ data: players }, { data: holes }, { data: scores }, { data: assignments }, matchupsRes, { data: bestBallMatchups }, { data: holeValuesRaw }, { data: ballValuesRaw }, { data: lbPlayingGroupsRaw }, { data: lbGroupPlayersRaw }, { data: holeStrokesRaw }] = await Promise.all([
    sb.from('players').select('id, team_id, name, position, skins_participant, handicap').in('team_id', teamIds.length ? teamIds : ['']).order('position', { ascending: true }),
    sb.from('holes').select('hole_number, par, stroke_index').eq('round_id', round.id).order('hole_number'),
    sb.from('scores').select('player_id, hole_number, strokes'),
    sb.from('daytona_hole_assignments').select('player_id, hole_number, side').eq('round_id', round.id),
    sb.from('matchups').select('id, player1_id, player2_id, bet, press').eq('round_id', round.id).order('created_at'),
    sb.from('best_ball_matchups').select('id, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id, bet, press').eq('round_id', round.id).order('created_at'),
    (isDaytona || isMixedGroups)
      ? sb.from('daytona_hole_values').select('team_id, hole_number, value_per_point').eq('round_id', round.id)
      : Promise.resolve({ data: [] }),
    sb.from('ball_values').select('ball_number, value_dollars').eq('round_id', round.id).order('ball_number'),
    isMixedGroups ? sb.from('playing_groups').select('id, name, daytona_variant, banker_side_game, banker_side_game_min_bet').eq('round_id', round.id).order('name') : Promise.resolve({ data: [] as { id: string; name: string; daytona_variant?: string | null; banker_side_game?: boolean | null; banker_side_game_min_bet?: number | null }[] }),
    isMixedGroups ? sb.from('playing_group_players').select('playing_group_id, player_id').in('playing_group_id', (await sb.from('playing_groups').select('id').eq('round_id', round.id)).data?.map((g) => g.id) ?? []) : Promise.resolve({ data: [] as { playing_group_id: string; player_id: string }[] }),
    (isMixedGroups || isDaytona) ? sb.from('hole_strokes').select('hole_number, player_id').eq('round_id', round.id) : Promise.resolve({ data: [] as { hole_number: number; player_id: string }[] }),
  ])

  const lbGroupPlayerMap: Record<string, string[]> = {}
  for (const gp of (lbGroupPlayersRaw ?? []) as { playing_group_id: string; player_id: string }[]) {
    if (!lbGroupPlayerMap[gp.playing_group_id]) lbGroupPlayerMap[gp.playing_group_id] = []
    lbGroupPlayerMap[gp.playing_group_id].push(gp.player_id)
  }

  // Fetch banker data for groups that have banker side game enabled
  const bankerGroupIds = (lbPlayingGroupsRaw ?? [])
    .filter((g) => (g as { banker_side_game?: boolean | null }).banker_side_game)
    .map((g) => g.id)
  const [{ data: lbBankerHolesRaw }, { data: lbBankerBetsRaw }] = await Promise.all([
    bankerGroupIds.length
      ? sb.from('banker_holes').select('team_id, hole_number, banker_player_id').eq('round_id', round.id).in('team_id', bankerGroupIds)
      : Promise.resolve({ data: [] as { team_id: string; hole_number: number; banker_player_id: string | null }[] }),
    bankerGroupIds.length
      ? sb.from('banker_bets').select('team_id, hole_number, player_id, base_bet, player_doubled, banker_doubled').eq('round_id', round.id).in('team_id', bankerGroupIds)
      : Promise.resolve({ data: [] as { team_id: string; hole_number: number; player_id: string; base_bet: number; player_doubled: boolean; banker_doubled: boolean }[] }),
  ])
  const lbBankerHoles: Record<string, Record<number, { bankerPlayerId: string | null }>> = {}
  for (const bh of (lbBankerHolesRaw ?? []) as { team_id: string; hole_number: number; banker_player_id: string | null }[]) {
    if (!lbBankerHoles[bh.team_id]) lbBankerHoles[bh.team_id] = {}
    lbBankerHoles[bh.team_id][bh.hole_number] = { bankerPlayerId: bh.banker_player_id }
  }
  const lbBankerBets: Record<string, Record<number, Record<string, { baseBet: number; playerDoubled: boolean; bankerDoubled: boolean }>>> = {}
  for (const bb of (lbBankerBetsRaw ?? []) as { team_id: string; hole_number: number; player_id: string; base_bet: number; player_doubled: boolean; banker_doubled: boolean }[]) {
    if (!lbBankerBets[bb.team_id]) lbBankerBets[bb.team_id] = {}
    if (!lbBankerBets[bb.team_id][bb.hole_number]) lbBankerBets[bb.team_id][bb.hole_number] = {}
    lbBankerBets[bb.team_id][bb.hole_number][bb.player_id] = { baseBet: bb.base_bet, playerDoubled: bb.player_doubled, bankerDoubled: bb.banker_doubled }
  }

  const lbHoleStrokeMap: Record<number, string[]> = {}
  for (const hs of (holeStrokesRaw ?? []) as { hole_number: number; player_id: string }[]) {
    if (!lbHoleStrokeMap[hs.hole_number]) lbHoleStrokeMap[hs.hole_number] = []
    lbHoleStrokeMap[hs.hole_number].push(hs.player_id)
  }

  // Fetch non-team group players (org-roster players added directly to a playing group
  // whose team_id is not in this round's teams list) so they appear on the leaderboard.
  let allPlayers = players ?? []
  if (isMixedGroups) {
    const teamPlayerIdSet = new Set(allPlayers.map((p) => p.id))
    const allGroupPlayerIds = Object.values(lbGroupPlayerMap).flat()
    const nonTeamGroupPlayerIds = allGroupPlayerIds.filter((id) => !teamPlayerIdSet.has(id))
    if (nonTeamGroupPlayerIds.length > 0) {
      const { data: nonTeamPlayersRaw } = await sb
        .from('players')
        .select('id, team_id, name, position, skins_participant, handicap')
        .in('id', nonTeamGroupPlayerIds)
      allPlayers = [...allPlayers, ...(nonTeamPlayersRaw ?? [])]
    }
  }

  const initialHoleValues: Record<string, Record<number, number>> = {}
  for (const hv of (holeValuesRaw ?? []) as { team_id: string; hole_number: number; value_per_point: number }[]) {
    if (!initialHoleValues[hv.team_id]) initialHoleValues[hv.team_id] = {}
    initialHoleValues[hv.team_id][hv.hole_number] = hv.value_per_point
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let matchups: { id: string; player1_id: string; player2_id: string; bet: string; press: any[] }[]
  if (!matchupsRes.error) {
    matchups = (matchupsRes.data ?? []) as typeof matchups
  } else {
    const fallback = await sb.from('matchups').select('id, player1_id, player2_id, bet').eq('round_id', round.id).order('created_at')
    matchups = (fallback.data ?? []).map((m) => ({ ...m, press: [] }))
  }

  return (
    <LeaderboardClient
      orgSlug={orgSlug}
      orgId={orgId}
      orgName={org.name}
      isMaster={isMaster}
      initialTeams={teams}
      players={allPlayers}
      holes={holes ?? []}
      initialScores={scores ?? []}
      ballsCount={round.balls_count}
      ballValues={ballValuesRaw ?? []}
      format={round.format ?? 'standard'}
      daytonaVariant={round.daytona_variant ?? '4man'}
      roundId={round.id}
      initialAssignments={assignments ?? []}
      roundName={round.name}
      roundDate={round.date}
      roundCourse={round.course ?? ''}
      includeTotal={round.include_total ?? false}
      matchups={matchups ?? []}
      bestBallMatchups={bestBallMatchups ?? []}
      skinsEnabled={round.skins_enabled ?? false}
      skinsAmount={round.skins_amount ?? 0}
      initialHoleValues={initialHoleValues}
      viewOnly
      isAdmin={isAdmin}
      scorecardTeamId={scorecardTeamId}
      scorecardGroupId={scorecardGroupId}
      isMixedGroups={isMixedGroups}
      playingGroups={lbPlayingGroupsRaw ?? []}
      groupPlayerMap={lbGroupPlayerMap}
      groupHoleStrokes={lbHoleStrokeMap}
      bankerHolesMap={lbBankerHoles}
      bankerBetsMap={lbBankerBets}
    />
  )
}
