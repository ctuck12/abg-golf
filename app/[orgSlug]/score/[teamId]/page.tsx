import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getOrgAuth } from '@/lib/org-auth'
import { createServerClient } from '@/lib/supabase-server'
import ScoreEntry from '@/app/components/ScoreEntry'

export const dynamic = 'force-dynamic'

export default async function OrgScorePage({ params }: { params: Promise<{ orgSlug: string; teamId: string }> }) {
  const { orgSlug, teamId } = await params
  const cookieStore = await cookies()

  if (!cookieStore.get(`team_auth_${teamId}`)?.value) redirect(`/${orgSlug}`)

  const auth = await getOrgAuth(orgSlug)
  if (!auth.ok) redirect(`/${orgSlug}`)

  const { orgId, isAdmin, isMaster } = auth
  const sb = createServerClient()

  const [{ data: orgRow }, { data: team }] = await Promise.all([
    sb.from('organizations').select('name').eq('id', orgId).single(),
    sb.from('teams').select('id, name, round_id, is_admin, daytona_variant, banker_side_game, banker_side_game_min_bet, auto_strokes').eq('id', teamId).single(),
  ])

  if (!team) redirect(`/${orgSlug}`)
  const orgName = orgRow?.name ?? orgSlug

  const { data: round } = await sb
    .from('rounds').select('id, balls_count, format, daytona_variant, is_active, is_started, include_total, org_id, auto_handicap, banker_min_bet').eq('id', team.round_id).single()
  if (!round || !round.is_active || round.org_id !== orgId) redirect(`/${orgSlug}`)

  const { data: players } = await sb.from('players').select('id, name, handicap').eq('team_id', teamId).order('position', { ascending: true })
  const playerIds = (players ?? []).map((p) => p.id)

  const isDaytona = (round.format ?? 'standard') === 'daytona'
  const isTraditional = (round.format ?? 'standard') === 'traditional'
  const isStandard = (round.format ?? 'standard') === 'standard'
  const teamDaytonaRaw = (team as { daytona_variant?: string | null }).daytona_variant ?? null
  const isDaytonaSideGame = (isTraditional || isStandard) && !!teamDaytonaRaw
  const teamBankerSideGame = !!(team as { banker_side_game?: boolean }).banker_side_game
  const teamBankerMinBet = (team as { banker_side_game_min_bet?: number | null }).banker_side_game_min_bet ?? 2
  const teamAutoStrokes = !!(team as { auto_strokes?: boolean }).auto_strokes
  const [parsedDaytonaVariant, parsedPayoutStr] = teamDaytonaRaw?.includes('|')
    ? teamDaytonaRaw.split('|') : [teamDaytonaRaw ?? '4man', null]
  const sideGamePayout = parsedPayoutStr ? (parseFloat(parsedPayoutStr) || 0) : 0

  const { data: allTeams } = await sb.from('teams').select('id').eq('round_id', team.round_id)
  const allTeamIds = (allTeams ?? []).map((t) => t.id)
  const [{ data: allRoundPlayersRaw }, { data: holeStrokesRaw }] = await Promise.all([
    allTeamIds.length ? sb.from('players').select('id, handicap').in('team_id', allTeamIds) : Promise.resolve({ data: [] }),
    sb.from('hole_strokes').select('hole_number, player_id').eq('round_id', round.id),
  ])
  const roundPlayerIds = (allRoundPlayersRaw ?? []).map((p: { id: string }) => p.id)
  const allRoundPlayerHandicaps: Record<string, number | null> = {}
  for (const p of (allRoundPlayersRaw ?? []) as { id: string; handicap?: number | null }[]) {
    allRoundPlayerHandicaps[p.id] = p.handicap ?? null
  }
  const initialHoleStrokes: Record<number, string[]> = {}
  for (const hs of (holeStrokesRaw ?? []) as { hole_number: number; player_id: string }[]) {
    if (!initialHoleStrokes[hs.hole_number]) initialHoleStrokes[hs.hole_number] = []
    initialHoleStrokes[hs.hole_number].push(hs.player_id)
  }

  const isBanker = (round.format ?? 'standard') === 'banker'
  const [{ data: holes }, { data: scores }, { data: assignments }, { data: ballValuesRaw }, { data: holeValuesRaw }, { data: bankerHolesRaw }, { data: bankerBetsRaw }] = await Promise.all([
    sb.from('holes').select('hole_number, par, stroke_index').eq('round_id', round.id).order('hole_number'),
    sb.from('scores').select('player_id, hole_number, strokes').in('player_id', playerIds.length ? playerIds : ['']),
    (isDaytona || isDaytonaSideGame) && playerIds.length
      ? sb.from('daytona_hole_assignments').select('player_id, hole_number, side').eq('round_id', round.id).in('player_id', playerIds)
      : Promise.resolve({ data: [] }),
    isDaytona ? sb.from('ball_values').select('ball_number, value_dollars').eq('round_id', round.id).order('ball_number') : Promise.resolve({ data: [] }),
    (isDaytona || isDaytonaSideGame) ? sb.from('daytona_hole_values').select('hole_number, value_per_point').eq('round_id', round.id).eq('team_id', team.id) : Promise.resolve({ data: [] }),
    isBanker ? sb.from('banker_holes').select('hole_number, banker_player_id, max_bet').eq('round_id', round.id).eq('team_id', team.id) : Promise.resolve({ data: [] }),
    isBanker ? sb.from('banker_bets').select('hole_number, player_id, base_bet, player_doubled, banker_doubled').eq('round_id', round.id).eq('team_id', team.id) : Promise.resolve({ data: [] }),
  ])

  const initialBankerHoles: Record<number, { bankerPlayerId: string | null; maxBet: number }> = {}
  for (const bh of (bankerHolesRaw ?? []) as { hole_number: number; banker_player_id: string | null; max_bet: number }[]) {
    initialBankerHoles[bh.hole_number] = { bankerPlayerId: bh.banker_player_id, maxBet: bh.max_bet }
  }
  const initialBankerBets: Record<number, Record<string, { baseBet: number; playerDoubled: boolean; bankerDoubled: boolean }>> = {}
  for (const bb of (bankerBetsRaw ?? []) as { hole_number: number; player_id: string; base_bet: number; player_doubled: boolean; banker_doubled: boolean }[]) {
    if (!initialBankerBets[bb.hole_number]) initialBankerBets[bb.hole_number] = {}
    initialBankerBets[bb.hole_number][bb.player_id] = { baseBet: bb.base_bet, playerDoubled: bb.player_doubled, bankerDoubled: bb.banker_doubled }
  }

  const defaultDtPayoutValue = isDaytonaSideGame
    ? sideGamePayout
    : (isDaytona ? (ballValuesRaw ?? []).find((bv: { ball_number: number }) => bv.ball_number === 1) : null)?.value_dollars ?? 0.25
  const initialHoleValues: Record<number, number> = {}
  for (const hv of (holeValuesRaw ?? []) as { hole_number: number; value_per_point: number }[]) {
    initialHoleValues[hv.hole_number] = hv.value_per_point
  }

  return (
    <ScoreEntry
      orgSlug={orgSlug}
      orgId={orgId}
      orgName={orgName}
      isMaster={isMaster}
      team={{ id: team.id, name: team.name }}
      players={players ?? []}
      holes={holes ?? []}
      initialScores={scores ?? []}
      ballsCount={round.balls_count}
      format={round.format ?? 'standard'}
      daytonaVariant={isDaytonaSideGame ? parsedDaytonaVariant : ((team as { daytona_variant?: string | null }).daytona_variant?.split('|')[0] ?? round.daytona_variant ?? '4man')}
      isDaytonaSideGame={isDaytonaSideGame}
      isAdmin={isAdmin}
      isStarted={round.is_started ?? false}
      roundId={round.id}
      initialAssignments={assignments ?? []}
      roundPlayerIds={roundPlayerIds}
      includeTotal={round.include_total ?? false}
      initialHoleValues={initialHoleValues}
      defaultDtPayoutValue={defaultDtPayoutValue}
      autoHandicap={(isDaytonaSideGame || teamBankerSideGame) ? teamAutoStrokes : (round.auto_handicap ?? false)}
      allRoundPlayerHandicaps={(() => {
        // For side games, use team-only handicaps so strokes are relative to best player on the team
        if (isDaytonaSideGame || teamBankerSideGame) {
          const teamHcps: Record<string, number | null> = {}
          for (const p of (players ?? []) as { id: string; handicap?: number | null }[]) {
            teamHcps[p.id] = p.handicap ?? null
          }
          return teamHcps
        }
        return allRoundPlayerHandicaps
      })()}
      initialHoleStrokes={initialHoleStrokes}
      bankerMinBet={teamBankerSideGame ? teamBankerMinBet : (round.banker_min_bet ?? 2)}
      bankerSideGame={teamBankerSideGame}
      initialBankerHoles={initialBankerHoles}
      initialBankerBets={initialBankerBets}
    />
  )
}
