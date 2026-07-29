'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { createServerClient } from '@/lib/supabase-server'
import { sendEmailNotification, sendPushToAll } from '@/lib/notify'
import { logRoundEvent, playerAuditContext, playerNames, firstName, fmtHcp, matchupLabel, bestBallLabel } from '@/lib/audit'
import { requireAdminAuth, requireAnyLogin } from '@/lib/org-auth'

const FORMAT_LABELS: Record<string, string> = {
  daytona: 'Daytona', banker: 'Banker', traditional: 'Traditional', hammer: 'Hammer',
}

// Round roster summary for notifications: teams/groups with player first names.
async function buildRosterSummary(
  supabase: ReturnType<typeof createServerClient>,
  roundId: string,
  format: string
): Promise<string> {
  const { data: teams } = await supabase.from('teams').select('id, name').eq('round_id', roundId).order('name')
  if (!teams || teams.length === 0) return ''
  const { data: players } = await supabase
    .from('players').select('name, team_id, position').in('team_id', teams.map((t) => t.id)).order('position', { ascending: true })
  const byTeam: Record<string, string[]> = {}
  for (const p of players ?? []) {
    if (!byTeam[p.team_id]) byTeam[p.team_id] = []
    byTeam[p.team_id].push(p.name.split(' ')[0])
  }
  if (teams.length === 1) {
    const names = byTeam[teams[0].id] ?? []
    return names.length ? `Playing: ${names.join(', ')}` : ''
  }
  const label = format === 'standard' ? '' : `${teams.length} groups — `
  return label + teams.map((t) => `${t.name}: ${(byTeam[t.id] ?? []).join(', ')}`).join(' · ')
}

// Fetches every round player's id + holes_range (team players and playing-group guests).
async function fetchRoundPlayers(supabase: ReturnType<typeof createServerClient>, roundId: string) {
  const [{ data: teams }, { data: groups }] = await Promise.all([
    supabase.from('teams').select('id').eq('round_id', roundId),
    supabase.from('playing_groups').select('id').eq('round_id', roundId),
  ])
  const teamIds = (teams ?? []).map((t) => t.id)
  const groupIds = (groups ?? []).map((g) => g.id)
  const [{ data: teamPlayers }, { data: links }] = await Promise.all([
    teamIds.length ? supabase.from('players').select('id, holes_range').in('team_id', teamIds) : Promise.resolve({ data: [] as { id: string; holes_range: string | null }[] }),
    groupIds.length ? supabase.from('playing_group_players').select('player_id').in('playing_group_id', groupIds) : Promise.resolve({ data: [] as { player_id: string }[] }),
  ])
  const known = new Set((teamPlayers ?? []).map((p) => p.id))
  const guestIds = (links ?? []).map((l) => l.player_id).filter((id) => !known.has(id))
  const { data: guests } = guestIds.length
    ? await supabase.from('players').select('id, holes_range').in('id', guestIds)
    : { data: [] as { id: string; holes_range: string | null }[] }
  return [...(teamPlayers ?? []), ...(guests ?? [])]
}

// First-score + milestone notifications after a hole save. Stamps on the round
// (first_score_at / front9_notified_at / finished_notified_at) are claimed
// atomically so each notification sends exactly once, even with concurrent
// groups. Fails silently, including before the migrations run.
async function notifyScoreEvents(
  supabase: ReturnType<typeof createServerClient>,
  roundId: string | null | undefined,
  scorerLabel: string,
  holeNumber: number
) {
  if (!roundId) return
  try {
    // ── Round underway (first score) ──
    const { data: claimed } = await supabase
      .from('rounds')
      .update({ first_score_at: new Date().toISOString() })
      .eq('id', roundId)
      .is('first_score_at', null)
      .select('id, name, org_id, course, format, balls_count')
    if (claimed && claimed.length > 0) {
      const r = claimed[0]
      const format = r.format ?? 'standard'
      const [{ data: org }, roster] = await Promise.all([
        supabase.from('organizations').select('name, slug').eq('id', r.org_id).single(),
        buildRosterSummary(supabase, roundId, format),
      ])
      const orgName = org?.name ?? 'Unknown group'
      const formatLabel = FORMAT_LABELS[format] ?? `${r.balls_count ?? 3}-Ball`
      const title = `⛳ ${orgName}: round underway`
      const body = [
        `${r.name ?? 'Round'} at ${r.course ?? 'course'} · ${formatLabel}`,
        `${scorerLabel} saved hole ${holeNumber}.`,
        roster,
      ].filter(Boolean).join('\n')
      const url = org?.slug ? `/${org.slug}` : '/'
      await Promise.all([
        sendPushToAll(supabase, { title, body, url }),
        sendEmailNotification({ subject: title, text: body }),
      ])
    }

    // ── Milestones: front nine complete / round complete ──
    // Groups save holes in order, so the round's front nine can only complete on
    // a hole-9 save and the round on a last-hole save — skip all other saves.
    const { data: round } = await supabase
      .from('rounds')
      .select('id, name, org_id, front9_notified_at, finished_notified_at')
      .eq('id', roundId).single()
    if (!round) return
    const { data: holesRaw } = await supabase.from('holes').select('hole_number').eq('round_id', roundId)
    const holeNums = (holesRaw ?? []).map((h) => h.hole_number)
    if (holeNums.length === 0) return
    const lastHole = Math.max(...holeNums)
    const is18 = holeNums.length > 9
    const wantFront9 = is18 && !round.front9_notified_at && holeNumber === 9
    const wantFinal = !round.finished_notified_at && holeNumber === lastHole
    if (!wantFront9 && !wantFinal) return

    const roundPlayers = await fetchRoundPlayers(supabase, roundId)
    if (roundPlayers.length === 0) return
    const playerIds = roundPlayers.map((p) => p.id)
    const { data: scores } = await supabase.from('scores').select('player_id, hole_number').in('player_id', playerIds)
    const have = new Set((scores ?? []).map((s) => `${s.player_id}:${s.hole_number}`))
    const coveredHoles = (range: string | null | undefined, nums: number[]) =>
      nums.filter((n) => range === 'front9' ? n <= 9 : range === 'back9' ? n > 9 : true)
    const allComplete = (nums: number[]) =>
      roundPlayers.every((p) => coveredHoles(p.holes_range, nums).every((n) => have.has(`${p.id}:${n}`)))

    const { data: org } = await supabase.from('organizations').select('name, slug').eq('id', round.org_id).single()
    const orgName = org?.name ?? 'Unknown group'
    const url = org?.slug ? `/${org.slug}` : '/'
    const roundName = round.name ?? 'Round'

    if (wantFront9 && allComplete(holeNums.filter((n) => n <= 9))) {
      const { data: won } = await supabase
        .from('rounds')
        .update({ front9_notified_at: new Date().toISOString() })
        .eq('id', roundId).is('front9_notified_at', null).select('id')
      if (won && won.length > 0) {
        const title = `⛳ ${orgName}: front 9 complete`
        const body = `All groups have finished the front nine of ${roundName}. Tap for the leaderboard.`
        await Promise.all([
          sendPushToAll(supabase, { title, body, url }),
          sendEmailNotification({ subject: title, text: body }),
        ])
      }
    }

    if (wantFinal && allComplete(holeNums)) {
      const { data: won } = await supabase
        .from('rounds')
        .update({ finished_notified_at: new Date().toISOString() })
        .eq('id', roundId).is('finished_notified_at', null).select('id')
      if (won && won.length > 0) {
        const title = `⛳ ${orgName}: final results are in`
        const body = `${roundName} is complete — every group has finished. Tap for results and payouts.`
        await Promise.all([
          sendPushToAll(supabase, { title, body, url }),
          sendEmailNotification({ subject: title, text: body }),
        ])
      }
    }
  } catch (e) {
    console.error('[notifyScoreEvents] failed:', e)
  }
}

// ── Course presets ────────────────────────────────────────────────────────────

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
  south:      'ACC South Course',
  north:      'ACC North Course',
  liveoak:    'Live Oak Golf Club',
  maxwell:    'Maxwell Golf Course',
  shadyoaks:  'Shady Oaks Golf Course',
  hideout:    'The Hideout Golf Club',
  canyonwest: 'Canyon West Golf Course',
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export async function teamLogin(_prev: unknown, formData: FormData) {
  const teamId = formData.get('teamId') as string
  const pin = (formData.get('pin') as string)?.trim()
  if (!teamId || !pin) return { error: 'Select your team and enter your PIN.' }

  const supabase = createServerClient()
  const { data: team } = await supabase
    .from('teams').select('id, pin, is_admin').eq('id', teamId).single()

  if (!team || team.pin !== pin) return { error: 'Incorrect PIN. Try again.' }

  const cookieStore = await cookies()
  cookieStore.set(`team_auth_${teamId}`, 'true', { httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24, path: '/' })
  if (team.is_admin) {
    cookieStore.set('admin_auth', 'true', { httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24, path: '/' })
  }

  // Return success + teamId; client handles navigation (redirect() breaks in useActionState on Next.js 16)
  return { success: true as const, teamId }
}

export async function adminLogin(_prev: unknown, formData: FormData) {
  const password = formData.get('password') as string
  if (!password || password !== process.env.ADMIN_PASSWORD) return { error: 'Incorrect password.' }

  const cookieStore = await cookies()
  cookieStore.set('admin_auth', 'true', { httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 8, path: '/' })

  // Return success; client handles navigation (redirect() breaks in useActionState on Next.js 16)
  return { success: true as const }
}

