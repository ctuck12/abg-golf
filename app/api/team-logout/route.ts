import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase-server'

export async function POST() {
  const cookieStore = await cookies()
  const sb = createServerClient()

  const { data: roundRows } = await sb
    .from('rounds')
    .select('id')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
  const round = roundRows?.[0] ?? null

  if (round) {
    const { data: teams } = await sb.from('teams').select('id').eq('round_id', round.id)
    const authTeam = (teams ?? []).find(
      (t) => cookieStore.get(`team_auth_${t.id}`)?.value === 'true'
    )
    if (authTeam) {
      const response = NextResponse.json({ success: true })
      response.cookies.set(`team_auth_${authTeam.id}`, '', {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 0,
        path: '/',
      })
      return response
    }
  }

  return NextResponse.json({ success: true })
}
