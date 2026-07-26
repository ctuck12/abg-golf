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
    .select('id, name, balls_count, format, is_started, mixed_groups, handicap_rounding')
    .eq('is_active', true)
    .eq('org_id', orgId)
    .single()

  if (!round || !round.is_started) redirect(`/${orgSlug}`)

  const isMixedGroups = round.mixed_groups ?? false

  const { data: teams } = await sb.from('teams').select('id, name').eq('round_id', round.id).order('name')
  const teamIds = (teams ?? []).map((t) => t.id)

  const { data: playingGroupsRaw } = isMixedGroups
    ? await sb.from('playing_groups').select('id, name').eq('round_id', round.id).order('name')
    : { data: [] as { id: string; name: string }[] }
  const groupIds = (playingGroupsRaw ?? []).map((g) => g.id)

  const [{ data: playersRaw }, { data: holes }, { data: scores }, matchupsRes, bestBallRes, { data: groupLinks }, medleyRes] = await Promise.all([
    teamIds.length
      ? sb.from('players').select('id, name, team_id, handicap, holes_range').in('team_id', teamIds).order('name')
      : Promise.resolve({ data: [] as { id: string; name: string; team_id: string; handicap: number | null; holes_range: string | null }[] }),
    sb.from('holes').select('hole_number, par, stroke_index').eq('round_id', round.id).order('hole_number'),
    sb.from('scores').select('player_id, hole_number, strokes'),
    sb.from('matchups').select('id, player1_id, player2_id, bet, press, hole_range').eq('round_id', round.id).order('created_at'),
    sb.from('best_ball_matchups').select('id, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id, bet, press, hole_range, player_strokes').eq('round_id', round.id).order('created_at'),
    isMixedGroups && groupIds.length
      ? sb.from('playing_group_players').select('player_id, playing_group_id').in('playing_group_id', groupIds)
      : Promise.resolve({ data: [] as { player_id: string; playing_group_id: string }[] }),
    sb.from('medley_matchups').select('id, players, bet_type, amount').eq('round_id', round.id).order('created_at'),
  ])

  // Build group name lookup and player→group map
  const groupMap = Object.fromEntries((playingGroupsRaw ?? []).map((g) => [g.id, g.name]))
  const playerToGroup: Record<string, string> = {}
  for (const r of (groupLinks ?? [])) playerToGroup[r.player_id] = groupMap[r.playing_group_id] ?? ''

  // Fetch guest players (team_id = null) who are in a playing group
  const teamPlayerIdSet = new Set((playersRaw ?? []).map((p) => p.id))
  const guestIds = (groupLinks ?? []).map((r) => r.player_id).filter((id) => !teamPlayerIdSet.has(id))
  const { data: guestPlayersRaw } = guestIds.length
    ? await sb.from('players').select('id, name, handicap, holes_range').in('id', guestIds)
    : { data: [] as { id: string; name: string; handicap: number | null; holes_range: string | null }[] }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let savedMatchups: { id: string; player1_id: string; player2_id: string; bet: string; press: any[] }[]
  if (!matchupsRes.error) {
    savedMatchups = (matchupsRes.data ?? []) as typeof savedMatchups
  } else {
    const fallback = await sb.from('matchups').select('id, player1_id, player2_id, bet').eq('round_id', round.id).order('created_at')
    savedMatchups = (fallback.data ?? []).map((m) => ({ ...m, press: [] }))
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let savedBestBall: { id: string; team1_player1_id: string; team1_player2_id: string; team2_player1_id: string; team2_player2_id: string; bet: string; press: any[] }[]
  if (!bestBallRes.error) {
    savedBestBall = (bestBallRes.data ?? []) as typeof savedBestBall
  } else {
    const fallback = await sb.from('best_ball_matchups').select('id, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id, bet').eq('round_id', round.id).order('created_at')
    savedBestBall = (fallback.data ?? []).map((m) => ({ ...m, press: [] }))
  }

  const teamMap = Object.fromEntries((teams ?? []).map((t) => [t.id, t.name]))
  const teamPlayers = (playersRaw ?? []).map((p) => ({ id: p.id, name: p.name, teamName: teamMap[p.team_id] ?? '', handicap: p.handicap ?? null, holes_range: p.holes_range ?? null }))
  const guestPlayers = (guestPlayersRaw ?? []).map((p) => ({ id: p.id, name: p.name, teamName: playerToGroup[p.id] ?? '', handicap: p.handicap ?? null, holes_range: p.holes_range ?? null }))
  const players = [...teamPlayers, ...guestPlayers].sort((a, b) => a.name.localeCompare(b.name))

  const scorecardTeamId = (teams ?? []).find((t) => cookieStore.get(`team_auth_${t.id}`)?.value === 'true')?.id ?? null
  // Only honor group cookies for the current round's playing groups (ignore stale rounds)
  const scorecardGroupId = groupIds.find((id) => cookieStore.get(`playing_group_auth_${id}`)?.value === 'true') ?? null

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
      handicapRounding={(round as { handicap_rounding?: string | null }).handicap_rounding ?? 'down'}
      initialMedleyMatchups={(medleyRes.data ?? []) as { id: string; players: { id: string; front?: number | null; back?: number | null; total?: number | null }[]; bet_type: string; amount: number }[]}
      isAdmin={isAdmin}
      scorecardTeamId={scorecardTeamId}
      format={round.format ?? 'standard'}
      teams={teams ?? []}
      isMixedGroups={isMixedGroups}
      playingGroups={playingGroupsRaw ?? []}
      scorecardGroupId={scorecardGroupId}
    />
  )
}
