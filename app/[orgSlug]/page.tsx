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
  if (isAdmin && !hasGroupSession) redirect(`/${orgSlug}/admin/dashboard`)

  const { data: round } = await sb
    .from('rounds')
    .select('id, name, date, course, balls_count, format, daytona_variant, is_started, include_total, skins_enabled, skins_amount, mixed_groups')
    .eq('is_active', true)
    .eq('org_id', orgId)
    .single()

  const { data: teamsRaw } = round
    ? await sb.from('teams').select('id, name, daytona_variant').eq('round_id', round.id).order('name')
    : { data: [] }
  const teams = teamsRaw ?? []

  const isMixedGroups = round?.mixed_groups ?? false

  // In mixed groups mode, look for playing group auth cookies instead of team auth
  let scorecardTeamId: string | null = null
  let scorecardGroupId: string | null = null

  if (isMixedGroups && round) {
    const { data: pgroups } = await sb.from('playing_groups').select('id').eq('round_id', round.id)
    scorecardGroupId = (pgroups ?? []).find((g) => cookieStore.get(`playing_group_auth_${g.id}`)?.value === 'true')?.id ?? null
  } else {
    scorecardTeamId = teams.find((t) => cookieStore.get(`team_auth_${t.id}`)?.value === 'true')?.id ?? null
  }

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

  const [{ data: players }, { data: holes }, { data: scores }, { data: assignments }, matchupsRes, { data: bestBallMatchups }, { data: holeValuesRaw }, { data: ballValuesRaw }, { data: lbPlayingGroupsRaw }, { data: lbGroupPlayersRaw }] = await Promise.all([
    sb.from('players').select('id, team_id, name, position, skins_participant').in('team_id', teamIds.length ? teamIds : ['']).order('position', { ascending: true }),
    sb.from('holes').select('hole_number, par').eq('round_id', round.id).order('hole_number'),
    sb.from('scores').select('player_id, hole_number, strokes'),
    (isDaytona || isTraditional)
      ? sb.from('daytona_hole_assignments').select('player_id, hole_number, side').eq('round_id', round.id)
      : Promise.resolve({ data: [] }),
    sb.from('matchups').select('id, player1_id, player2_id, bet, press').eq('round_id', round.id).order('created_at'),
    sb.from('best_ball_matchups').select('id, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id, bet').eq('round_id', round.id).order('created_at'),
    isDaytona
      ? sb.from('daytona_hole_values').select('team_id, hole_number, value_per_point').eq('round_id', round.id)
      : Promise.resolve({ data: [] }),
    sb.from('ball_values').select('ball_number, value_dollars').eq('round_id', round.id).order('ball_number'),
    isMixedGroups ? sb.from('playing_groups').select('id, name').eq('round_id', round.id).order('name') : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    isMixedGroups ? sb.from('playing_group_players').select('playing_group_id, player_id').in('playing_group_id', (await sb.from('playing_groups').select('id').eq('round_id', round.id)).data?.map((g) => g.id) ?? []) : Promise.resolve({ data: [] as { playing_group_id: string; player_id: string }[] }),
  ])

  const lbGroupPlayerMap: Record<string, string[]> = {}
  for (const gp of (lbGroupPlayersRaw ?? []) as { playing_group_id: string; player_id: string }[]) {
    if (!lbGroupPlayerMap[gp.playing_group_id]) lbGroupPlayerMap[gp.playing_group_id] = []
    lbGroupPlayerMap[gp.playing_group_id].push(gp.player_id)
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
      players={players ?? []}
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
    />
  )
}
