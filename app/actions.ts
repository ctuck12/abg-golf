'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'

// ── Course presets ────────────────────────────────────────────────────────────

export const COURSE_PARS: Record<string, number[]> = {
  north: [4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4],
  south: [4, 4, 3, 5, 4, 3, 4, 5, 4, 4, 4, 3, 5, 4, 3, 4, 5, 4],
}
export const COURSE_NAMES: Record<string, string> = {
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

  redirect(`/score/${teamId}`)
}

export async function adminLogin(_prev: unknown, formData: FormData) {
  const password = formData.get('password') as string
  if (!password || password !== process.env.ADMIN_PASSWORD) return { error: 'Incorrect password.' }

  const cookieStore = await cookies()
  cookieStore.set('admin_auth', 'true', { httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 8, path: '/' })
  redirect('/admin/dashboard')
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
  const ballsCount = parseInt(formData.get('ballsCount') as string) || 3

  if (!name || !date) return { error: 'Round name and date are required.' }

  const courseName = COURSE_NAMES[courseKey] ?? courseKey
  const pars = COURSE_PARS[courseKey] ?? Array(18).fill(4)

  const supabase = createServerClient()
  await supabase.from('rounds').update({ is_active: false }).eq('is_active', true)

  const { data: round, error } = await supabase
    .from('rounds')
    .insert({ name, date, course: courseName, balls_count: ballsCount, is_active: true, is_started: false })
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
  const { error } = await supabase.from('players').insert({ name, team_id: teamId })
  if (error) return { error: error.message }
  return { success: true }
}

export async function deletePlayer(playerId: string) {
  const supabase = createServerClient()
  await supabase.from('players').delete().eq('id', playerId)
}