export async function adminLogout(orgSlug: string, orgId: string) {
  const cookieStore = await cookies()
  cookieStore.delete(`org_admin_${orgId}`)
  cookieStore.delete(`org_member_${orgId}`)
  redirect(`/${orgSlug}/admin`)
}

// ── Score submission ──────────────────────────────────────────────────────────

export async function submitHoleScores(
  teamId: string,
  holeNumber: number,
  playerScores: { playerId: string; strokes: number }[]
) {
  const cookieStore = await cookies()
  if (!cookieStore.get(`team_auth_${teamId}`)?.value) return { error: 'Session expired. Please log in again.' }

  const supabase = createServerClient()
  const rows = playerScores
    .filter(({ strokes }) => strokes >= 1 && strokes <= 20)
    .map(({ playerId, strokes }) => ({ player_id: playerId, hole_number: holeNumber, strokes }))
  if (rows.length > 0) {
    const { error } = await supabase.from('scores').upsert(rows, { onConflict: 'player_id,hole_number' })
    if (error) return { error: error.message }
    const { data: teamRow } = await supabase.from('teams').select('round_id, name').eq('id', teamId).single()
    await notifyScoreEvents(supabase, teamRow?.round_id, teamRow?.name ?? 'A team', holeNumber)
  }
  return { success: true }
}

// ── Admin: round management ───────────────────────────────────────────────────

export async function createRound(_prev: unknown, formData: FormData) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  try {
    const name = (formData.get('name') as string)?.trim()
    const date = formData.get('date') as string
    const orgId = formData.get('orgId') as string
    const orgSlug = (formData.get('orgSlug') as string)?.trim()
    const courseSlug = (formData.get('course') as string) || 'south'
    const format = (formData.get('format') as string) || 'standard'
    const daytonaVariant = null
    const isBanker = format === 'banker'
    const isHammer = format === 'hammer'
    const ballsCount = (format === 'daytona' || format === 'traditional' || isBanker || isHammer) ? 1 : (parseInt(formData.get('ballsCount') as string) || 3)
    const includeTotal = (format !== 'daytona' && format !== 'traditional' && !isBanker) && formData.get('include_total') === 'true'
    const isNineHoleFormat = format === 'daytona' || format === 'traditional' || isBanker
    const bankerMinBet = isBanker ? (parseFloat(formData.get('banker_min_bet') as string) || 2) : null
    const bankerDefaultMaxBet = isBanker ? (parseFloat(formData.get('banker_default_max_bet') as string) || null) : null
    const holeCount = isNineHoleFormat ? (parseInt(formData.get('holeCount') as string) || 18) : 18
    const startHole = (holeCount === 9) ? (parseInt(formData.get('startHole') as string) || 1) : 1

    if (!name || !date || !orgId || !orgSlug) return { error: 'Round name, date, and org are required.' }

    const supabase = createServerClient()

    const { data: dbCourse } = await supabase
      .from('courses').select('name, pars, stroke_indexes').eq('slug', courseSlug).single()

    const courseName = dbCourse?.name ?? COURSE_NAMES[courseSlug] ?? courseSlug
    const allParsRaw = dbCourse?.pars ?? COURSE_PARS[courseSlug] ?? Array(18).fill(4)
    const allPars: number[] = Array.isArray(allParsRaw) ? allParsRaw : JSON.parse(String(allParsRaw))
    const pars = holeCount === 9
      ? (startHole === 10 ? allPars.slice(9) : allPars.slice(0, 9))
      : allPars
    const allStrokeIndexesRaw = dbCourse?.stroke_indexes ?? null
    const allStrokeIndexes: (number | null)[] = allStrokeIndexesRaw
      ? (Array.isArray(allStrokeIndexesRaw) ? allStrokeIndexesRaw : JSON.parse(String(allStrokeIndexesRaw)))
      : Array(18).fill(null)
    const strokeIndexes = holeCount === 9
      ? (startHole === 10 ? allStrokeIndexes.slice(9) : allStrokeIndexes.slice(0, 9))
      : allStrokeIndexes

    // IMPORTANT: the new round is inserted INACTIVE and only swapped in as the
    // active round once it (and its holes/ball values) fully exists. The current
    // round is never touched until the replacement is complete, so a failure at
    // any step can no longer leave the group with no active round.
    const { data: round, error } = await supabase
      .from('rounds')
      .insert({ name, date, course: courseName, balls_count: ballsCount, format, daytona_variant: daytonaVariant, include_total: includeTotal, is_active: false, is_started: false, org_id: orgId, ...(bankerMinBet != null ? { banker_min_bet: bankerMinBet } : {}), ...(bankerDefaultMaxBet != null ? { banker_default_max_bet: bankerDefaultMaxBet } : {}), ...((format === 'daytona' || isBanker) ? { auto_handicap: true } : {}) })
      .select().single()

    if (error || !round) return { error: error?.message ?? 'Failed to create round.' }

    const abortCreate = async (msg: string) => {
      // Remove the half-created inactive round; the previous round stays active.
      await supabase.from('rounds').delete().eq('id', round.id).eq('is_active', false)
      return { error: msg }
    }

    const [{ error: holesErr }, { error: bvErr }] = await Promise.all([
      supabase.from('holes').insert(
        pars.map((par, i) => ({ round_id: round.id, hole_number: startHole + i, par, stroke_index: strokeIndexes[i] ?? null }))
      ),
      supabase.from('ball_values').insert(
        Array.from({ length: ballsCount }, (_, i) => ({ round_id: round.id, ball_number: i + 1, value_dollars: 0 }))
      ),
    ])
    if (holesErr || bvErr) return abortCreate((holesErr ?? bvErr)?.message ?? 'Failed to set up the new round.')

    // Atomic swap: deactivate the old round + activate the new one in a single
    // DB transaction (see supabase/add_swap_active_round_fn.sql).
    const { error: swapErr } = await supabase.rpc('swap_active_round', { p_round_id: round.id, p_org_id: orgId })
    if (swapErr) {
      // Fallback while the SQL function isn't installed yet: two-step swap.
      const { error: actErr } = await supabase.from('rounds').update({ is_active: true }).eq('id', round.id)
      if (actErr) return abortCreate(actErr.message)
      await supabase.from('rounds').update({ is_active: false }).eq('org_id', orgId).eq('is_active', true).neq('id', round.id)
    }

    return { success: true, roundId: round.id }
  } catch (e) {
    console.error('[createRound] unexpected error:', e)
    return { error: e instanceof Error ? e.message : 'Unexpected error creating round.' }
  }
}

export async function activateRound(roundId: string, orgSlug: string) {
  if (await requireAdminAuth()) return
  const supabase = createServerClient()
  await supabase.from('rounds').update({ is_started: true }).eq('id', roundId)
  await logRoundEvent(supabase, roundId, 'Round activated', 'Leaderboard is live')
  redirect(`/${orgSlug}/admin/dashboard`)
}

export async function updateHolePars(_prev: unknown, formData: FormData) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const roundId = formData.get('roundId') as string
  const supabase = createServerClient()

  const { data: beforeHoles } = await supabase.from('holes').select('hole_number, par').eq('round_id', roundId)
  const beforePar = new Map((beforeHoles ?? []).map((h) => [h.hole_number as number, h.par as number]))
  const changed: string[] = []
  for (let i = 1; i <= 18; i++) {
    const par = parseInt(formData.get(`par_${i}`) as string) || 4
    await supabase.from('holes').update({ par }).eq('round_id', roundId).eq('hole_number', i)
    if (beforePar.has(i) && beforePar.get(i) !== par) changed.push(`H${i}: ${beforePar.get(i)} → ${par}`)
  }
  if (changed.length) await logRoundEvent(supabase, roundId, 'Hole pars', changed.join(', '))
  return { success: true }
}

export async function updateBallValues(_prev: unknown, formData: FormData) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const roundId = formData.get('roundId') as string
  const ballsCount = parseInt(formData.get('ballsCount') as string) || 3
  const supabase = createServerClient()

  const values: number[] = []
  for (let i = 1; i <= ballsCount; i++) {
    const value = parseFloat(formData.get(`ball_${i}`) as string) || 0
    values.push(value)
    await supabase.from('ball_values')
      .upsert({ round_id: roundId, ball_number: i, value_dollars: value }, { onConflict: 'round_id,ball_number' })
  }
  await logRoundEvent(supabase, roundId, 'Ball values', values.map((v) => `$${v}`).join(' / '))
  return { success: true }
}

// ── Admin: team management ────────────────────────────────────────────────────

