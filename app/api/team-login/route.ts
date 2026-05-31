import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  const { teamId, pin } = await request.json()
  if (!teamId || !pin) {
    return NextResponse.json({ error: 'Select your group and enter your PIN.' }, { status: 400 })
  }
  const supabase = createServerClient()
  const { data: team } = await supabase
    .from('teams')
    .select('id, pin, is_admin')
    .eq('id', teamId)
    .single()

  if (!team || team.pin !== pin.trim()) {
    return NextResponse.json({ error: 'Incorrect PIN. Try again.' }, { status: 401 })
  }

  const response = NextResponse.json({ success: true, teamId })
  const opts = { httpOnly: true, sameSite: 'lax' as const, maxAge: 60 * 60 * 24, path: '/' }
  response.cookies.set(`team_auth_${teamId}`, 'true', opts)
  return response
}
