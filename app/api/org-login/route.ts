import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { requireMasterAuth } from '@/lib/org-auth'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { slug, password, _masterOverride } = body

  if (!slug) return NextResponse.json({ error: 'Missing slug.' }, { status: 400 })

  const sb = createServerClient()
  const { data: org } = await sb
    .from('organizations')
    .select('id, group_password, admin_password, is_active')
    .eq('slug', slug)
    .single()

  if (!org || !org.is_active) return NextResponse.json({ error: 'Group not found.' }, { status: 404 })

  // Master admin can enter any org without a password
  if (_masterOverride && (await requireMasterAuth())) {
    const response = NextResponse.json({ success: true, isAdmin: true, slug })
    const opts = { httpOnly: true, sameSite: 'lax' as const, maxAge: 60 * 60 * 24 * 7, path: '/' }
    response.cookies.set(`org_member_${org.id}`, 'true', opts)
    response.cookies.set(`org_admin_${org.id}`, 'true', opts)
    return response
  }

  if (!password) return NextResponse.json({ error: 'Password required.' }, { status: 400 })

  const isAdmin = password === org.admin_password
  const isMember = password === org.group_password

  if (!isAdmin && !isMember) return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 })

  const response = NextResponse.json({ success: true, isAdmin, slug })
  const opts = { httpOnly: true, sameSite: 'lax' as const, maxAge: 60 * 60 * 24 * 7, path: '/' }
  if (isMember || isAdmin) response.cookies.set(`org_member_${org.id}`, 'true', opts)
  if (isAdmin) response.cookies.set(`org_admin_${org.id}`, 'true', opts)
  return response
}