export async function addTeam(_prev: unknown, formData: FormData) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const name = (formData.get('name') as string)?.trim()
  const roundId = formData.get('roundId') as string
  // PIN is hidden when mixed groups is enabled — default to 1234
  const rawPin = (formData.get('pin') as string)?.trim()
  const pin = rawPin || '1234'
  if (!name || !roundId) return { error: 'All fields required.' }
  if (!/^\d{4}$/.test(pin)) return { error: 'PIN must be exactly 4 digits.' }

  const daytonaVariant = (formData.get('daytona_variant') as string) || null
  const daytonaVariantBack9 = (formData.get('daytona_variant_back9') as string) || null
  const bankerSideGame = formData.get('banker_side_game') === 'true'
  const bankerSideGameMinBet = formData.get('banker_side_game_min_bet') ? parseFloat(formData.get('banker_side_game_min_bet') as string) : null
  const bankerSideGameMaxBet = formData.get('banker_side_game_max_bet') ? parseFloat(formData.get('banker_side_game_max_bet') as string) : null
  const autoStrokes = formData.get('auto_strokes') === 'true'
  const hammerSideGame = formData.get('hammer_side_game') === 'true'
  const hammerBaseBet = formData.get('hammer_base_bet') ? parseFloat(formData.get('hammer_base_bet') as string) : 1
  const hammerFormat = (formData.get('hammer_format') as string) || 'stroke'

  const supabase = createServerClient()
  const teamStrokeRounding = (formData.get('stroke_rounding') as string) || ''
  const { error } = await supabase.from('teams').insert({ name, pin, round_id: roundId, is_admin: false, daytona_variant: daytonaVariant, daytona_variant_back9: daytonaVariantBack9, banker_side_game: bankerSideGame || false, banker_side_game_min_bet: bankerSideGame ? bankerSideGameMinBet : null, banker_side_game_max_bet: bankerSideGame ? bankerSideGameMaxBet : null, auto_strokes: autoStrokes, hammer_side_game: hammerSideGame || false, hammer_base_bet: hammerSideGame ? hammerBaseBet : null, hammer_format: hammerSideGame ? hammerFormat : null, ...(teamStrokeRounding ? { stroke_rounding: teamStrokeRounding } : {}) })
  if (error) return { error: error.code === '23505' ? 'A team with that name already exists.' : error.message }
  return { success: true }
}

export async function renameTeam(_prev: unknown, formData: FormData) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const teamId = formData.get('teamId') as string
  const name = (formData.get('name') as string)?.trim()
  if (!teamId || !name) return { error: 'Team name required.' }

  const supabase = createServerClient()
  const { data: before } = await supabase.from('teams').select('name, round_id').eq('id', teamId).single()
  const { error } = await supabase.from('teams').update({ name }).eq('id', teamId)
  if (error) return { error: error.message }
  if (before && before.name !== name) {
    await logRoundEvent(supabase, before.round_id, 'Team renamed', `${before.name} → ${name}`)
  }
  return { success: true }
}

export async function updateTeamSettings(_prev: unknown, formData: FormData) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const teamId = formData.get('teamId') as string
  const name = (formData.get('name') as string)?.trim()
  const pin = (formData.get('pin') as string)?.trim()
  const daytonaVariant = (formData.get('daytona_variant') as string) || null
  const daytonaVariantBack9 = (formData.get('daytona_variant_back9') as string) || null

  if (!teamId || !name) return { error: 'Group name required.' }
  if (pin && !/^\d{4}$/.test(pin)) return { error: 'PIN must be exactly 4 digits.' }

  const bankerSideGame = formData.get('banker_side_game') === 'true'
  const bankerSideGameMinBet = formData.get('banker_side_game_min_bet') ? parseFloat(formData.get('banker_side_game_min_bet') as string) : null
  const bankerSideGameMaxBet = formData.get('banker_side_game_max_bet') ? parseFloat(formData.get('banker_side_game_max_bet') as string) : null
  const autoStrokes = formData.get('auto_strokes') === 'true'
  const hammerSideGame = formData.get('hammer_side_game') === 'true'
  const hammerBaseBet = formData.get('hammer_base_bet') ? parseFloat(formData.get('hammer_base_bet') as string) : 1
  const hammerFormat = (formData.get('hammer_format') as string) || 'stroke'

  const supabase = createServerClient()
  const { data: before } = await supabase
    .from('teams').select('name, round_id, pin, daytona_variant, daytona_variant_back9, banker_side_game, hammer_side_game, auto_strokes, stroke_rounding')
    .eq('id', teamId).single()
  const updates: Record<string, unknown> = { name, daytona_variant: daytonaVariant, daytona_variant_back9: daytonaVariantBack9, banker_side_game: bankerSideGame || false, banker_side_game_min_bet: bankerSideGame ? bankerSideGameMinBet : null, banker_side_game_max_bet: bankerSideGame ? bankerSideGameMaxBet : null, auto_strokes: autoStrokes, hammer_side_game: hammerSideGame || false, hammer_base_bet: hammerSideGame ? hammerBaseBet : null, hammer_format: hammerSideGame ? hammerFormat : null }
  if (pin) updates.pin = pin
  const strokeRounding = (formData.get('stroke_rounding') as string) || ''
  if (strokeRounding) updates.stroke_rounding = strokeRounding

  const { error } = await supabase.from('teams').update(updates).eq('id', teamId)
  if (error) return { error: error.message }
  if (before) {
    const changes: string[] = []
    if (before.name !== name) changes.push(`renamed to ${name}`)
    if ((before.daytona_variant ?? null) !== daytonaVariant) changes.push(`variant → ${daytonaVariant ?? 'none'}`)
    if ((before.daytona_variant_back9 ?? null) !== daytonaVariantBack9) changes.push(`back-9 variant → ${daytonaVariantBack9 ?? 'none'}`)
    if (!!before.banker_side_game !== bankerSideGame) changes.push(`banker side game ${bankerSideGame ? 'on' : 'off'}`)
    if (!!before.hammer_side_game !== hammerSideGame) changes.push(`hammer side game ${hammerSideGame ? 'on' : 'off'}`)
    if (!!before.auto_strokes !== autoStrokes) changes.push(`auto strokes ${autoStrokes ? 'on' : 'off'}`)
    if (strokeRounding && strokeRounding !== (before.stroke_rounding ?? '')) changes.push(`stroke rounding → ${strokeRounding}`)
    if (pin && pin !== before.pin) changes.push('PIN changed')
    if (changes.length) await logRoundEvent(supabase, before.round_id, 'Group settings', `${before.name}: ${changes.join(', ')}`)
  }
  return { success: true }
}

export async function renamePlayer(_prev: unknown, formData: FormData) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const playerId = formData.get('playerId') as string
  const name = (formData.get('name') as string)?.trim()
  if (!playerId || !name) return { error: 'Player name required.' }

  const supabase = createServerClient()
  const before = await playerAuditContext(supabase, playerId)
  const { error } = await supabase.from('players').update({ name }).eq('id', playerId)
  if (error) return { error: error.message }
  if (before && before.name !== name) {
    await logRoundEvent(supabase, before.roundId, 'Player edit', `${before.name}: renamed to ${name}`)
  }
  return { success: true }
}

export async function deleteTeam(teamId: string) {
  if (await requireAdminAuth()) return
  const supabase = createServerClient()
  const { data: before } = await supabase.from('teams').select('name, round_id').eq('id', teamId).single()
  await supabase.from('teams').delete().eq('id', teamId)
  if (before) await logRoundEvent(supabase, before.round_id, 'Team removed', before.name)
}

export async function toggleTeamAdmin(teamId: string, isAdmin: boolean) {
  if (await requireAdminAuth()) return
  const supabase = createServerClient()
  await supabase.from('teams').update({ is_admin: isAdmin }).eq('id', teamId)
}

export async function resetTeamScores(teamId: string) {
  if (await requireAdminAuth()) return
  const supabase = createServerClient()
  const [{ data: players }, { data: teamRow }] = await Promise.all([
    supabase.from('players').select('id').eq('team_id', teamId),
    supabase.from('teams').select('round_id, name').eq('id', teamId).single(),
  ])
  const playerIds = (players ?? []).map((p) => p.id)
  if (playerIds.length) {
    const roundId = teamRow?.round_id
    await Promise.all([
      supabase.from('scores').delete().in('player_id', playerIds),
      roundId
        ? supabase.from('daytona_hole_assignments').delete().eq('round_id', roundId).in('player_id', playerIds)
        : Promise.resolve(),
    ])
    await logRoundEvent(supabase, teamRow?.round_id, 'Scores reset', `All scores deleted for ${teamRow?.name ?? 'a team'}`)
  }
}

// ── Admin: player management ──────────────────────────────────────────────────

export async function addPlayer(_prev: unknown, formData: FormData) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const name = (formData.get('name') as string)?.trim()
  const teamId = formData.get('teamId') as string
  const skinsParticipant = formData.get('skins_participant') === 'true'
  const handicapRaw = formData.get('handicap') as string
  const handicap = handicapRaw !== '' && handicapRaw != null ? parseFloat(handicapRaw) : null
  if (!name || !teamId) return { error: 'Player name required.' }

  const supabase = createServerClient()

  // Get the round for this team so we can check all players in the round
  const { data: teamRow } = await supabase.from('teams').select('round_id, name').eq('id', teamId).single()
  if (teamRow?.round_id) {
    const { data: allTeams } = await supabase.from('teams').select('id').eq('round_id', teamRow.round_id)
    const allTeamIds = (allTeams ?? []).map((t: { id: string }) => t.id)
    if (allTeamIds.length > 0) {
      const { data: allPlayers } = await supabase.from('players').select('name').in('team_id', allTeamIds)
      const duplicate = (allPlayers ?? []).some(
        (p: { name: string }) => p.name.trim().toLowerCase() === name.toLowerCase()
      )
      if (duplicate) return { error: `A player named "${name}" already exists in this round.` }
    }
  }

  // Place new player after all existing ones
  const { data: existing } = await supabase
    .from('players').select('position').eq('team_id', teamId).order('position', { ascending: false }).limit(1)
  const nextPosition = existing?.[0]?.position != null ? existing[0].position + 1 : 0
  const { error } = await supabase.from('players').insert({ name, team_id: teamId, position: nextPosition, skins_participant: skinsParticipant, handicap: handicap ?? null })
  if (error) return { error: error.message }
  await logRoundEvent(supabase, teamRow?.round_id, 'Player added', `${name} (HCP ${fmtHcp(handicap)}) → ${teamRow?.name ?? 'team'}`)
  return { success: true }
}

