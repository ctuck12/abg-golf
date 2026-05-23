'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'

// ── Course presets ────────────────────────────────────────────────────────────

const COURSE_PARS: Record<string, number[]> = {
  north: [4, 4, 4, 3, 4, 4, 5, 3, 5, 3, 4, 4, 5, 3, 5, 4, 3, 4],
  south: [4, 4, 5, 3, 4, 4, 4, 3, 5, 4, 3, 4, 4, 5, 4, 3, 4, 5],
}
const COURSE_NAMES: Record<string, string> = {
  north: 'North Course',
  south: 'South Course',
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

export async function adminLogout() {
  const cookieStore = await cookies()
  cookieStore.delete('admin_auth')
  redirect('/admin')
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
  for (const { playerId, strokes } of playerScores) {
    if (strokes < 1 || strokes > 20) continue
    await supabase.from('scores').upsert(
      { player_id: playerId, hole_number: holeNumber, strokes },
      { onConflict: 'player_id,hole_number' }
    )
  }
  return { success: true }
}

// ── Admin: round management ───────────────────────────────────────────────────

export async function createRound(_prev: unknown, formData: FormData) {
  const name = (formData.get('name') as string)?.trim()
  const date = formData.get('date') as string
  const courseKey = (formData.get('course') as string) || 'north'
  const format = (formData.get('format') as string) || 'standard'
  const daytonaVariant = format === 'daytona' ? ((formData.get('daytona_variant') as string) || '4man') : null
  const ballsCount = format === 'daytona' ? 1 : (parseInt(formData.get('ballsCount') as string) || 3)

  if (!name || !date) return { error: 'Round name and date are required.' }

  const courseName = COURSE_NAMES[courseKey] ?? courseKey
  const pars = COURSE_PARS[courseKey] ?? Array(18).fill(4)

  const supabase = createServerClient()
  await supabase.from('rounds').update({ is_active: false }).eq('is_active', true)

  const { data: round, error } = await supabase
    .from('rounds')
    .insert({ name, date, course: courseName, balls_count: ballsCount, format, daytona_variant: daytonaVariant, is_active: true, is_started: false })
    .select().single()

  if (error || !round) return { error: error?.message ?? 'Failed to create round.' }

  await supabase.from('holes').insert(
    pars.map((par, i) => ({ round_id: round.id, hole_number: i + 1, par }))
  )

  await supabase.from('ball_values').insert(
    Array.from({ length: ballsCount }, (_, i) => ({ round_id: round.id, ball_number: i + 1, value_dollars: 10 }))
  )

  return { success: true, roundId: round.id }
}

export async function activateRound(roundId: string) {
  const supabase = createServerClient()
  await supabase.from('rounds').update({ is_started: true }).eq('id', roundId)
  redirect('/admin/dashboard')
}

export async function updateHolePars(_prev: unknown, formData: FormData) {
  const roundId = formData.get('roundId') as string
  const supabase = createServerClient()

  for (let i = 1; i <= 18; i++) {
    const par = parseInt(formData.get(`par_${i}`) as string) || 4
    await supabase.from('holes').update({ par }).eq('round_id', roundId).eq('hole_number', i)
  }
  return { success: true }
}

export async function updateBallValues(_prev: unknown, formData: FormData) {
  const roundId = formData.get('roundId') as string
  const ballsCount = parseInt(formData.get('ballsCount') as string) || 3
  const supabase = createServerClient()

  for (let i = 1; i <= ballsCount; i++) {
    const value = parseFloat(formData.get(`ball_${i}`) as string) || 0
    await supabase.from('ball_values')
      .upsert({ round_id: roundId, ball_number: i, value_dollars: value }, { onConflict: 'round_id,ball_number' })
  }
  return { success: true }
}

// ── Admin: team management ────────────────────────────────────────────────────

export async function addTeam(_prev: unknown, formData: FormData) {
  const name = (formData.get('name') as string)?.trim()
  const pin = (formData.get('pin') as string)?.trim()
  const roundId = formData.get('roundId') as string
  if (!name || !pin || !roundId) return { error: 'All fields required.' }
  if (!/^\d{4}$/.test(pin)) return { error: 'PIN must be exactly 4 digits.' }

  const supabase = createServerClient()
  const { error } = await supabase.from('teams').insert({ name, pin, round_id: roundId, is_admin: false })
  if (error) return { error: error.code === '23505' ? 'A team with that name already exists.' : error.message }
  return { success: true }
}

export async function renameTeam(_prev: unknown, formData: FormData) {
  const teamId = formData.get('teamId') as string
  const name = (formData.get('name') as string)?.trim()
  if (!teamId || !name) return { error: 'Team name required.' }

  const supabase = createServerClient()
  const { error } = await supabase.from('teams').update({ name }).eq('id', teamId)
  if (error) return { error: error.message }
  return { success: true }
}

export async function deleteTeam(teamId: string) {
  const supabase = createServerClient()
  await supabase.from('teams').delete().eq('id', teamId)
}

export async function toggleTeamAdmin(teamId: string, isAdmin: boolean) {
  const supabase = createServerClient()
  await supabase.from('teams').update({ is_admin: isAdmin }).eq('id', teamId)
}

export async function resetTeamScores(teamId: string) {
  const supabase = createServerClient()
  const { data: players } = await supabase.from('players').select('id').eq('team_id', teamId)
  if (players?.length) {
    await supabase.from('scores').delete().in('player_id', players.map((p) => p.id))
  }
}

// ── Admin: player management ──────────────────────────────────────────────────

export async function addPlayer(_prev: unknown, formData: FormData) {
  const name = (formData.get('name') as string)?.trim()
  const teamId = formData.get('teamId') as string
  if (!name || !teamId) return { error: 'Player name required.' }

  const supabase = createServerClient()
  // Place new player after all existing ones
  const { data: existing } = await supabase
    .from('players').select('position').eq('team_id', teamId).order('position', { ascending: false }).limit(1)
  const nextPosition = existing?.[0]?.position != null ? existing[0].position + 1 : 0
  const { error } = await supabase.from('players').insert({ name, team_id: teamId, position: nextPosition })
  if (error) return { error: error.message }
  return { success: true }
}

export async function deletePlayer(playerId: string) {
  const supabase = createServerClient()
  await supabase.from('players').delete().eq('id', playerId)
}

export async function movePlayer(playerId: string, direction: 'up' | 'down') {
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

export async function saveMatchup(roundId: string, player1Id: string, player2Id: string, bet: string) {
  const sb = createServerClient()
  const { data, error } = await sb.from('matchups').insert({
    round_id: roundId,
    player1_id: player1Id,
    player2_id: player2Id,
    bet: bet.trim(),
  }).select('id').single()
  if (error) return { error: error.message }
  return { id: data.id }
}

export async function deleteMatchup(id: string) {
  const sb = createServerClient()
  const { error } = await sb.from('matchups').delete().eq('id', id)
  if (error) return { error: error.message }
  return {}
}

export async function updateMatchupBet(id: string, bet: string) {
  const sb = createServerClient()
  const { error } = await sb.from('matchups').update({ bet: bet.trim() }).eq('id', id)
  if (error) return { error: error.message }
  return {}
}

export async function saveBestBallMatchup(
  roundId: string,
  team1Player1Id: string, team1Player2Id: string,
  team2Player1Id: string, team2Player2Id: string,
  bet: string
) {
  const sb = createServerClient()
  const { data, error } = await sb.from('best_ball_matchups').insert({
    round_id: roundId,
    team1_player1_id: team1Player1Id,
    team1_player2_id: team1Player2Id,
    team2_player1_id: team2Player1Id,
    team2_player2_id: team2Player2Id,
    bet: bet.trim(),
  }).select('id').single()
  if (error) return { error: error.message }
  return { id: data.id }
}

export async function deleteBestBallMatchup(id: string) {
  const sb = createServerClient()
  const { error } = await sb.from('best_ball_matchups').delete().eq('id', id)
  if (error) return { error: error.message }
  return {}
}

export async function updateBestBallBet(id: string, bet: string) {
  const sb = createServerClient()
  const { error } = await sb.from('best_ball_matchups').update({ bet: bet.trim() }).eq('id', id)
  if (error) return { error: error.message }
  return {}
}

export async function saveDaytonaAssignments(
  roundId: string,
  holeNumber: number,
  assignments: { playerId: string; side: 'left' | 'right' }[]
) {
  const supabase = createServerClient()
  await supabase.from('daytona_hole_assignments')
    .delete().eq('round_id', roundId).eq('hole_number', holeNumber)
  if (assignments.length > 0) {
    await supabase.from('daytona_hole_assignments').insert(
      assignments.map((a) => ({ round_id: roundId, hole_number: holeNumber, player_id: a.playerId, side: a.side }))
    )
  }
  return { success: true }
}
