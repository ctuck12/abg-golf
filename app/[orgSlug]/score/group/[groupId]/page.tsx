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

  if (!cookieStore.get(`playing_group_auth_${groupId}`)?.value) redirect(`/${orgSlug}`)

  const auth = await getOrgAuth(orgSlug)
  if (!auth.ok) redirect(`/${orgSlug}`)
  const { orgId, isAdmin, isMaster } = auth

  const sb = createServerClient()

  const { data: group } = await sb
    .from('playing_groups')
    .select('id, name, round_id')
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

  const [{ data: holes }, { data: allScores }, { data: ballValuesRaw }] = await Promise.all([
    sb.from('holes').select('hole_number, par').eq('round_id', round.id).order('hole_number'),
    sb.from('scores').select('player_id, hole_number, strokes').in('player_id', allPlayerIds.length ? allPlayerIds : ['']),
    sb.from('ball_values').select('ball_number, value_dollars').eq('round_id', round.id).order('ball_number'),
  ])

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
    />
  )
}