export async function updatePlayerDetails(playerId: string, name: string, handicap: number | null) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Player name required.' }
  const supabase = createServerClient()
  const before = await playerAuditContext(supabase, playerId)
  const { data: player, error } = await supabase
    .from('players').update({ name: trimmed, handicap }).eq('id', playerId)
    .select('roster_player_id').single()
  if (error) return { error: error.message }
  // Keep the org roster in sync so the change shows up in every section
  if (player?.roster_player_id) {
    await supabase.from('org_players').update({ name: trimmed, handicap_index: handicap }).eq('id', player.roster_player_id)
  }
  if (before) {
    const changes: string[] = []
    if (before.name !== trimmed) changes.push(`renamed to ${trimmed}`)
    if ((before.handicap ?? null) !== (handicap ?? null)) changes.push(`HCP ${fmtHcp(before.handicap)} → ${fmtHcp(handicap)}`)
    if (changes.length) await logRoundEvent(supabase, before.roundId, 'Player edit', `${before.name}: ${changes.join(', ')}`)
  }
  return { success: true }
}

export async function updatePlayerHandicap(playerId: string, handicap: number | null) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const supabase = createServerClient()
  const before = await playerAuditContext(supabase, playerId)
  const { data: player, error } = await supabase
    .from('players').update({ handicap }).eq('id', playerId)
    .select('roster_player_id').single()
  if (error) return { error: error.message }
  // Keep the org roster in sync so the change shows up in every section
  if (player?.roster_player_id) {
    await supabase.from('org_players').update({ handicap_index: handicap }).eq('id', player.roster_player_id)
  }
  if (before && (before.handicap ?? null) !== (handicap ?? null)) {
    await logRoundEvent(supabase, before.roundId, 'HCP change', `${before.name}: ${fmtHcp(before.handicap)} → ${fmtHcp(handicap)}`)
  }
  return { success: true }
}

// ── Hammer ────────────────────────────────────────────────────────────────────

// "Team A vs Team B" for a hammer matchup's team ids.
async function hammerLabel(sb: ReturnType<typeof createServerClient>, team1Id: string, team2Id: string): Promise<string> {
  const { data } = await sb.from('teams').select('id, name').in('id', [team1Id, team2Id])
  const byId = new Map((data ?? []).map((t) => [t.id, t.name as string]))
  return `${byId.get(team1Id) ?? '?'} vs ${byId.get(team2Id) ?? '?'}`
}

export async function createHammerMatchup(roundId: string, team1Id: string, team2Id: string, baseBet: number, autoHandicap: boolean) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const supabase = createServerClient()
  const { data, error } = await supabase.from('hammer_matchups')
    .insert({ round_id: roundId, team1_id: team1Id, team2_id: team2Id, base_bet: baseBet, auto_handicap: autoHandicap })
    .select('id').single()
  if (error) return { error: error.message }
  await logRoundEvent(supabase, roundId, 'Matchup added', `Hammer: ${await hammerLabel(supabase, team1Id, team2Id)} — $${baseBet} base`)
  return { success: true, id: data.id }
}

export async function deleteHammerMatchup(matchupId: string) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const supabase = createServerClient()
  const { data: m } = await supabase.from('hammer_matchups').select('round_id, team1_id, team2_id').eq('id', matchupId).single()
  await supabase.from('hammer_matchups').delete().eq('id', matchupId)
  if (m) await logRoundEvent(supabase, m.round_id, 'Matchup removed', `Hammer: ${await hammerLabel(supabase, m.team1_id, m.team2_id)}`)
  return { success: true }
}

export async function saveHammerHole(
  matchupId: string,
  holeNumber: number,
  state: { stake: number; lastHammerTeam: number | null; foldedTeam: number | null; preTeeUsed: boolean }
) {
  const authError = await requireAnyLogin()
  if (authError) return { error: authError }
  const supabase = createServerClient()
  await supabase.from('hammer_holes').upsert(
    { matchup_id: matchupId, hole_number: holeNumber, stake: state.stake, last_hammer_team: state.lastHammerTeam, folded_team: state.foldedTeam, pre_tee_used: state.preTeeUsed },
    { onConflict: 'matchup_id,hole_number' }
  )
  return { success: true }
}

export async function submitHammerHoleScores(
  matchupId: string,
  holeNumber: number,
  playerScores: { playerId: string; strokes: number }[]
) {
  const cookieStore = await cookies()
  const supabase = createServerClient()
  // Check auth for either team in the matchup
  const { data: matchup } = await supabase.from('hammer_matchups').select('team1_id, team2_id, round_id').eq('id', matchupId).single()
  if (!matchup) return { error: 'Matchup not found.' }
  const hasAuth = cookieStore.get(`team_auth_${matchup.team1_id}`)?.value === 'true' ||
                  cookieStore.get(`team_auth_${matchup.team2_id}`)?.value === 'true'
  if (!hasAuth) return { error: 'Session expired. Please log in again.' }
  const rows = playerScores
    .filter(({ strokes }) => strokes >= 1 && strokes <= 20)
    .map(({ playerId, strokes }) => ({ player_id: playerId, hole_number: holeNumber, strokes }))
  if (rows.length > 0) {
    const { error } = await supabase.from('scores').upsert(rows, { onConflict: 'player_id,hole_number' })
    if (error) return { error: error.message }
    await notifyScoreEvents(supabase, (matchup as { round_id?: string | null }).round_id, 'A Hammer matchup', holeNumber)
  }
  return { success: true }
}

// ── Org Player Roster ─────────────────────────────────────────────────────────

export async function createRosterPlayer(orgId: string, name: string, ghinNumber: string | null, handicapIndex: number | null, email: string | null) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('org_players')
    .insert({ org_id: orgId, name: name.trim(), ghin_number: ghinNumber || null, handicap_index: handicapIndex, email: email || null })
    .select('id').single()
  if (error) return { error: error.code === '23505' ? `A player named "${name}" already exists in the roster.` : error.message }
  return { success: true, id: data.id }
}

// Pull each rostered player's current Handicap Index from GHIN by their GHIN
// number and update the roster. Returns what changed so the client can mirror
// state and (with confirmation, if live) sync the current round's players.
export async function syncGhinHandicaps(orgId: string): Promise<
  | { error: string }
  | { updated: { id: string; name: string; oldHcp: number | null; newHcp: number | null }[]; unchanged: number; failed: { name: string; reason: string }[] }
> {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const { fetchGhinHandicap } = await import('@/lib/ghin')
  const supabase = createServerClient()
  const { data: roster, error } = await supabase
    .from('org_players').select('id, name, ghin_number, handicap_index')
    .eq('org_id', orgId).not('ghin_number', 'is', null)
  if (error) return { error: error.message }
  const withGhin = (roster ?? []).filter((r) => (r.ghin_number ?? '').trim() !== '')
  if (withGhin.length === 0) return { error: 'No roster players have a GHIN number on file.' }

  const updated: { id: string; name: string; oldHcp: number | null; newHcp: number | null }[] = []
  const failed: { name: string; reason: string }[] = []
  let unchanged = 0

  // Small batches — enough parallelism to be quick without hammering GHIN
  const CHUNK = 4
  for (let i = 0; i < withGhin.length; i += CHUNK) {
    await Promise.all(withGhin.slice(i, i + CHUNK).map(async (r) => {
      try {
        const newHcp = await fetchGhinHandicap(r.ghin_number!)
        const oldHcp = r.handicap_index ?? null
        if (newHcp === null) { failed.push({ name: r.name, reason: 'GHIN returned no index (NH?)' }); return }
        if (oldHcp !== null && Math.abs(oldHcp - newHcp) < 0.05) { unchanged++; return }
        const { error: upErr } = await supabase.from('org_players').update({ handicap_index: newHcp }).eq('id', r.id)
        if (upErr) { failed.push({ name: r.name, reason: upErr.message }); return }
        updated.push({ id: r.id, name: r.name, oldHcp, newHcp })
      } catch (e) {
        failed.push({ name: r.name, reason: e instanceof Error ? e.message : 'lookup failed' })
      }
    }))
  }
  return { updated, unchanged, failed }
}

export async function updateRosterPlayerHandicap(rosterPlayerId: string, handicapIndex: number | null) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const supabase = createServerClient()
  const { error } = await supabase
    .from('org_players')
    .update({ handicap_index: handicapIndex })
    .eq('id', rosterPlayerId)
  if (error) return { error: error.message }
  return { success: true }
}

export async function updateRosterPlayer(playerId: string, name: string, ghinNumber: string | null, handicapIndex: number | null, email: string | null) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const supabase = createServerClient()
  const { error } = await supabase
    .from('org_players')
    .update({ name: name.trim(), ghin_number: ghinNumber || null, handicap_index: handicapIndex, email: email || null })
    .eq('id', playerId)
  if (error) return { error: error.message }
  return { success: true }
}

export async function deleteRosterPlayer(playerId: string) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const supabase = createServerClient()
  await supabase.from('org_players').delete().eq('id', playerId)
  return { success: true }
}

