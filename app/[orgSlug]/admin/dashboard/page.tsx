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
  const sb = createServerClient()

  // Wave 1: org + active round
  const [{ data: orgRow }, { data: roundRows }] = await Promise.all([
    sb.from('organizations').select('name').eq('id', orgId).single(),
    sb.from('rounds')
      .select('id, name, date, course, balls_count, format, daytona_variant, is_started, include_total, skins_enabled, skins_amount, skins_mode, auto_handicap, handicap_rounding, mixed_groups, playing_group_count, banker_double_scope, course_tee_id')
      .eq('is_active', true)
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(1),
  ])
  const orgName = orgRow?.name ?? orgSlug
  const round = roundRows?.[0] ?? null

  const roundId = round?.id
  const isDaytona = (round?.format ?? 'standard') === 'daytona'

  // Wave 2: everything that only needs the round id
  const [teamsRes, holesRes, ballValuesRes, assignmentsRes, matchupsRaw, bestBallRes, holeValuesRes, coursesRes, playingGroupsRes, rosterRes, hammerRes, medleyRes] = await Promise.all([
    roundId ? sb.from('teams').select('id, name, pin, is_admin, daytona_variant, daytona_variant_back9, banker_side_game, banker_side_game_min_bet, banker_side_game_max_bet, banker_double_scope, auto_strokes, hammer_side_game, hammer_base_bet, hammer_format, stroke_rounding').eq('round_id', roundId).order('name') : Promise.resolve({ data: [] }),
    roundId ? sb.from('holes').select('hole_number, par, stroke_index').eq('round_id', roundId).order('hole_number') : Promise.resolve({ data: [] }),
    roundId ? sb.from('ball_values').select('ball_number, value_dollars').eq('round_id', roundId).order('ball_number') : Promise.resolve({ data: [] }),
    roundId && isDaytona ? sb.from('daytona_hole_assignments').select('player_id, hole_number, side').eq('round_id', roundId) : Promise.resolve({ data: [] }),
    roundId ? sb.from('matchups').select('id, player1_id, player2_id, bet, press, hole_range').eq('round_id', roundId).order('created_at') : Promise.resolve({ data: [], error: null }),
    roundId ? sb.from('best_ball_matchups').select('id, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id, bet, press, hole_range, player_strokes').eq('round_id', roundId).order('created_at') : Promise.resolve({ data: [] }),
    roundId && isDaytona ? sb.from('daytona_hole_values').select('team_id, hole_number, value_per_point').eq('round_id', roundId) : Promise.resolve({ data: [] }),
    sb.from('courses').select('name, slug, pars, course_tees(id, name, position)').eq('is_active', true).order('name'),
    roundId ? sb.from('playing_groups').select('id, name, pin, daytona_variant, banker_side_game, banker_side_game_min_bet, banker_side_game_max_bet, banker_double_scope, auto_strokes, stroke_rounding').eq('round_id', roundId).order('name') : Promise.resolve({ data: [] as { id: string; name: string; pin: string; daytona_variant?: string | null; banker_side_game?: boolean; banker_side_game_min_bet?: number | null; banker_side_game_max_bet?: number | null; banker_double_scope?: string | null; auto_strokes?: boolean; stroke_rounding?: string | null }[] }),
    sb.from('org_players').select('id, name, ghin_number, handicap_index, email').eq('org_id', orgId).order('name'),
    roundId ? sb.from('hammer_matchups').select('id, team1_id, team2_id, base_bet, auto_handicap').eq('round_id', roundId).order('created_at') : Promise.resolve({ data: [] }),
    roundId ? sb.from('medley_matchups').select('id, players, bet_type, amount, press').eq('round_id', roundId).order('created_at') : Promise.resolve({ data: [] }),
  ])

  const teams = teamsRes.data ?? []
  const teamIds = teams.map((t) => t.id)
  const scorecardTeamId = teams.find((t) => cookieStore.get(`team_auth_${t.id}`)?.value === 'true')?.id ?? null
  const playingGroupsRaw = playingGroupsRes.data ?? []
  const groupIds = playingGroupsRaw.map((g) => g.id)
  const scorecardGroupId = playingGroupsRaw.find((g) => cookieStore.get(`playing_group_auth_${g.id}`)?.value === 'true')?.id ?? null

  // Wave 3: needs team / group ids from wave 2
  const [playersRes, playingGroupPlayersRes] = await Promise.all([
    teamIds.length ? sb.from('players').select('id, team_id, name, position, skins_participant, handicap, holes_range, roster_player_id').in('team_id', teamIds).order('position', { ascending: true }) : Promise.resolve({ data: [] as { id: string; team_id: string | null; name: string; position: number | null; skins_participant: boolean; handicap: number | null; holes_range: string | null; roster_player_id: string | null }[] }),
    groupIds.length ? sb.from('playing_group_players').select('playing_group_id, player_id').in('playing_group_id', groupIds) : Promise.resolve({ data: [] as { playing_group_id: string; player_id: string }[] }),
  ])
  const playingGroupPlayersRaw = playingGroupPlayersRes.data ?? []

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

  // Wave 4: manual (team-less) group players + scores for this round's players.
  // Scores MUST be filtered by player id — an unfiltered select hits Supabase's
  // 1000-row cap once the table grows and silently drops this round's scores.
  const teamPlayers = playersRes.data ?? []
  const teamPlayerIdSet = new Set(teamPlayers.map((p) => p.id))
  const pgPlayerIds = playingGroupPlayersRaw.map((gp) => gp.player_id).filter((id) => !teamPlayerIdSet.has(id))
  const scorePlayerIds = [...teamPlayers.map((p) => p.id), ...pgPlayerIds]
  const [manualRes, scoresRes] = await Promise.all([
    pgPlayerIds.length
      ? sb.from('players').select('id, team_id, name, position, skins_participant, handicap, holes_range, roster_player_id').in('id', pgPlayerIds)
      : Promise.resolve({ data: [] as typeof teamPlayers }),
    scorePlayerIds.length
      ? sb.from('scores').select('player_id, hole_number, strokes').in('player_id', scorePlayerIds)
      : Promise.resolve({ data: [] as { player_id: string; hole_number: number; strokes: number }[] }),
  ])
  const manualGroupPlayersRaw = manualRes.data
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
      scorecardGroupId={scorecardGroupId}
      dtAssignments={assignmentsRes.data ?? []}
      matchups={matchups ?? []}
      bestBallMatchups={bestBallRes.data ?? []}
      medleyMatchups={(medleyRes.data ?? []) as { id: string; players: { id: string; front?: number | null; back?: number | null; total?: number | null }[]; bet_type: string; amount: number }[]}
      initialHoleValues={initialHoleValues}
      courses={coursesRes.data ?? []}
      playingGroups={playingGroupsRaw}
      playingGroupPlayers={playingGroupPlayersRaw}
      roster={rosterRes.data ?? []}
      hammerMatchups={hammerRes.data ?? []}
    />
  )
}
