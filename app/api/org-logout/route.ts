import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function POST(request: NextRequest) {
  const { orgId } = await request.json()
  if (!orgId) return NextResponse.json({ error: 'Missing orgId.' }, { status: 400 })
  const cookieStore = await cookies()
  const response = NextResponse.json({ success: true })
  const clear = { httpOnly: true, sameSite: 'lax' as const, maxAge: 0, path: '/' }
  response.cookies.set(`org_member_${orgId}`, '', clear)
  response.cookies.set(`org_admin_${orgId}`, '', clear)
  for (const c of cookieStore.getAll()) {
    if (c.name.startsWith('team_auth_')) {
      response.cookies.set(c.name, '', clear)
    }
  }
  return response
}