export async function addRosterPlayerToTeam(teamId: string, rosterPlayerId: string) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const supabase = createServerClient()

  const { data: rp } = await supabase.from('org_players').select('name, handicap_index').eq('id', rosterPlayerId).single()
  if (!rp) return { error: 'Roster player not found.' }

  const { data: teamRow } = await supabase.from('teams').select('round_id, name').eq('id', teamId).single()
  if (teamRow?.round_id) {
    const { data: allTeams } = await supabase.from('teams').select('id').eq('round_id', teamRow.round_id)
    const allTeamIds = (allTeams ?? []).map((t: { id: string }) => t.id)
    if (allTeamIds.length > 0) {
      const { data: allPlayers } = await supabase.from('players').select('name').in('team_id', allTeamIds)
      if ((allPlayers ?? []).some((p: { name: string }) => p.name.trim().toLowerCase() === rp.name.toLowerCase())) {
        return { error: `${rp.name} is already in this round.` }
      }
    }
  }

  const { data: existing } = await supabase.from('players').select('position').eq('team_id', teamId).order('position', { ascending: false }).limit(1)
  const nextPosition = existing?.[0]?.position != null ? existing[0].position + 1 : 0

  const { error } = await supabase.from('players').insert({
    name: rp.name, team_id: teamId, position: nextPosition,
    handicap: rp.handicap_index ?? null, roster_player_id: rosterPlayerId,
  })
  if (error) return { error: error.message }
  await logRoundEvent(supabase, teamRow?.round_id, 'Player added', `${rp.name} (HCP ${fmtHcp(rp.handicap_index)}) → ${teamRow?.name ?? 'team'}`)
  return { success: true }
}

// Bulk version of addRosterPlayerToTeam — one round of queries and a single
// insert for the whole selection instead of N sequential server actions.
export async function addRosterPlayersToTeam(teamId: string, rosterPlayerIds: string[]) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  if (!rosterPlayerIds.length) return { success: true }
  const supabase = createServerClient()

  const [{ data: rps }, { data: teamRow }, { data: existing }] = await Promise.all([
    supabase.from('org_players').select('id, name, handicap_index').in('id', rosterPlayerIds),
    supabase.from('teams').select('round_id, name').eq('id', teamId).single(),
    supabase.from('players').select('position').eq('team_id', teamId).order('position', { ascending: false }).limit(1),
  ])
  if (!rps || rps.length === 0) return { error: 'Roster players not found.' }

  if (teamRow?.round_id) {
    const { data: allTeams } = await supabase.from('teams').select('id').eq('round_id', teamRow.round_id)
    const allTeamIds = (allTeams ?? []).map((t: { id: string }) => t.id)
    if (allTeamIds.length > 0) {
      const { data: allPlayers } = await supabase.from('players').select('name').in('team_id', allTeamIds)
      const existingNames = new Set((allPlayers ?? []).map((p: { name: string }) => p.name.trim().toLowerCase()))
      const dupe = rps.find((rp) => existingNames.has(rp.name.trim().toLowerCase()))
      if (dupe) return { error: `${dupe.name} is already in this round.` }
    }
  }

  let nextPosition = existing?.[0]?.position != null ? existing[0].position + 1 : 0
  // Preserve the order the admin picked them in
  const ordered = rosterPlayerIds
    .map((id) => rps.find((rp) => rp.id === id))
    .filter((rp): rp is NonNullable<typeof rp> => !!rp)
  const rows = ordered.map((rp) => ({
    name: rp.name, team_id: teamId, position: nextPosition++,
    handicap: rp.handicap_index ?? null, roster_player_id: rp.id,
  }))
  const { error } = await supabase.from('players').insert(rows)
  if (error) return { error: error.message }
  await logRoundEvent(supabase, teamRow?.round_id, 'Players added',
    `${ordered.map((rp) => rp.name).join(', ')} → ${teamRow?.name ?? 'team'}`)
  return { success: true }
}

export async function toggleMixedGroups(roundId: string, value: boolean) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const supabase = createServerClient()
  const update: Record<string, unknown> = { mixed_groups: value }
  if (value) {
    // Clear any existing playing groups and reset count so each enable starts fresh
    await supabase.from('playing_groups').delete().eq('round_id', roundId)
    update.playing_group_count = 0
    // Team-level side games don't apply in mixed mode — clear them so nothing sits
    // configured-but-inert (side games move to the playing groups)
    await supabase.from('teams').update({
      daytona_variant: null,
      daytona_variant_back9: null,
      banker_side_game: false,
      banker_side_game_min_bet: null,
      hammer_side_game: false,
      auto_strokes: false,
    }).eq('round_id', roundId)
  } else {
    // Leaving mixed mode: playing groups are meaningless — remove them
    await supabase.from('playing_groups').delete().eq('round_id', roundId)
    update.playing_group_count = 0
  }
  const { error } = await supabase.from('rounds').update(update).eq('id', roundId)
  if (error) return { error: error.message }
  await logRoundEvent(supabase, roundId, 'Round settings', `Mixed groups ${value ? 'on' : 'off'}`)
  return { success: true }
}

export async function addManualPlayerToGroup(groupId: string, name: string, handicap?: number | null) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const supabase = createServerClient()
  const { data: player, error: pe } = await supabase
    .from('players')
    .insert({ name, position: null, skins_participant: false, handicap: handicap ?? null })
    .select('id')
    .single()
  if (pe) return { error: pe.message }
  const { error: ge } = await supabase
    .from('playing_group_players')
    .insert({ playing_group_id: groupId, player_id: player.id })
  if (ge) return { error: ge.message }
  return { success: true, id: player.id as string }
}

export async function removeManualPlayerFromGroup(playerId: string) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const supabase = createServerClient()
  await supabase.from('playing_group_players').delete().eq('player_id', playerId)
  await supabase.from('players').delete().eq('id', playerId).is('team_id', null)
  return { success: true }
}

export async function setPlayingGroupCount(roundId: string, count: number) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const supabase = createServerClient()
  const { error } = await supabase.from('rounds').update({ playing_group_count: count }).eq('id', roundId)
  if (error) return { error: error.message }
  return { success: true }
}

export async function updatePlayingGroupSettings(groupId: string, settings: {
  daytona_variant: string | null
  banker_side_game: boolean
  banker_side_game_min_bet: number | null
  banker_side_game_max_bet?: number | null
  auto_strokes: boolean
  stroke_rounding?: string | null
}) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const supabase = createServerClient()
  const { data: before } = await supabase
    .from('playing_groups').select('name, round_id, daytona_variant, banker_side_game, auto_strokes, stroke_rounding')
    .eq('id', groupId).single()
  const { error } = await supabase.from('playing_groups').update(settings).eq('id', groupId)
  if (error) return { error: error.message }
  if (before) {
    const changes: string[] = []
    if ((before.daytona_variant ?? null) !== settings.daytona_variant) changes.push(`variant → ${settings.daytona_variant ?? 'none'}`)
    if (!!before.banker_side_game !== settings.banker_side_game) changes.push(`banker side game ${settings.banker_side_game ? 'on' : 'off'}`)
    if (!!before.auto_strokes !== settings.auto_strokes) changes.push(`auto strokes ${settings.auto_strokes ? 'on' : 'off'}`)
    if (settings.stroke_rounding !== undefined && (before.stroke_rounding ?? null) !== settings.stroke_rounding) changes.push(`stroke rounding → ${settings.stroke_rounding ?? 'default'}`)
    if (changes.length) await logRoundEvent(supabase, before.round_id, 'Group settings', `${before.name}: ${changes.join(', ')}`)
  }
  return { success: true }
}

export async function setRoundExcludeMatchups(roundId: string, exclude: boolean) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const supabase = createServerClient()
  const { error } = await supabase.from('rounds').update({ exclude_matchups: exclude }).eq('id', roundId)
  if (error) return { error: error.message }
  return { success: true }
}

export async function createPlayingGroup(roundId: string, name: string, pin: string) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const supabase = createServerClient()
  const { data, error } = await supabase.from('playing_groups').insert({ round_id: roundId, name, pin }).select('id').single()
  if (error) return { error: error.message }
  return { success: true, id: data.id }
}

export async function deletePlayingGroup(groupId: string) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const supabase = createServerClient()
  await supabase.from('playing_groups').delete().eq('id', groupId)
  return { success: true }
}

export async function setPlayerGroup(playerId: string, groupId: string | null) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const supabase = createServerClient()
  await supabase.from('playing_group_players').delete().eq('player_id', playerId)
  if (groupId) {
    await supabase.from('playing_group_players').insert({ playing_group_id: groupId, player_id: playerId })
  }
  return { success: true }
}

export async function submitGroupHoleScores(
  groupId: string,
  holeNumber: number,
  playerScores: { playerId: string; strokes: number }[]
) {
  const cookieStore = await cookies()
  if (!cookieStore.get(`playing_group_auth_${groupId}`)?.value) return { error: 'Session expired. Please log in again.' }
  const supabase = createServerClient()
  const rows = playerScores
    .filter(({ strokes }) => strokes >= 1 && strokes <= 20)
    .map(({ playerId, strokes }) => ({ player_id: playerId, hole_number: holeNumber, strokes }))
  if (rows.length > 0) {
    const { error } = await supabase.from('scores').upsert(rows, { onConflict: 'player_id,hole_number' })
    if (error) return { error: error.message }
    const { data: groupRow } = await supabase.from('playing_groups').select('round_id, name').eq('id', groupId).single()
    await notifyScoreEvents(supabase, groupRow?.round_id, groupRow?.name ?? 'A group', holeNumber)
  }
  return { success: true }
}

