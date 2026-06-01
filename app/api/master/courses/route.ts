import { NextRequest, NextResponse } from 'next/server'
import { requireMasterAuth } from '@/lib/org-auth'
import { createServerClient } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  if (!(await requireMasterAuth())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { name, slug, pars } = await request.json()
  if (!name || !slug || !Array.isArray(pars) || pars.length !== 18) return NextResponse.json({ error: 'Name, slug, and 18 pars required.' }, { status: 400 })
  const sb = createServerClient()
  const { error } = await sb.from('courses').insert({ name, slug, pars: JSON.stringify(pars) })
  if (error) return NextResponse.json({ error: error.code === '23505' ? 'That course slug is already taken.' : error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
