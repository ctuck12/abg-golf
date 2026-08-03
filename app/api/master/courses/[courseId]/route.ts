import { NextRequest, NextResponse } from 'next/server'
import { requireMasterAuth } from '@/lib/org-auth'
import { createServerClient } from '@/lib/supabase-server'
import { parseTees } from '@/lib/course-rating-input'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  if (!(await requireMasterAuth())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { courseId } = await params
  const { name, pars, stroke_indexes, tees } = await request.json()
  const updates: Record<string, unknown> = {}
  if (name) updates.name = name
  if (Array.isArray(pars) && pars.length === 18) updates.pars = JSON.stringify(pars)
  if (Array.isArray(stroke_indexes) && stroke_indexes.length === 18) updates.stroke_indexes = JSON.stringify(stroke_indexes)
  const parsed = tees === undefined ? null : parseTees(tees)
  if (parsed && 'error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const sb = createServerClient()
  if (Object.keys(updates).length > 0) {
    const { error } = await sb.from('courses').update(updates).eq('id', courseId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }
  // Replace the whole set: the form always submits every tee it knows about, so
  // a tee removed there has to disappear here. Rounds already played keep their
  // tee reference nulled rather than pointing at something gone.
  if (parsed && 'tees' in parsed) {
    await sb.from('course_tees').delete().eq('course_id', courseId)
    if (parsed.tees.length > 0) {
      const { error: teeErr } = await sb.from('course_tees')
        .insert(parsed.tees.map((t) => ({ ...t, course_id: courseId })))
      if (teeErr) return NextResponse.json({ error: teeErr.message }, { status: 400 })
    }
  }
  return NextResponse.json({ success: true })
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  if (!(await requireMasterAuth())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { courseId } = await params
  const sb = createServerClient()
  const { error } = await sb.from('courses').delete().eq('id', courseId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