// ── PWA push subscriptions ────────────────────────────────────────────────────

export async function savePushSubscription(subscription: { endpoint: string; keys?: Record<string, string> }) {
  const authError = await requireAnyLogin()
  if (authError) return { error: authError }
  if (!subscription?.endpoint) return { error: 'Invalid subscription.' }
  const supabase = createServerClient()
  const { error } = await supabase.from('push_subscriptions').upsert(
    { endpoint: subscription.endpoint, subscription },
    { onConflict: 'endpoint' }
  )
  if (error) return { error: error.message }
  return { success: true }
}

export async function removePushSubscription(endpoint: string) {
  const authError = await requireAnyLogin()
  if (authError) return { error: authError }
  if (!endpoint) return { error: 'Invalid subscription.' }
  const supabase = createServerClient()
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
  return { success: true }
}

export async function updateRoundAutoHandicap(roundId: string, autoHandicap: boolean) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const supabase = createServerClient()
  const { error } = await supabase.from('rounds').update({ auto_handicap: autoHandicap }).eq('id', roundId)
  if (error) return { error: error.message }
  await logRoundEvent(supabase, roundId, 'Handicap settings', `Auto strokes ${autoHandicap ? 'on' : 'off'}`)
  return { success: true }
}

export async function updateRoundHandicapRounding(roundId: string, mode: string) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const supabase = createServerClient()
  const { error } = await supabase.from('rounds').update({ handicap_rounding: mode }).eq('id', roundId)
  if (error) return { error: error.message }
  await logRoundEvent(supabase, roundId, 'Handicap settings', `Rounding → ${mode}`)
  return { success: true }
}

export async function updateRoundName(roundId: string, name: string) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const supabase = createServerClient()
  const { error } = await supabase.from('rounds').update({ name: name.trim() }).eq('id', roundId)
  if (error) return { error: error.message }
  await logRoundEvent(supabase, roundId, 'Round renamed', name.trim())
  return { success: true }
}

export async function saveBankerHole(roundId: string, teamId: string, holeNumber: number, bankerPlayerId: string | null, maxBet: number) {
  const authError = await requireAnyLogin()
  if (authError) return { error: authError }
  const supabase = createServerClient()
  const { error } = await supabase.from('banker_holes').upsert(
    { round_id: roundId, team_id: teamId, hole_number: holeNumber, banker_player_id: bankerPlayerId, max_bet: maxBet },
    { onConflict: 'round_id,team_id,hole_number' }
  )
  if (error) return { error: error.message }
  return { success: true }
}

export async function saveBankerBets(roundId: string, teamId: string, holeNumber: number, bets: { playerId: string; baseBet: number; playerDoubled: boolean; bankerDoubled: boolean }[]) {
  const authError = await requireAnyLogin()
  if (authError) return { error: authError }
  const supabase = createServerClient()
  const { error: delErr } = await supabase.from('banker_bets').delete().eq('round_id', roundId).eq('team_id', teamId).eq('hole_number', holeNumber)
  if (delErr) return { error: delErr.message }
  if (bets.length > 0) {
    const { error: insErr } = await supabase.from('banker_bets').insert(
      bets.map((b) => ({ round_id: roundId, team_id: teamId, hole_number: holeNumber, player_id: b.playerId, base_bet: b.baseBet, player_doubled: b.playerDoubled, banker_doubled: b.bankerDoubled }))
    )
    if (insErr) return { error: insErr.message }
  }
  return { success: true }
}

export async function saveHoleStrokes(roundId: string, holeNumber: number, playerIds: string[], scopeToPlayerIds?: string[]) {
  const authError = await requireAnyLogin()
  if (authError) return { error: authError }
  const supabase = createServerClient()
  // Scope the delete to only the current group's players to avoid clearing strokes for other groups in the same round
  if (scopeToPlayerIds && scopeToPlayerIds.length > 0) {
    await supabase.from('hole_strokes').delete().eq('round_id', roundId).eq('hole_number', holeNumber).in('player_id', scopeToPlayerIds)
  } else {
    await supabase.from('hole_strokes').delete().eq('round_id', roundId).eq('hole_number', holeNumber)
  }
  if (playerIds.length > 0) {
    await supabase.from('hole_strokes').insert(
      playerIds.map((pid) => ({ round_id: roundId, hole_number: holeNumber, player_id: pid }))
    )
  }
  return { success: true }
}

export async function updateSkinsSettings(_prev: unknown, formData: FormData) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const roundId = formData.get('roundId') as string
  const enabled = formData.get('skins_enabled') === 'true'
  const amount = parseFloat(formData.get('skins_amount') as string) || 0
  const mode = (formData.get('skins_mode') as string) === 'pot' ? 'pot' : 'per_hole'
  const supabase = createServerClient()
  const { data: before } = await supabase.from('rounds').select('skins_enabled, skins_amount, skins_mode').eq('id', roundId).single()
  const { error } = await supabase.from('rounds').update({ skins_enabled: enabled, skins_amount: amount, skins_mode: mode }).eq('id', roundId)
  if (error) return { error: error.message }
  const fmtSkins = (en: boolean, amt: number, m: string) => en ? `on — $${amt} ${m === 'pot' ? 'pot' : 'per hole'}` : 'off'
  if (before && (!!before.skins_enabled !== enabled || (before.skins_amount ?? 0) !== amount || (before.skins_mode ?? 'per_hole') !== mode)) {
    await logRoundEvent(supabase, roundId, 'Skins settings',
      `${fmtSkins(!!before.skins_enabled, before.skins_amount ?? 0, before.skins_mode ?? 'per_hole')} → ${fmtSkins(enabled, amount, mode)}`)
  }
  return { success: true }
}

export async function updatePlayerSkinsParticipation(playerId: string, participates: boolean) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const supabase = createServerClient()
  const before = await playerAuditContext(supabase, playerId)
  const { error } = await supabase.from('players').update({ skins_participant: participates }).eq('id', playerId)
  if (error) return { error: error.message }
  if (before && before.skinsParticipant !== participates) {
    await logRoundEvent(supabase, before.roundId, 'Skins participants', `${before.name} ${participates ? 'added to' : 'removed from'} skins`)
  }
  return { success: true }
}

export async function deletePlayer(playerId: string) {
  if (await requireAdminAuth()) return
  const supabase = createServerClient()
  const before = await playerAuditContext(supabase, playerId)
  await supabase.from('players').delete().eq('id', playerId)
  if (before) await logRoundEvent(supabase, before.roundId, 'Player removed', before.name)
}

// Convert a Nassau bet string to an Overall (straight) bet scoped to one nine:
// amount = that nine's Nassau amount (falling back to the Total amount), and the
// handicap becomes that nine's stroke value. Non-Nassau bets pass through.
function convertBetForNine(bet: string, nine: 'front9' | 'back9'): string {
  if (!bet || !bet.startsWith('nassau:')) return bet
  const p = bet.split(':')
  const rawAmt = p[1] ?? ''
  const amts = rawAmt.split('|')
  const [f, b, t] = amts.length === 3 ? amts : [rawAmt, rawAmt, rawAmt]
  const amt = (nine === 'front9' ? f : b) || t || ''
  const scoring = p[2] === 'match' ? 'match' : 'stroke'
  const side = p[4] ?? ''
  const nineStrokes = parseFloat((nine === 'front9' ? p[5] : p[6]) ?? '') || 0
  if (side && nineStrokes > 0) return `straight:${amt}:${scoring}::${side}:0:0:${nineStrokes}`
  return `straight:${amt}:${scoring}`
}

export async function updatePlayerHolesRange(playerId: string, holesRange: string) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  const supabase = createServerClient()
  const before = await playerAuditContext(supabase, playerId)
  const { error } = await supabase.from('players').update({ holes_range: holesRange }).eq('id', playerId)
  if (error) return { error: error.message }
  if (before && (before.holesRange ?? 'all') !== holesRange) {
    await logRoundEvent(supabase, before.roundId, 'Holes range', `${before.name}: ${before.holesRange ?? 'all'} → ${holesRange}`)
  }

  // Lock this player's existing matchups to their nine and auto-convert any
  // Nassau bets to Overall — a 9-hole player can't play a three-way bet.
  if (holesRange === 'front9' || holesRange === 'back9') {
    const [{ data: h2h }, { data: bb }] = await Promise.all([
      supabase.from('matchups').select('id, bet, hole_range').or(`player1_id.eq.${playerId},player2_id.eq.${playerId}`),
      supabase.from('best_ball_matchups').select('id, bet, hole_range').or(`team1_player1_id.eq.${playerId},team1_player2_id.eq.${playerId},team2_player1_id.eq.${playerId},team2_player2_id.eq.${playerId}`),
    ])
    await Promise.all([
      ...(h2h ?? []).map((m) =>
        supabase.from('matchups').update({ bet: convertBetForNine(m.bet ?? '', holesRange), hole_range: holesRange }).eq('id', m.id)),
      ...(bb ?? []).map((m) =>
        supabase.from('best_ball_matchups').update({ bet: convertBetForNine(m.bet ?? '', holesRange), hole_range: holesRange }).eq('id', m.id)),
    ])
  }
  return { success: true }
}

