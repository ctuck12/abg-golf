import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getOrgAuth } from '@/lib/org-auth'
import { createServerClient } from '@/lib/supabase-server'
import MatchupClient from '@/app/components/MatchupClient'

export const dynamic = 'force-dynamic'

export default async function OrgMatchupPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const auth = await getOrgAuth(orgSlug)
  if (!auth.ok) redirect(`/${orgSlug}`)

  const { orgId, isAdmin, isMaster } = auth
  const cookieStore = await cookies()
  const sb = createServerClient()

  const { data: orgRow } = await sb.from('organizations').select('name').eq('id', orgId).single()
  const orgName = orgRow?.name ?? orgSlug

  const { data: round } = await sb
    .from('rounds')
    .select('id, name, balls_count, format, is_started')
    .eq('is_active', true)
    .eq('org_id', orgId)
    .single()

  if (!round || !round.is_started) redirect(`/${orgSlug}`)

  const { data: teams } = await sb.from('teams').select('id, name').eq('round_id', round.id).order('name')
  const teamIds = (teams ?? []).map((t) => t.id)

  const [{ data: playersRaw }, { data: holes }, { data: scores }, matchupsRes, { data: savedBestBall }] = await Promise.all([
    teamIds.length
      ? sb.from('players').select('id, name, team_id').in('team_id', teamIds).order('name')
      : Promise.resolve({ data: [] }),
    sb.from('holes').select('hole_number, par').eq('round_id', round.id).order('hole_number'),
    sb.from('scores').select('player_id, hole_number, strokes'),
    sb.from('matchups').select('id, player1_id, player2_id, bet, press').eq('round_id', round.id).order('created_at'),
    sb.from('best_ball_matchups').select('id, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id, bet').eq('round_id', round.id).order('created_at'),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let savedMatchups: { id: string; player1_id: string; player2_id: string; bet: string; press: any[] }[]
  if (!matchupsRes.error) {
    savedMatchups = (matchupsRes.data ?? []) as typeof savedMatchups
  } else {
    const fallback = await sb.from('matchups').select('id, player1_id, player2_id, bet').eq('round_id', round.id).order('created_at')
    savedMatchups = (fallback.data ?? []).map((m) => ({ ...m, press: [] }))
  }

  const teamMap = Object.fromEntries((teams ?? []).map((t) => [t.id, t.name]))
  const players = (playersRaw ?? []).map((p) => ({ id: p.id, name: p.name, teamName: teamMap[p.team_id] ?? '' }))
  const scorecardTeamId = (teams ?? []).find((t) => cookieStore.get(`team_auth_${t.id}`)?.value === 'true')?.id ?? null

  return (
    <MatchupClient
      orgSlug={orgSlug}
      orgId={orgId}
      orgName={orgName}
      isMaster={isMaster}
      roundId={round.id}
      players={players}
      holes={holes ?? []}
      scores={scores ?? []}
      roundName={round.name}
      initialMatchups={savedMatchups ?? []}
      initialBestBallMatchups={savedBestBall ?? []}
      isAdmin={isAdmin}
      scorecardTeamId={scorecardTeamId}
      format={round.format ?? 'standard'}
      teams={teams ?? []}
    />
  )
}
