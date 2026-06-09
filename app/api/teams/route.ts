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
    .from('teams')
    .select('id, name')
    .eq('round_id', roundId)
    .order('name')
  return NextResponse.json(data ?? [])
}