// Deletes every score in the round (team players and playing-group guests)
// and stamps scores_cleared_at so open scorekeeper screens reload.
export async function clearAllScores(roundId: string) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  if (!roundId) return { error: 'No round.' }
  const supabase = createServerClient()

  const [{ data: teams }, { data: groups }] = await Promise.all([
    supabase.from('teams').select('id').eq('round_id', roundId),
    supabase.from('playing_groups').select('id').eq('round_id', roundId),
  ])
  const teamIds = (teams ?? []).map((t) => t.id)
  const groupIds = (groups ?? []).map((g) => g.id)

  const [{ data: teamPlayers }, { data: groupLinks }] = await Promise.all([
    teamIds.length ? supabase.from('players').select('id').in('team_id', teamIds) : Promise.resolve({ data: [] as { id: string }[] }),
    groupIds.length ? supabase.from('playing_group_players').select('player_id').in('playing_group_id', groupIds) : Promise.resolve({ data: [] as { player_id: string }[] }),
  ])
  const playerIds = [...new Set([
    ...(teamPlayers ?? []).map((p) => p.id),
    ...(groupLinks ?? []).map((l) => l.player_id),
  ])]

  if (playerIds.length > 0) {
    const { error } = await supabase.from('scores').delete().in('player_id', playerIds)
    if (error) return { error: error.message }
  }
  await supabase.from('rounds').update({ scores_cleared_at: new Date().toISOString(), first_score_at: null, front9_notified_at: null, finished_notified_at: null }).eq('id', roundId)
  await logRoundEvent(supabase, roundId, 'Scores cleared', 'Every score in the round deleted')
  return { success: true }
}

// Positions >= 100 mark a team as manually reordered (drag & drop); teams
// without any such position display in handicap order by default.
export async function reorderTeamPlayers(teamId: string, orderedIds: string[]) {
  if (await requireAdminAuth()) return
  const supabase = createServerClient()
  await Promise.all(orderedIds.map((id, i) =>
    supabase.from('players').update({ position: 100 + i }).eq('id', id).eq('team_id', teamId)
  ))
}

export async function movePlayer(playerId: string, direction: 'up' | 'down') {
  if (await requireAdminAuth()) return
  const supabase = createServerClient()

  const { data: player } = await supabase
    .from('players').select('id, team_id, position').eq('id', playerId).single()
  if (!player) return

  const { data: teammates } = await supabase
    .from('players').select('id, position').eq('team_id', player.team_id)
    .order('position', { ascending: true })
  if (!teammates || teammates.length < 2) return

  const idx = teammates.findIndex((p) => p.id === playerId)
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1
  if (swapIdx < 0 || swapIdx >= teammates.length) return

  const other = teammates[swapIdx]
  await Promise.all([
    supabase.from('players').update({ position: other.position }).eq('id', player.id),
    supabase.from('players').update({ position: player.position }).eq('id', other.id),
  ])
}

// ── Daytona hole assignments ──────────────────────────────────────────────────

// ── Matchups ──────────────────────────────────────────────────────────────────

// Fetches a head-to-head matchup's round + player label for audit logging.
async function h2hAuditContext(sb: ReturnType<typeof createServerClient>, id: string): Promise<{ roundId: string; label: string } | null> {
  const { data: m } = await sb.from('matchups').select('round_id, player1_id, player2_id').eq('id', id).single()
  if (!m) return null
  return { roundId: m.round_id, label: await matchupLabel(sb, m.player1_id, m.player2_id) }
}

export async function saveMatchup(roundId: string, player1Id: string, player2Id: string, bet: string, holeRange: string = 'all') {
  const authError = await requireAnyLogin()
  if (authError) return { error: authError }
  const sb = createServerClient()
  const { data, error } = await sb.from('matchups').insert({
    round_id: roundId,
    player1_id: player1Id,
    player2_id: player2Id,
    bet: bet.trim(),
    hole_range: holeRange,
  }).select('id').single()
  if (error) return { error: error.message }
  await logRoundEvent(sb, roundId, 'Matchup added', `${await matchupLabel(sb, player1Id, player2Id)} — ${bet.trim()}`)
  return { id: data.id }
}

export async function updateMatchupHoleRange(id: string, holeRange: string) {
  const authError = await requireAnyLogin()
  if (authError) return { error: authError }
  const sb = createServerClient()
  const ctx = await h2hAuditContext(sb, id)
  const { error } = await sb.from('matchups').update({ hole_range: holeRange }).eq('id', id)
  if (error) return { error: error.message }
  if (ctx) await logRoundEvent(sb, ctx.roundId, 'Matchup range', `${ctx.label} → ${holeRange}`)
  return {}
}

export async function deleteMatchup(id: string) {
  const authError = await requireAnyLogin()
  if (authError) return { error: authError }
  const sb = createServerClient()
  const ctx = await h2hAuditContext(sb, id)
  const { error } = await sb.from('matchups').delete().eq('id', id)
  if (error) return { error: error.message }
  if (ctx) await logRoundEvent(sb, ctx.roundId, 'Matchup removed', ctx.label)
  return {}
}

export async function updateMatchupBet(id: string, bet: string) {
  const authError = await requireAnyLogin()
  if (authError) return { error: authError }
  const sb = createServerClient()
  const ctx = await h2hAuditContext(sb, id)
  const { error } = await sb.from('matchups').update({ bet: bet.trim() }).eq('id', id)
  if (error) return { error: error.message }
  if (ctx) await logRoundEvent(sb, ctx.roundId, 'Matchup bet', `${ctx.label} → ${bet.trim()}`)
  return {}
}

export async function updateMatchupPresses(id: string, presses: { id: string; holeStart: number; holeEnd: number; amount: number; strokesSide?: string; strokes?: number }[]) {
  const authError = await requireAnyLogin()
  if (authError) return { error: authError }
  const sb = createServerClient()
  const ctx = await h2hAuditContext(sb, id)
  const { error } = await sb.from('matchups').update({ press: presses }).eq('id', id)
  if (error) return { error: error.message }
  if (ctx) {
    await logRoundEvent(sb, ctx.roundId, 'Matchup presses',
      `${ctx.label}: ${presses.length ? presses.map((p) => `$${p.amount} H${p.holeStart}–${p.holeEnd}`).join(', ') : 'all presses removed'}`)
  }
  return {}
}

// Fetches a best-ball matchup's round + label for audit logging.
async function bbAuditContext(sb: ReturnType<typeof createServerClient>, id: string): Promise<{ roundId: string; label: string } | null> {
  const { data: m } = await sb.from('best_ball_matchups')
    .select('round_id, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id').eq('id', id).single()
  if (!m) return null
  return { roundId: m.round_id, label: await bestBallLabel(sb, m.team1_player1_id, m.team1_player2_id, m.team2_player1_id, m.team2_player2_id) }
}

export async function updateBestBallPresses(id: string, presses: { id: string; holeStart: number; holeEnd: number; amount: number; strokesSide?: string; strokes?: number }[]) {
  const authError = await requireAnyLogin()
  if (authError) return { error: authError }
  const sb = createServerClient()
  const ctx = await bbAuditContext(sb, id)
  const { error } = await sb.from('best_ball_matchups').update({ press: presses }).eq('id', id)
  if (error) return { error: error.message }
  if (ctx) {
    await logRoundEvent(sb, ctx.roundId, 'Matchup presses',
      `${ctx.label}: ${presses.length ? presses.map((p) => `$${p.amount} H${p.holeStart}–${p.holeEnd}`).join(', ') : 'all presses removed'}`)
  }
  return {}
}

export async function saveBestBallMatchup(
  roundId: string,
  team1Player1Id: string, team1Player2Id: string,
  team2Player1Id: string, team2Player2Id: string,
  bet: string,
  holeRange: string = 'all',
  playerStrokes: Record<string, number> | null = null
) {
  const authError = await requireAnyLogin()
  if (authError) return { error: authError }
  const sb = createServerClient()
  const { data, error } = await sb.from('best_ball_matchups').insert({
    round_id: roundId,
    team1_player1_id: team1Player1Id,
    team1_player2_id: team1Player2Id,
    team2_player1_id: team2Player1Id,
    team2_player2_id: team2Player2Id,
    bet: bet.trim(),
    hole_range: holeRange,
    player_strokes: playerStrokes,
  }).select('id').single()
  if (error) return { error: error.message }
  await logRoundEvent(sb, roundId, 'Matchup added',
    `${await bestBallLabel(sb, team1Player1Id, team1Player2Id, team2Player1Id, team2Player2Id)} — ${bet.trim()}`)
  return { id: data.id }
}

export async function updateBestBallHoleRange(id: string, holeRange: string) {
  const authError = await requireAnyLogin()
  if (authError) return { error: authError }
  const sb = createServerClient()
  const ctx = await bbAuditContext(sb, id)
  const { error } = await sb.from('best_ball_matchups').update({ hole_range: holeRange }).eq('id', id)
  if (error) return { error: error.message }
  if (ctx) await logRoundEvent(sb, ctx.roundId, 'Matchup range', `${ctx.label} → ${holeRange}`)
  return {}
}

export async function updateBestBallPlayerStrokes(id: string, playerStrokes: Record<string, number> | null) {
  const authError = await requireAnyLogin()
  if (authError) return { error: authError }
  const sb = createServerClient()
  const ctx = await bbAuditContext(sb, id)
  const { error } = await sb.from('best_ball_matchups').update({ player_strokes: playerStrokes }).eq('id', id)
  if (error) return { error: error.message }
  if (ctx) await logRoundEvent(sb, ctx.roundId, 'Matchup strokes', `${ctx.label}: custom strokes ${playerStrokes ? 'set' : 'cleared'}`)
  return {}
}

// ── Medley matchups ───────────────────────────────────────────────────────────

