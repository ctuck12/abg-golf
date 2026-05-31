import { NextRequest, NextResponse } from 'next/server'
import { requireMasterAuth } from '@/lib/org-auth'
import { createServerClient } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  if (!(await requireMasterAuth())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { name, slug, group_password, admin_password } = await request.json()
  if (!name || !slug || !group_password || !admin_password) return NextResponse.json({ error: 'All fields required.' }, { status: 400 })

  const sb = createServerClient()
  const { error } = await sb.from('organizations').insert({ name, slug, group_password, admin_password })
  if (error) return NextResponse.json({ error: error.code === '23505' ? 'That slug is already taken.' : error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
