import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const roundId = searchParams.get('roundId') ?? ''
  const teamIdsParam = searchParams.get('teamIds') ?? ''
  const teamIds = teamIdsParam ? teamIdsParam.split(',').filter(Boolean) : []
  if (!roundId || teamIds.length === 0) {
    return NextResponse.json({ holes: [], bets: [] })
  }
  const supabase = createServerClient()
  const [{ data: holes }, { data: bets }] = await Promise.all([
    supabase
      .from('banker_holes')
      .select('team_id, hole_number, banker_player_id, max_bet')
      .eq('round_id', roundId)
      .in('team_id', teamIds),
    supabase
      .from('banker_bets')
      .select('team_id, hole_number, player_id, base_bet, player_doubled, banker_doubled')
      .eq('round_id', roundId)
      .in('team_id', teamIds),
  ])
  return NextResponse.json({ holes: holes ?? [], bets: bets ?? [] })
}