export async function saveMedleyMatchup(
  roundId: string,
  players: { id: string; front?: number | null; back?: number | null; total?: number | null }[],
  betType: string,
  amount: number
) {
  const authError = await requireAnyLogin()
  if (authError) return { error: authError }
  if (players.length < 3) return { error: 'Medley needs at least 3 players.' }
  const sb = createServerClient()
  // A player can only be in one medley at a time
  const { data: existing } = await sb.from('medley_matchups').select('players').eq('round_id', roundId)
  const taken = new Set((existing ?? []).flatMap((m) => ((m.players ?? []) as { id: string }[]).map((e) => e.id)))
  if (players.some((p) => taken.has(p.id))) return { error: 'A player can only be in one medley at a time.' }
  const { data, error } = await sb.from('medley_matchups').insert({
    round_id: roundId, players, bet_type: betType, amount,
  }).select('id').single()
  if (error) return { error: error.message }
  await logRoundEvent(sb, roundId, 'Matchup added', `Medley: ${await medleyLabel(sb, players)} — ${betType} $${amount}`)
  return { id: data.id }
}

// "John, Bob, Steve" for a medley's players array.
async function medleyLabel(sb: ReturnType<typeof createServerClient>, players: { id: string }[]): Promise<string> {
  const names = await playerNames(sb, players.map((p) => p.id))
  return players.map((p) => firstName(names.get(p.id))).join(', ')
}

// Fetches a medley matchup's round + label for audit logging.
async function medleyAuditContext(sb: ReturnType<typeof createServerClient>, id: string): Promise<{ roundId: string; label: string } | null> {
  const { data: m } = await sb.from('medley_matchups').select('round_id, players').eq('id', id).single()
  if (!m) return null
  return { roundId: m.round_id, label: await medleyLabel(sb, ((m.players ?? []) as { id: string }[])) }
}

export async function updateMedleyMatchup(
  id: string,
  players: { id: string; front?: number | null; back?: number | null; total?: number | null }[],
  betType: string,
  amount: number
) {
  const authError = await requireAnyLogin()
  if (authError) return { error: authError }
  const sb = createServerClient()
  const ctx = await medleyAuditContext(sb, id)
  const { error } = await sb.from('medley_matchups').update({ players, bet_type: betType, amount }).eq('id', id)
  if (error) return { error: error.message }
  if (ctx) await logRoundEvent(sb, ctx.roundId, 'Matchup edited', `Medley: ${await medleyLabel(sb, players)} — ${betType} $${amount}`)
  return {}
}

export async function updateMedleyPresses(id: string, presses: { id: string; holeStart: number; holeEnd: number; amount: number; strokes?: Record<string, number> | null }[]) {
  const authError = await requireAnyLogin()
  if (authError) return { error: authError }
  const sb = createServerClient()
  const ctx = await medleyAuditContext(sb, id)
  const { error } = await sb.from('medley_matchups').update({ press: presses }).eq('id', id)
  if (error) return { error: error.message }
  if (ctx) {
    await logRoundEvent(sb, ctx.roundId, 'Matchup presses',
      `Medley ${ctx.label}: ${presses.length ? presses.map((p) => `$${p.amount} H${p.holeStart}–${p.holeEnd}`).join(', ') : 'all presses removed'}`)
  }
  return {}
}

export async function deleteMedleyMatchup(id: string) {
  const authError = await requireAnyLogin()
  if (authError) return { error: authError }
  const sb = createServerClient()
  const ctx = await medleyAuditContext(sb, id)
  const { error } = await sb.from('medley_matchups').delete().eq('id', id)
  if (error) return { error: error.message }
  if (ctx) await logRoundEvent(sb, ctx.roundId, 'Matchup removed', `Medley: ${ctx.label}`)
  return {}
}

export async function deleteBestBallMatchup(id: string) {
  const authError = await requireAnyLogin()
  if (authError) return { error: authError }
  const sb = createServerClient()
  const ctx = await bbAuditContext(sb, id)
  const { error } = await sb.from('best_ball_matchups').delete().eq('id', id)
  if (error) return { error: error.message }
  if (ctx) await logRoundEvent(sb, ctx.roundId, 'Matchup removed', ctx.label)
  return {}
}

export async function updateBestBallBet(id: string, bet: string) {
  const authError = await requireAnyLogin()
  if (authError) return { error: authError }
  const sb = createServerClient()
  const ctx = await bbAuditContext(sb, id)
  const { error } = await sb.from('best_ball_matchups').update({ bet: bet.trim() }).eq('id', id)
  if (error) return { error: error.message }
  if (ctx) await logRoundEvent(sb, ctx.roundId, 'Matchup bet', `${ctx.label} → ${bet.trim()}`)
  return {}
}

// Save per-hole Daytona payout value overrides for a specific group (team).
// Pass valuePerPoint: null to clear a hole's override (revert to round default).
export async function saveDaytonaHoleValues(
  roundId: string,
  teamId: string,
  entries: { holeNumber: number; valuePerPoint: number | null }[]
) {
  const authError = await requireAnyLogin()
  if (authError) return { error: authError }
  const supabase = createServerClient()
  const toDelete = entries.filter((e) => e.valuePerPoint === null).map((e) => e.holeNumber)
  const toUpsert = entries.filter((e) => e.valuePerPoint !== null) as { holeNumber: number; valuePerPoint: number }[]
  if (toDelete.length > 0) {
    await supabase.from('daytona_hole_values')
      .delete()
      .eq('round_id', roundId)
      .eq('team_id', teamId)
      .in('hole_number', toDelete)
  }
  if (toUpsert.length > 0) {
    // Delete existing rows then insert fresh — avoids needing a unique constraint for conflict resolution
    const holeNums = toUpsert.map((e) => e.holeNumber)
    await supabase.from('daytona_hole_values')
      .delete()
      .eq('round_id', roundId)
      .eq('team_id', teamId)
      .in('hole_number', holeNums)
    const { error } = await supabase.from('daytona_hole_values').insert(
      toUpsert.map((e) => ({ round_id: roundId, team_id: teamId, hole_number: e.holeNumber, value_per_point: e.valuePerPoint }))
    )
    if (error) return { error: error.message }
  }
  // A press changes the money — record it. teamId is a team OR playing-group id.
  if (entries.length > 0) {
    const [{ data: team }, { data: group }] = await Promise.all([
      supabase.from('teams').select('name').eq('id', teamId).maybeSingle(),
      supabase.from('playing_groups').select('name').eq('id', teamId).maybeSingle(),
    ])
    const who = team?.name ?? group?.name ?? 'a group'
    const nums = entries.map((e) => e.holeNumber).sort((a, b) => a - b)
    const span = nums.length === 1 ? `H${nums[0]}` : `H${nums[0]}–${nums[nums.length - 1]}`
    const rate = entries[0].valuePerPoint
    await logRoundEvent(supabase, roundId, 'Daytona press', `${who}: ${span} → ${rate === null ? 'default rate' : `$${rate}/pt`}`)
  }
  return { success: true }
}

export async function saveDaytonaAssignments(
  roundId: string,
  holeNumber: number,
  assignments: { playerId: string; side: 'left' | 'right' }[]
) {
  const authError = await requireAnyLogin()
  if (authError) return { error: authError }
  const supabase = createServerClient()
  // Scope the delete to only this group's players — other groups share the same
  // round_id + hole_number, so a round-wide delete would wipe their assignments.
  const playerIds = assignments.map((a) => a.playerId)
  if (playerIds.length > 0) {
    await supabase.from('daytona_hole_assignments')
      .delete()
      .eq('round_id', roundId)
      .eq('hole_number', holeNumber)
      .in('player_id', playerIds)
  }
  if (assignments.length > 0) {
    const { error } = await supabase.from('daytona_hole_assignments').insert(
      assignments.map((a) => ({ round_id: roundId, hole_number: holeNumber, player_id: a.playerId, side: a.side }))
    )
    if (error) return { success: false, error: error.message }
  }
  return { success: true }
}

// ── Team Generator ────────────────────────────────────────────────────────────

export async function bulkCreateTeams(
  roundId: string,
  teams: { name: string; pin: string; players: { name: string; handicap: number | null; skins?: boolean; rosterPlayerId?: string | null }[] }[]
) {
  const authError = await requireAdminAuth()
  if (authError) return { error: authError }
  if (!roundId || !teams.length) return { error: 'Invalid input.' }
  const supabase = createServerClient()

  // Remove existing non-admin teams (cascades to players/scores via FK)
  const { error: delError } = await supabase.from('teams').delete().eq('round_id', roundId).eq('is_admin', false)
  if (delError) return { error: delError.message }

  for (const team of teams) {
    const { data: teamRow, error: teamErr } = await supabase
      .from('teams')
      .insert({ name: team.name, pin: team.pin, round_id: roundId, is_admin: false })
      .select('id').single()
    if (teamErr) return { error: teamErr.message }

    if (team.players.length) {
      const { error: playersErr } = await supabase.from('players').insert(
        team.players.map((p, i) => ({
          name: p.name, team_id: teamRow.id, position: i,
          skins_participant: p.skins ?? false, handicap: p.handicap ?? null,
          roster_player_id: p.rosterPlayerId ?? null,
        }))
      )
      if (playersErr) return { error: playersErr.message }
    }
  }
  await logRoundEvent(supabase, roundId, 'Teams regenerated', `${teams.length} team(s): ${teams.map((t) => t.name).join(', ')}`)
  return { success: true }
}
