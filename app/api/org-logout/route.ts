import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { orgId } = await request.json()
  if (!orgId) return NextResponse.json({ error: 'Missing orgId.' }, { status: 400 })
  const response = NextResponse.json({ success: true })
  const clear = { httpOnly: true, sameSite: 'lax' as const, maxAge: 0, path: '/' }
  response.cookies.set(`org_member_${orgId}`, '', clear)
  response.cookies.set(`org_admin_${orgId}`, '', clear)
  return response
}
