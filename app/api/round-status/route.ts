import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const roundId = searchParams.get('roundId') ?? ''
  if (!roundId) return NextResponse.json({ scores_cleared_at: null })

  const sb = createServerClient()
  const { data } = await sb.from('rounds').select('scores_cleared_at').eq('id', roundId).single()
  return NextResponse.json({ scores_cleared_at: data?.scores_cleared_at ?? null })
}
