import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const roundId = searchParams.get('roundId') ?? ''
  if (!roundId) {
    return NextResponse.json([])
  }
  const supabase = createServerClient()
  const { data } = await supabase
    .from('matchups')
    .select('id, player1_id, player2_id, bet, press')
    .eq('round_id', roundId)
    .order('created_at')
  return NextResponse.json(data ?? [])
}
