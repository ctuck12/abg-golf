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
    .from('daytona_hole_values')
    .select('team_id, hole_number, value_per_point')
    .eq('round_id', roundId)
  return NextResponse.json(data ?? [])
}
