import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getOrgAuth } from '@/lib/org-auth'
import { createServerClient } from '@/lib/supabase-server'
import HammerScoreEntry from '@/app/components/HammerScoreEntry'

export const dynamic = 'force-dynamic'

export default async function HammerScorecardPage({
  params,
}: { params: Promise<{ orgSlug: string; matchupId: string }> }) {
  const { orgSlug, matchupId } = await params
  const cookieStore = await cookies()
  const auth = await getOrgAuth(orgSlug)
  if (!auth.ok) redirect(`/${orgSlug}`)
  const { orgId, isAdmin, isMaster } = auth

  const sb = createServerClient()
  const { data: matchup } = await sb
    .from('hammer_matchups')
    .select('id, round_id, team1_id, team2_id, base_bet, auto_handicap')
    .eq('id', matchupId).single()
  if (!matchup) redirect(`/${orgSlug}`)

  // Auth: either team's PIN works
  const hasAuth = cookieStore.get(`team_auth_${matchup.team1_id}`)?.value === 'true' ||
                  cookieStore.get(`team_auth_${matchup.team2_id}`)?.value === 'true'
  if (!hasAuth) redirect(`/${orgSlug}`)

  const { data: round } = await sb
    .from('rounds').select('id, name, date, course, format, org_id, is_active, is_started, auto_handicap')
    .eq('id', matchup.round_id).single()
  if (!round || !round.is_active || round.org_id !== orgId) redirect(`/${orgSlug}`)

  const { data: orgRow } = await sb.from('organizations').select('name').eq('id', orgId).single()
  const orgName = orgRow?.name ?? orgSlug

  const [{ data: team1Raw }, { data: team2Raw }] = await Promise.all([
    sb.from('teams').select('id, name').eq('id', matchup.team1_id).single(),
    sb.from('teams').select('id, name').eq('id', matchup.team2_id).single(),
  ])
  if (!team1Raw || !team2Raw) redirect(`/${orgSlug}`)

  const [{ data: team1Players }, { data: team2Players }] = await Promise.all([
    sb.from('players').select('id, name, team_id, position, handicap').eq('team_id', matchup.team1_id).order('position'),
    sb.from('players').select('id, name, team_id, position, handicap').eq('team_id', matchup.team2_id).order('position'),
  ])
  const allPlayers = [...(team1Players ?? []), ...(team2Players ?? [])]
  const allPlayerIds = allPlayers.map((p) => p.id)

  const allPlayerHandicaps: Record<string, number | null> = {}
  for (const p of allPlayers) allPlayerHandicaps[p.id] = (p as { handicap?: number | null }).handicap ?? null

  const [{ data: holes }, { data: scores }, { data: hammerHolesRaw }, { data: holeStrokesRaw }] = await Promise.all([
    sb.from('holes').select('hole_number, par, stroke_index').eq('round_id', matchup.round_id).order('hole_number'),
    sb.from('scores').select('player_id, hole_number, strokes').in('player_id', allPlayerIds.length ? allPlayerIds : ['']),
    sb.from('hammer_holes').select('hole_number, stake, last_hammer_team, folded_team, pre_tee_used').eq('matchup_id', matchupId),
    sb.from('hole_strokes').select('hole_number, player_id').eq('round_id', matchup.round_id),
  ])

  const initialHammerHoles: Record<number, { stake: number; lastHammerTeam: 1 | 2 | null; foldedTeam: 1 | 2 | null; preTeeUsed: boolean }> = {}
  for (const hh of (hammerHolesRaw ?? []) as { hole_number: number; stake: number; last_hammer_team: number | null; folded_team: number | null; pre_tee_used: boolean }[]) {
    initialHammerHoles[hh.hole_number] = {
      stake: hh.stake,
      lastHammerTeam: (hh.last_hammer_team as 1 | 2 | null),
      foldedTeam: (hh.folded_team as 1 | 2 | null),
      preTeeUsed: hh.pre_tee_used,
    }
  }

  const initialHoleStrokes: Record<number, string[]> = {}
  for (const hs of (holeStrokesRaw ?? []) as { hole_number: number; player_id: string }[]) {
    if (!initialHoleStrokes[hs.hole_number]) initialHoleStrokes[hs.hole_number] = []
    initialHoleStrokes[hs.hole_number].push(hs.player_id)
  }

  return (
    <HammerScoreEntry
      orgSlug={orgSlug}
      orgId={orgId}
      orgName={orgName}
      isMaster={isMaster}
      isAdmin={isAdmin}
      matchupId={matchupId}
      roundId={matchup.round_id}
      roundName={round.name}
      roundDate={round.date}
      roundCourse={round.course ?? ''}
      team1={{ id: team1Raw.id, name: team1Raw.name }}
      team2={{ id: team2Raw.id, name: team2Raw.name }}
      allPlayers={allPlayers}
      holes={holes ?? []}
      initialScores={scores ?? []}
      baseBet={matchup.base_bet}
      autoHandicap={matchup.auto_handicap ?? false}
      allPlayerHandicaps={allPlayerHandicaps}
      initialHoleStrokes={initialHoleStrokes}
      initialHammerHoles={initialHammerHoles}
      isStarted={round.is_started ?? false}
    />
  )
}
