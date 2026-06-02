import { NextRequest, NextResponse } from 'next/server'
import { createRound } from '@/app/actions'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const result = await createRound(null, formData)
    return NextResponse.json(result ?? { error: 'No response from server.' })
  } catch (e) {
    console.error('[create-round] threw:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unexpected error.' }, { status: 500 })
  }
}
