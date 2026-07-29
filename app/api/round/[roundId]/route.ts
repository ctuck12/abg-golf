import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase-server'

const COURSE_PARS: Record<string, number[]> = {
  south:      [4, 4, 5, 3, 4, 4, 4, 3, 5, 4, 3, 4, 4, 5, 4, 3, 4, 5],
  north:      [4, 4, 4, 3, 4, 4, 5, 3, 5, 3, 4, 4, 5, 3, 5, 4, 3, 4],
  liveoak:    [4, 3, 4, 4, 3, 4, 4, 5, 4, 4, 5, 3, 4, 4, 5, 4, 3, 4],
  maxwell:    [4, 5, 4, 4, 4, 4, 3, 4, 3, 5, 4, 4, 4, 3, 4, 5, 3, 4],
  shadyoaks:  [4, 3, 4, 5, 4, 4, 3, 3, 4, 5, 4, 4, 3, 4, 4, 3, 5, 4],
  hideout:    [5, 3, 4, 4, 3, 4, 5, 4, 5, 4, 4, 4, 3, 4, 3, 5, 4, 4],
  canyonwest: [4, 4, 4, 5, 4, 3, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5],
}
const COURSE_NAMES: Record<string, string> = {
  south: 'ACC South Course', north: 'ACC North Course', liveoak: 'Live Oak Golf Club',
  maxwell: 'Maxwell Golf Course', shadyoaks: 'Shady Oaks Golf Course',
  hideout: 'The Hideout Golf Club', canyonwest: 'Canyon West Golf Course',
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ roundId: string }> }) {
  const { roundId } = await params
  const sb = createServerClient()

  const { data: round } = await sb.from('rounds').select('id, org_id').eq('id', roundId).single()
  if (!round) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })

  const cookieStore = await cookies()
  const isMaster = cookieStore.get('master_auth')?.value === 'true'
  const isAdmin = cookieStore.get(`org_admin_${round.org_id}`)?.value === 'true'
  if (!isMaster && !isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { name, date, courseSlug, format, ballsCount, includeTotal, holeCount, startHole, bankerMinBet, bankerDefaultMaxBet, clearScores } = body

  const { data: dbCourse } = await sb.from('courses').select('name, pars, stroke_indexes').eq('slug', courseSlug).single()
  const courseName = dbCourse?.name ?? COURSE_NAMES[courseSlug] ?? courseSlug

  const allParsRaw = dbCourse?.pars ?? COURSE_PARS[courseSlug] ?? Array(18).fill(4)
  const allPars: number[] = Array.isArray(allParsRaw) ? allParsRaw : JSON.parse(String(allParsRaw))
  const allSIRaw = dbCourse?.stroke_indexes ?? null
  const allSI: (number | null)[] = allSIRaw
    ? (Array.isArray(allSIRaw) ? allSIRaw : JSON.parse(String(allSIRaw)))
    : Array(18).fill(null)

  const isBanker = format === 'banker'
  const isNineHoleFormat = format === 'daytona' || format === 'traditional' || isBanker
  const actualHoleCount: number = isNineHoleFormat ? (Number(holeCount) || 18) : 18
  const actualStartHole: number = actualHoleCount === 9 ? (Number(startHole) || 1) : 1

  const pars = actualHoleCount === 9
    ? (actualStartHole === 10 ? allPars.slice(9) : allPars.slice(0, 9))
    : allPars
  const strokeIndexes = actualHoleCount === 9
    ? (actualStartHole === 10 ? allSI.slice(9) : allSI.slice(0, 9))
    : allSI

  const actualBallsCount = (format === 'daytona' || format === 'traditional' || isBanker || format === 'hammer')
    ? 1 : (Number(ballsCount) || 3)
  const actualIncludeTotal = (format !== 'daytona' && format !== 'traditional' && !isBanker) && !!(includeTotal)
  const actualBankerMinBet = isBanker ? (Number(bankerMinBet) || 2) : null
  const actualBankerMaxBet = isBanker ? (Number(bankerDefaultMaxBet) || null) : null

  const updates: Record<string, unknown> = {
    name: String(name).trim(),
    date,
    course: courseName,
    format,
    balls_count: actualBallsCount,
    include_total: actualIncludeTotal,
  }
  if (actualBankerMinBet != null) updates.banker_min_bet = actualBankerMinBet
  if (isBanker) updates.banker_default_max_bet = actualBankerMaxBet
  if (clearScores) {
    updates.scores_cleared_at = new Date().toISOString()
    updates.first_score_at = null
    updates.front9_notified_at = null
    updates.finished_notified_at = null
  }

  const { error: roundErr } = await sb.from('rounds').update(updates).eq('id', roundId)
  if (roundErr) return NextResponse.json({ error: roundErr.message }, { status: 400 })

  // Regenerate holes
  await sb.from('holes').delete().eq('round_id', roundId)
  await sb.from('holes').insert(
    pars.map((par, i) => ({ round_id: roundId, hole_number: actualStartHole + i, par, stroke_index: strokeIndexes[i] ?? null }))
  )

  if (clearScores) {
    const { data: teams } = await sb.from('teams').select('id').eq('round_id', roundId)
    const teamIds = (teams ?? []).map((t: { id: string }) => t.id)
    if (teamIds.length > 0) {
      const { data: players } = await sb.from('players').select('id').in('team_id', teamIds)
      const playerIds = (players ?? []).map((p: { id: string }) => p.id)
      if (playerIds.length > 0) {
        await sb.from('scores').delete().in('player_id', playerIds)
      }
    }
  }

  return NextResponse.json({ success: true })
}
