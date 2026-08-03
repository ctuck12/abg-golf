import { NextRequest, NextResponse } from 'next/server'
import { requireMasterAuth } from '@/lib/org-auth'
import { createServerClient } from '@/lib/supabase-server'
import { parseTees } from '@/lib/course-rating-input'

export async function POST(request: NextRequest) {
  if (!(await requireMasterAuth())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { name, slug, pars, stroke_indexes, tees } = await request.json()
  if (!name || !slug || !Array.isArray(pars) || pars.length !== 18) return NextResponse.json({ error: 'Name, slug, and 18 pars required.' }, { status: 400 })
  const sb = createServerClient()
  const payload: Record<string, unknown> = { name, slug, pars: JSON.stringify(pars) }
  if (Array.isArray(stroke_indexes) && stroke_indexes.length === 18) payload.stroke_indexes = JSON.stringify(stroke_indexes)
  const parsed = parseTees(tees)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { data: created, error } = await sb.from('courses').insert(payload).select('id').single()
  if (error) return NextResponse.json({ error: error.code === '23505' ? 'That course slug is already taken.' : error.message }, { status: 400 })
  if (parsed.tees.length > 0) {
    const { error: teeErr } = await sb.from('course_tees')
      .insert(parsed.tees.map((t) => ({ ...t, course_id: created.id })))
    if (teeErr) return NextResponse.json({ error: teeErr.message }, { status: 400 })
  }
  return NextResponse.json({ success: true })
}
