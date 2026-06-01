import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getOrgAuth } from '@/lib/org-auth'
import { createServerClient } from '@/lib/supabase-server'
import AllScorecardsView from '@/app/components/AllScorecardsView'
import { computePlayerDaytonaPoints, type DaytonaHoleAssignment } from '@/lib/scoring'

export const dynamic = 'force-dynamic'

export default async function OrgAllScorecardsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ teamId?: string }>
}) {
  const { orgSlug } = await params
  const auth = await getOrgAuth(orgSlug)
  if (!auth.ok) redirect(`/${orgSlug}`)

  const { orgId, isAdmin, isMaster } = auth
  const cookieStore = await cookies()
  const sb = createServerClient()
  const { teamId } = await searchParams

  const { data: orgRow } = await sb.from('organizations').select('name').eq('id', orgId).single()
  const orgName = orgRow?.name ?? orgSlug

  const { data: round } = await sb.from('rounds').select('id, format, daytona_variant').eq('is_active', true).eq('org_id', orgId).single()
  if (!round || round.format !== 'daytona') redirect(`/${orgSlug}`)

  const { data: allTeams } = await sb.from('teams').select('id, name, daytona_variant').eq('round_id', round.id)
  const teams = teamId ? (allTeams ?? []).filter((t: { id: string }) => t.id === teamId) : (allTeams ?? [])
  const teamIds = teams.map((t: { id: string }) => t.id)

  const { data: players } = await sb.from('players').select('id, name, team_id').in('team_id', teamIds.length ? teamIds : [''])
  const playerIds = (players ?? []).map((p: { id: string }) => p.id)

  const [{ data: holes }, { data: scores }, { data: assignments }, { data: holeValuesRaw }, { data: ballValuesRaw }] = await Promise.all([
    sb.from('holes').select('hole_number, par').eq('round_id', round.id).order('hole_number'),
    sb.from('scores').select('player_id, hole_number, strokes').in('player_id', playerIds.length ? playerIds : ['']),
    sb.from('daytona_hole_assignments').select('player_id, hole_number, side').eq('round_id', round.id),
    sb.from('daytona_hole_values').select('team_id, hole_number, value_per_point').eq('round_id', round.id),
    sb.from('ball_values').select('ball_number, value_dollars').eq('round_id', round.id),
  ])

  const dtPayoutValue = (ballValuesRaw as { ball_number: number; value_dollars: number }[] | null)?.find((bv) => bv.ball_number === 1)?.value_dollars ?? 0
  const teamHoleValues: Record<string, Record<number, number>> = {}
  for (const hv of (holeValuesRaw ?? []) as { team_id: string; hole_number: number; value_per_point: number }[]) {
    if (!teamHoleValues[hv.team_id]) teamHoleValues[hv.team_id] = {}
    teamHoleValues[hv.team_id][hv.hole_number] = hv.value_per_point
  }

  const daytonaVariant = (teams[0] as { daytona_variant?: string | null } | undefined)?.daytona_variant ?? round.daytona_variant ?? '4man'
  const pointsMap = computePlayerDaytonaPoints(holes ?? [], scores ?? [], (assignments ?? []) as DaytonaHoleAssignment[], daytonaVariant)
  const teamNameMap = Object.fromEntries(teams.map((t: { id: string; name: string }) => [t.id, t.name]))

  const rankedPlayers = (players ?? [])
    .map((p: { id: string; name: string; team_id: string }) => ({
      id: p.id, name: p.name, teamName: teamNameMap[p.team_id] ?? '', teamId: p.team_id,
      points: pointsMap.get(p.id) ?? 0,
      thru: (scores ?? []).filter((s: { player_id: string }) => s.player_id === p.id).length,
    }))
    .sort((a: { thru: number; points: number; name: string }, b: { thru: number; points: number; name: string }) => {
      if (a.thru === 0 && b.thru === 0) return a.name.localeCompare(b.name)
      if (a.thru === 0) return 1
      if (b.thru === 0) return -1
      return b.points - a.points
    })

  const scorecardTeamId = (allTeams ?? []).find((t: { id: string }) => cookieStore.get(`team_auth_${t.id}`)?.value === 'true')?.id ?? null

  return (
    <AllScorecardsView
      orgSlug={orgSlug}
      orgId={orgId}
      orgName={orgName}
      isMaster={isMaster}
      roundId={round.id}
      players={rankedPlayers}
      allPlayerIds={playerIds}
      holes={holes ?? []}
      initialScores={scores ?? []}
      initialAssignments={(assignments ?? []) as DaytonaHoleAssignment[]}
      daytonaVariant={daytonaVariant}
      isAdmin={isAdmin}
      scorecardTeamId={scorecardTeamId}
      teamHoleValues={teamHoleValues}
      dtPayoutValue={dtPayoutValue}
    />
  )
}
