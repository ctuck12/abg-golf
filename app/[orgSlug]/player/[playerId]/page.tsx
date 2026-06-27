import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getOrgAuth } from '@/lib/org-auth'
import { createServerClient } from '@/lib/supabase-server'
import PlayerScorecard from '@/app/components/PlayerScorecard'
import type { DaytonaHoleAssignment } from '@/lib/scoring'

export const dynamic = 'force-dynamic'

export default async function OrgPlayerPage({ params, searchParams }: { params: Promise<{ orgSlug: string; playerId: string }>; searchParams: Promise<{ simple?: string }> }) {
  const { orgSlug, playerId } = await params
  const { simple } = await searchParams
  const simpleView = simple === '1'
  const auth = await getOrgAuth(orgSlug)
  if (!auth.ok) redirect(`/${orgSlug}`)

  const { orgId, isAdmin, isMaster } = auth
  const cookieStore = await cookies()
  const sb = createServerClient()

  const { data: orgRow } = await sb.from('organizations').select('name').eq('id', orgId).single()
  const orgName = orgRow?.name ?? orgSlug

  const { data: player } = await sb.from('players').select('id, name, team_id, handicap').eq('id', playerId).single()
  if (!player) redirect(`/${orgSlug}`)

  let teamId: string | null = null
  let teamName = ''
  let roundId = ''
  let roundFormat = 'standard'
  let teamDaytonaVariant: string | null = null

  if (player.team_id) {
    const { data: team } = await sb.from('teams').select('id, name, round_id, daytona_variant').eq('id', player.team_id).single()
    if (!team) redirect(`/${orgSlug}`)

    const { data: round } = await sb.from('rounds').select('id, is_started, format, daytona_variant, org_id').eq('id', team.round_id).single()
    if (!round || !round.is_started || round.org_id !== orgId) redirect(`/${orgSlug}`)

    teamId = team.id
    teamName = team.name
    roundId = round.id
    roundFormat = round.format ?? 'standard'
    teamDaytonaVariant = (team as { daytona_variant?: string | null }).daytona_variant ?? null
  } else {
    // Manually-added player with no team — find via playing_group_players
    const { data: groupPlayer } = await sb.from('playing_group_players').select('playing_group_id').eq('player_id', playerId).single()
    if (!groupPlayer) redirect(`/${orgSlug}`)

    const { data: group } = await sb.from('playing_groups').select('id, name, round_id').eq('id', groupPlayer.playing_group_id).single()
    if (!group) redirect(`/${orgSlug}`)

    const { data: round } = await sb.from('rounds').select('id, is_started, format, org_id').eq('id', group.round_id).single()
    if (!round || !round.is_started || round.org_id !== orgId) redirect(`/${orgSlug}`)

    teamId = null
    teamName = group.name
    roundId = round.id
    roundFormat = round.format ?? 'standard'
  }

  const { data: allTeams } = await sb.from('teams').select('id').eq('round_id', roundId)
  const scorecardTeamId = (allTeams ?? []).find((t) => cookieStore.get(`team_auth_${t.id}`)?.value === 'true')?.id ?? (isAdmin && teamId ? teamId : null)
  const groupAuthCookie = cookieStore.getAll().find((c) => c.name.startsWith('playing_group_auth_') && c.value === 'true')
  const scorecardGroupId = groupAuthCookie ? groupAuthCookie.name.replace('playing_group_auth_', '') : null

  const [{ data: holes }, { data: scores }, { data: holeStrokesRaw }] = await Promise.all([
    sb.from('holes').select('hole_number, par, stroke_index').eq('round_id', roundId).order('hole_number'),
    sb.from('scores').select('hole_number, strokes').eq('player_id', playerId),
    sb.from('hole_strokes').select('hole_number').eq('round_id', roundId).eq('player_id', playerId),
  ])
  const strokeHoles = (holeStrokesRaw ?? []).map((r: { hole_number: number }) => r.hole_number)

  let dtData: Parameters<typeof PlayerScorecard>[0]['dtData']

  if (roundFormat === 'daytona' && teamId && !simpleView) {
    const { data: teamPlayers } = await sb.from('players').select('id, handicap').eq('team_id', teamId)
    const teamPlayersTyped = (teamPlayers ?? []) as { id: string; handicap?: number | null }[]
    const teamPlayerIds = teamPlayersTyped.map((p) => p.id)
    const [{ data: assignmentsData }, { data: allScoresData }, { data: holeValuesRaw }, { data: ballValuesRaw }, { data: allTeamHoleStrokesData }] = await Promise.all([
      teamPlayerIds.length
        ? sb.from('daytona_hole_assignments').select('player_id, hole_number, side').eq('round_id', roundId).in('player_id', teamPlayerIds)
        : Promise.resolve({ data: [] }),
      teamPlayerIds.length
        ? sb.from('scores').select('player_id, hole_number, strokes').in('player_id', teamPlayerIds)
        : Promise.resolve({ data: [] }),
      sb.from('daytona_hole_values').select('hole_number, value_per_point').eq('round_id', roundId).eq('team_id', teamId),
      sb.from('ball_values').select('ball_number, value_dollars').eq('round_id', roundId),
      teamPlayerIds.length
        ? sb.from('hole_strokes').select('player_id, hole_number').eq('round_id', roundId).in('player_id', teamPlayerIds)
        : Promise.resolve({ data: [] }),
    ])
    const pressedHoles: Record<number, number> = {}
    for (const hv of (holeValuesRaw ?? []) as { hole_number: number; value_per_point: number }[]) {
      pressedHoles[hv.hole_number] = hv.value_per_point
    }
    const dtPayoutValue = (ballValuesRaw as { ball_number: number; value_dollars: number }[] | null)?.find((bv) => bv.ball_number === 1)?.value_dollars ?? 0
    const playerHandicaps: Record<string, number | null> = {}
    for (const tp of teamPlayersTyped) playerHandicaps[tp.id] = tp.handicap ?? null
    const hcpVals = Object.values(playerHandicaps).filter((h): h is number => h != null)
    const minTeamHcp: number | null = hcpVals.length ? Math.min(...hcpVals) : null
    const holeStrokeMap: Record<number, string[]> = {}
    for (const r of (allTeamHoleStrokesData ?? []) as { player_id: string; hole_number: number }[]) {
      if (!holeStrokeMap[r.hole_number]) holeStrokeMap[r.hole_number] = []
      holeStrokeMap[r.hole_number].push(r.player_id)
    }
    dtData = {
      roundId,
      allPlayerIds: teamPlayerIds,
      assignments: (assignmentsData ?? []) as DaytonaHoleAssignment[],
      allRoundScores: allScoresData ?? [],
      daytonaVariant: teamDaytonaVariant ?? '4man',
      pressedHoles,
      dtPayoutValue,
      playerHandicaps,
      minTeamHcp,
      holeStrokeMap,
    }
  }

  return (
    <PlayerScorecard
      orgSlug={orgSlug}
      orgId={orgId}
      orgName={orgName}
      isMaster={isMaster}
      player={{ id: player.id, name: player.name, handicap: (player as { handicap?: number | null }).handicap ?? null }}
      teamName={teamName}
      teamId={teamId}
      holes={holes ?? []}
      scores={scores ?? []}
      format={simpleView ? 'standard' : roundFormat}
      dtData={dtData}
      isAdmin={isAdmin}
      strokeHoles={strokeHoles}
      scorecardTeamId={scorecardTeamId}
      scorecardGroupId={scorecardGroupId}
    />
  )
}
