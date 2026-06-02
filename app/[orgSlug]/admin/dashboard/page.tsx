import { redirect } from 'next/navigation'
import { getOrgAuth } from '@/lib/org-auth'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase-server'
import AdminDashboard from '@/app/components/AdminDashboard'

export const dynamic = 'force-dynamic'

export default async function OrgAdminDashboardPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const auth = await getOrgAuth(orgSlug)
  if (!auth.ok || !auth.isAdmin) redirect(`/${orgSlug}/admin`)

  const { orgId, isMaster } = auth
  const cookieStore = await cookies()
  const sb2 = createServerClient()
  const { data: orgRow } = await sb2.from('organizations').select('name').eq('id', orgId).single()
  const orgName = orgRow?.name ?? orgSlug
  const sb = createServerClient()

  const { data: roundRows } = await sb
    .from('rounds')
    .select('id, name, date, course, balls_count, format, daytona_variant, is_started, include_total, skins_enabled, skins_amount, auto_handicap, mixed_groups, playing_group_count')
    .eq('is_active', true)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(1)
  const round = roundRows?.[0] ?? null

  const roundId = round?.id
  const isDaytona = (round?.format ?? 'standard') === 'daytona'

  const [teamsRes, holesRes, ballValuesRes] = await Promise.all([
    roundId ? sb.from('teams').select('id, name, pin, is_admin, daytona_variant, banker_side_game, banker_side_game_min_bet, auto_strokes').eq('round_id', roundId).order('name') : Promise.resolve({ data: [] }),
    roundId ? sb.from('holes').select('hole_number, par, stroke_index').eq('round_id', roundId).order('hole_number') : Promise.resolve({ data: [] }),
    roundId ? sb.from('ball_values').select('ball_number, value_dollars').eq('round_id', roundId).order('ball_number') : Promise.resolve({ data: [] }),
  ])

  const teams = teamsRes.data ?? []
  const teamIds = teams.map((t) => t.id)
  const scorecardTeamId = teams.find((t) => cookieStore.get(`team_auth_${t.id}`)?.value === 'true')?.id ?? null

  const [playersRes, scoresRes, assignmentsRes, matchupsRaw, bestBallRes, holeValuesRes] = await Promise.all([
    teamIds.length ? sb.from('players').select('id, team_id, name, position, skins_participant, handicap').in('team_id', teamIds).order('position', { ascending: true }) : Promise.resolve({ data: [] as { id: string; team_id: string | null; name: string; position: number | null; skins_participant: boolean; handicap: number | null }[] }),
    roundId ? sb.from('scores').select('player_id, hole_number, strokes') : Promise.resolve({ data: [] }),
    roundId && isDaytona ? sb.from('daytona_hole_assignments').select('player_id, hole_number, side').eq('round_id', roundId) : Promise.resolve({ data: [] }),
    roundId ? sb.from('matchups').select('id, player1_id, player2_id, bet, press').eq('round_id', roundId).order('created_at') : Promise.resolve({ data: [], error: null }),
    roundId ? sb.from('best_ball_matchups').select('id, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id, bet').eq('round_id', roundId).order('created_at') : Promise.resolve({ data: [] }),
    roundId && isDaytona ? sb.from('daytona_hole_values').select('team_id, hole_number, value_per_point').eq('round_id', roundId) : Promise.resolve({ data: [] }),
  ])

  const initialHoleValues: Record<string, Record<number, number>> = {}
  for (const hv of (holeValuesRes.data ?? []) as { team_id: string; hole_number: number; value_per_point: number }[]) {
    if (!initialHoleValues[hv.team_id]) initialHoleValues[hv.team_id] = {}
    initialHoleValues[hv.team_id][hv.hole_number] = hv.value_per_point
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let matchups: { id: string; player1_id: string; player2_id: string; bet: string; press: any[] }[]
  if (!matchupsRaw.error) {
    matchups = (matchupsRaw.data ?? []) as typeof matchups
  } else {
    const fallback = roundId ? await sb.from('matchups').select('id, player1_id, player2_id, bet').eq('round_id', roundId).order('created_at') : { data: [] }
    matchups = (fallback.data ?? []).map((m) => ({ ...m, press: [] }))
  }

  const [{ data: courses }, { data: playingGroupsRaw }, { data: playingGroupPlayersRaw }, { data: rosterRaw }, { data: hammerMatchupsRaw }] = await Promise.all([
    sb.from('courses').select('name, slug, pars').eq('is_active', true).order('name'),
    roundId ? sb.from('playing_groups').select('id, name, pin').eq('round_id', roundId).order('name') : Promise.resolve({ data: [] }),
    roundId ? sb.from('playing_group_players').select('playing_group_id, player_id').in('playing_group_id',
      (await sb.from('playing_groups').select('id').eq('round_id', roundId)).data?.map((g) => g.id) ?? []
    ) : Promise.resolve({ data: [] }),
    sb.from('org_players').select('id, name, ghin_number, handicap_index, email').eq('org_id', orgId).order('name'),
    roundId ? sb.from('hammer_matchups').select('id, team1_id, team2_id, base_bet, auto_handicap').eq('round_id', roundId).order('created_at') : Promise.resolve({ data: [] }),
  ])

  // Also include non-team (manual) players assigned to playing groups for this round
  const teamPlayers = playersRes.data ?? []
  const teamPlayerIdSet = new Set(teamPlayers.map((p) => p.id))
  const pgPlayerIds = (playingGroupPlayersRaw ?? []).map((gp) => gp.player_id).filter((id) => !teamPlayerIdSet.has(id))
  const { data: manualGroupPlayersRaw } = pgPlayerIds.length
    ? await sb.from('players').select('id, team_id, name, position, skins_participant, handicap').in('id', pgPlayerIds)
    : { data: [] as typeof teamPlayers }
  const allPlayers = [...teamPlayers, ...(manualGroupPlayersRaw ?? [])]

  return (
    <AdminDashboard
      orgSlug={orgSlug}
      orgId={orgId}
      orgName={orgName}
      isMaster={isMaster}
      round={round ?? null}
      teams={teams}
      players={allPlayers}
      holes={holesRes.data ?? []}
      ballValues={ballValuesRes.data ?? []}
      scores={scoresRes.data ?? []}
      scorecardTeamId={scorecardTeamId}
      dtAssignments={assignmentsRes.data ?? []}
      matchups={matchups ?? []}
      bestBallMatchups={bestBallRes.data ?? []}
      initialHoleValues={initialHoleValues}
      courses={courses ?? []}
      playingGroups={playingGroupsRaw ?? []}
      playingGroupPlayers={playingGroupPlayersRaw ?? []}
      roster={rosterRaw ?? []}
      hammerMatchups={hammerMatchupsRaw ?? []}
    />
  )
}
