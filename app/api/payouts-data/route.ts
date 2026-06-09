import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const roundId = searchParams.get('roundId') ?? ''
  const isDaytona = searchParams.get('isDaytona') === 'true'
  const isDaytonaSideGame = searchParams.get('isDaytonaSideGame') === 'true'
  const bankerSideGame = searchParams.get('bankerSideGame') === 'true'

  if (!roundId) {
    return NextResponse.json({ teams: [], players: [], scores: [], ballValues: [], assignments: [], matchups: [], bestBallMatchups: [], holeValues: {}, bankerHolesAll: [], bankerBetsAll: [], holeStrokesAll: [] })
  }

  const supabase = createServerClient()

  const { data: teams } = await supabase
    .from('teams')
    .select('id, name, daytona_variant')
    .eq('round_id', roundId)

  const allTeamIds = (teams ?? []).map((t: { id: string }) => t.id)

  const allPlayersRes = await supabase
    .from('players')
    .select('id, team_id, name, position')
    .in('team_id', allTeamIds.length ? allTeamIds : [''])
    .order('position', { ascending: true })

  const allPlayerIds = (allPlayersRes.data ?? []).map((p: { id: string }) => p.id)

  const [
    { data: allScores },
    { data: ballValues },
    { data: dtAssignmentsRaw },
    { data: matchupsData },
    { data: bbMatchupsData },
    { data: dtHoleValuesRaw },
    { data: bankerHolesRaw },
    { data: bankerBetsRaw },
    { data: holeStrokesRaw },
  ] = await Promise.all([
    supabase.from('scores').select('player_id, hole_number, strokes').in('player_id', allPlayerIds.length ? allPlayerIds : ['']),
    supabase.from('ball_values').select('ball_number, value_dollars').eq('round_id', roundId).order('ball_number'),
    (isDaytona || isDaytonaSideGame)
      ? supabase.from('daytona_hole_assignments').select('player_id, hole_number, side').eq('round_id', roundId)
      : Promise.resolve({ data: [] }),
    supabase.from('matchups').select('id, player1_id, player2_id, bet').eq('round_id', roundId),
    supabase.from('best_ball_matchups').select('id, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id, bet').eq('round_id', roundId),
    (isDaytona || isDaytonaSideGame)
      ? supabase.from('daytona_hole_values').select('team_id, hole_number, value_per_point').eq('round_id', roundId)
      : Promise.resolve({ data: [] }),
    bankerSideGame && allTeamIds.length
      ? supabase.from('banker_holes').select('team_id, hole_number, banker_player_id, max_bet').eq('round_id', roundId).in('team_id', allTeamIds)
      : Promise.resolve({ data: [] }),
    bankerSideGame && allTeamIds.length
      ? supabase.from('banker_bets').select('team_id, hole_number, player_id, base_bet, player_doubled, banker_doubled').eq('round_id', roundId).in('team_id', allTeamIds)
      : Promise.resolve({ data: [] }),
    bankerSideGame && allPlayerIds.length
      ? supabase.from('hole_strokes').select('hole_number, player_id').eq('round_id', roundId).in('player_id', allPlayerIds)
      : Promise.resolve({ data: [] }),
  ])

  const holeValues: Record<string, Record<number, number>> = {}
  for (const hv of (dtHoleValuesRaw ?? []) as { team_id: string; hole_number: number; value_per_point: number }[]) {
    if (!holeValues[hv.team_id]) holeValues[hv.team_id] = {}
    holeValues[hv.team_id][hv.hole_number] = hv.value_per_point
  }

  return NextResponse.json({
    teams: teams ?? [],
    players: allPlayersRes.data ?? [],
    scores: allScores ?? [],
    ballValues: ballValues ?? [],
    assignments: dtAssignmentsRaw ?? [],
    matchups: matchupsData ?? [],
    bestBallMatchups: bbMatchupsData ?? [],
    holeValues,
    bankerHolesAll: bankerHolesRaw ?? [],
    bankerBetsAll: bankerBetsRaw ?? [],
    holeStrokesAll: holeStrokesRaw ?? [],
  })
}
