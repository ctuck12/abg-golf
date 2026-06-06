import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getOrgAuth } from '@/lib/org-auth'
import { createServerClient } from '@/lib/supabase-server'
import ScorecardViewer from '@/app/components/ScorecardViewer'

export const dynamic = 'force-dynamic'

export default async function OrgScorecardPage({ params }: { params: Promise<{ orgSlug: string; teamId: string }> }) {
  const { orgSlug, teamId } = await params
  const auth = await getOrgAuth(orgSlug)
  if (!auth.ok) redirect(`/${orgSlug}`)

  const { orgId, isAdmin, isMaster } = auth
  const cookieStore = await cookies()
  const sb = createServerClient()

  const { data: orgRow } = await sb.from('organizations').select('name').eq('id', orgId).single()
  const orgName = orgRow?.name ?? orgSlug

  const { data: team } = await sb.from('teams').select('id, name, round_id, daytona_variant').eq('id', teamId).single()
  if (!team) redirect(`/${orgSlug}`)

  const { data: round } = await sb.from('rounds').select('id, balls_count, format, daytona_variant, include_total, org_id').eq('id', team.round_id).single()
  if (!round || round.org_id !== orgId) redirect(`/${orgSlug}`)

  const { data: allTeams } = await sb.from('teams').select('id').eq('round_id', round.id)
  const scorecardTeamId = (allTeams ?? []).find((t) => cookieStore.get(`team_auth_${t.id}`)?.value === 'true')?.id ?? null

  const { data: players } = await sb.from('players').select('id, name').eq('team_id', teamId).order('name')
  const playerIds = (players ?? []).map((p) => p.id)
  const isDaytona = (round.format ?? 'standard') === 'daytona'

  const [{ data: holes }, { data: scores }, { data: assignments }, { data: holeValuesRaw }, { data: ballValuesRaw }, { data: holeStrokesRaw }] = await Promise.all([
    sb.from('holes').select('hole_number, par, stroke_index').eq('round_id', round.id).order('hole_number'),
    sb.from('scores').select('player_id, hole_number, strokes').in('player_id', playerIds.length ? playerIds : ['']),
    isDaytona && playerIds.length
      ? sb.from('daytona_hole_assignments').select('player_id, hole_number, side').eq('round_id', round.id).in('player_id', playerIds)
      : Promise.resolve({ data: [] }),
    isDaytona ? sb.from('daytona_hole_values').select('hole_number, value_per_point').eq('round_id', round.id).eq('team_id', teamId) : Promise.resolve({ data: [] }),
    sb.from('ball_values').select('ball_number, value_dollars').eq('round_id', round.id),
    playerIds.length ? sb.from('hole_strokes').select('hole_number, player_id').eq('round_id', round.id).in('player_id', playerIds) : Promise.resolve({ data: [] }),
  ])
  const holeStrokes: Record<string, number[]> = {}
  for (const hs of (holeStrokesRaw ?? []) as { hole_number: number; player_id: string }[]) {
    if (!holeStrokes[hs.player_id]) holeStrokes[hs.player_id] = []
    holeStrokes[hs.player_id].push(hs.hole_number)
  }

  const dtPayoutValue = (ballValuesRaw as { ball_number: number; value_dollars: number }[] | null)?.find((bv) => bv.ball_number === 1)?.value_dollars ?? 0
  const pressedHoles: Record<number, number> = {}
  for (const hv of (holeValuesRaw ?? []) as { hole_number: number; value_per_point: number }[]) {
    pressedHoles[hv.hole_number] = hv.value_per_point
  }

  return (
    <ScorecardViewer
      orgSlug={orgSlug}
      orgId={orgId}
      orgName={orgName}
      isMaster={isMaster}
      teamName={team.name}
      players={players ?? []}
      holes={holes ?? []}
      scores={scores ?? []}
      ballsCount={round.balls_count}
      format={round.format ?? 'standard'}
      daytonaVariant={(team as { daytona_variant?: string | null }).daytona_variant ?? '4man'}
      dtAssignments={assignments ?? []}
      isAdmin={isAdmin}
      pressedHoles={pressedHoles}
      dtPayoutValue={dtPayoutValue}
      holeStrokes={holeStrokes}
      scorecardTeamId={scorecardTeamId}
      includeTotal={round.include_total ?? false}
    />
  )
}
