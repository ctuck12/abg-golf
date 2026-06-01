'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'

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
  const orgId = formData.get('orgId') as string
  const courseSlug = (formData.get('course') as string) || 'south'
  const format = (formData.get('format') as string) || 'standard'
  const daytonaVariant = null
  const isBanker = format === 'banker'
  const ballsCount = (format === 'daytona' || format === 'traditional' || isBanker) ? 1 : (parseInt(formData.get('ballsCount') as string) || 3)
  const includeTotal = (format !== 'daytona' && format !== 'traditional' && !isBanker) && formData.get('include_total') === 'true'
  const isNineHoleFormat = format === 'daytona' || format === 'traditional'
  const bankerMinBet = isBanker ? (parseFloat(formData.get('banker_min_bet') as string) || 2) : null
  const holeCount = isNineHoleFormat ? (parseInt(formData.get('holeCount') as string) || 18) : 18
  const startHole = (holeCount === 9) ? (parseInt(formData.get('startHole') as string) || 1) : 1

  if (!name || !date || !orgId) return { error: 'Round name, date, and org are required.' }

  const supabase = createServerClient()

  // Try DB course first, fall back to hardcoded constants for backward compat
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

  // Deactivate only this org's previous active round
  await supabase.from('rounds').update({ is_active: false }).eq('is_active', true).eq('org_id', orgId)

  const { data: round, error } = await supabase
    .from('rounds')
    .insert({ name, date, course: courseName, balls_count: ballsCount, format, daytona_variant: daytonaVariant, include_total: includeTotal, is_active: true, is_started: false, org_id: orgId, ...(bankerMinBet != null ? { banker_min_bet: bankerMinBet } : {}) })
    .select().single()

  if (error || !round) return { error: error?.message ?? 'Failed to create round.' }

  await Promise.all([
    supabase.from('holes').insert(
      pars.map((par, i) => ({ round_id: round.id, hole_number: startHole + i, par, stroke_index: strokeIndexes[i] ?? null }))
    ),
    supabase.from('ball_values').insert(
      Array.from({ length: ballsCount }, (_, i) => ({ round_id: round.id, ball_number: i + 1, value_dollars: 0 }))
    ),
  ])

  return { success: true, roundId: round.id }
}

export async function activateRound(roundId: string, orgSlug: string) {
  const supabase = createServerClient()
  await supabase.from('rounds').update({ is_started: true }).eq('id', roundId)
  redirect(`/${orgSlug}/admin/dashboard`)
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

  const daytonaVariant = (formData.get('daytona_variant') as string) || null

  const supabase = createServerClient()
  const { error } = await supabase.from('teams').insert({ name, pin, round_id: roundId, is_admin: false, daytona_variant: daytonaVariant })
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

export async function updateTeamSettings(_prev: unknown, formData: FormData) {
  const teamId = formData.get('teamId') as string
  const name = (formData.get('name') as string)?.trim()
  const pin = (formData.get('pin') as string)?.trim()
  const daytonaVariant = (formData.get('daytona_variant') as string) || null

  if (!teamId || !name) return { error: 'Group name required.' }
  if (pin && !/^\d{4}$/.test(pin)) return { error: 'PIN must be exactly 4 digits.' }

  const supabase = createServerClient()
  const updates: Record<string, unknown> = { name, daytona_variant: daytonaVariant }
  if (pin) updates.pin = pin

  const { error } = await supabase.from('teams').update(updates).eq('id', teamId)
  if (error) return { error: error.message }
  return { success: true }
}

export async function renamePlayer(_prev: unknown, formData: FormData) {
  const playerId = formData.get('playerId') as string
  const name = (formData.get('name') as string)?.trim()
  if (!playerId || !name) return { error: 'Player name required.' }

  const supabase = createServerClient()
  const { error } = await supabase.from('players').update({ name }).eq('id', playerId)
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
  const skinsParticipant = formData.get('skins_participant') === 'true'
  const handicapRaw = formData.get('handicap') as string
  const handicap = handicapRaw !== '' && handicapRaw != null ? parseFloat(handicapRaw) : null
  if (!name || !teamId) return { error: 'Player name required.' }

  const supabase = createServerClient()

  // Get the round for this team so we can check all players in the round
  const { data: teamRow } = await supabase.from('teams').select('round_id').eq('id', teamId).single()
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
  return { success: true }
}

export async function updatePlayerHandicap(playerId: string, handicap: number | null) {
  const supabase = createServerClient()
  const { error } = await supabase.from('players').update({ handicap }).eq('id', playerId)
  if (error) return { error: error.message }
  return { success: true }
}

// ── Org Player Roster ─────────────────────────────────────────────────────────

export async function createRosterPlayer(orgId: string, name: string, ghinNumber: string | null, handicapIndex: number | null, email: string | null) {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('org_players')
    .insert({ org_id: orgId, name: name.trim(), ghin_number: ghinNumber || null, handicap_index: handicapIndex, email: email || null })
    .select('id').single()
  if (error) return { error: error.code === '23505' ? `A player named "${name}" already exists in the roster.` : error.message }
  return { success: true, id: data.id }
}

export async function updateRosterPlayer(playerId: string, name: string, ghinNumber: string | null, handicapIndex: number | null, email: string | null) {
  const supabase = createServerClient()
  const { error } = await supabase
    .from('org_players')
    .update({ name: name.trim(), ghin_number: ghinNumber || null, handicap_index: handicapIndex, email: email || null })
    .eq('id', playerId)
  if (error) return { error: error.message }
  return { success: true }
}

export async function deleteRosterPlayer(playerId: string) {
  const supabase = createServerClient()
  await supabase.from('org_players').delete().eq('id', playerId)
  return { success: true }
}

export async function addRosterPlayerToTeam(teamId: string, rosterPlayerId: string) {
  const supabase = createServerClient()

  const { data: rp } = await supabase.from('org_players').select('name, handicap_index').eq('id', rosterPlayerId).single()
  if (!rp) return { error: 'Roster player not found.' }

  const { data: teamRow } = await supabase.from('teams').select('round_id').eq('id', teamId).single()
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
  return { success: true }
}

export async function toggleMixedGroups(roundId: string, value: boolean) {
  const supabase = createServerClient()
  const { error } = await supabase.from('rounds').update({ mixed_groups: value }).eq('id', roundId)
  if (error) return { error: error.message }
  return { success: true }
}

export async function createPlayingGroup(roundId: string, name: string, pin: string) {
  const supabase = createServerClient()
  const { data, error } = await supabase.from('playing_groups').insert({ round_id: roundId, name, pin }).select('id').single()
  if (error) return { error: error.message }
  return { success: true, id: data.id }
}

export async function deletePlayingGroup(groupId: string) {
  const supabase = createServerClient()
  await supabase.from('playing_groups').delete().eq('id', groupId)
  return { success: true }
}

export async function setPlayerGroup(playerId: string, groupId: string | null) {
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
  for (const { playerId, strokes } of playerScores) {
    if (strokes < 1 || strokes > 20) continue
    await supabase.from('scores').upsert(
      { player_id: playerId, hole_number: holeNumber, strokes },
      { onConflict: 'player_id,hole_number' }
    )
  }
  return { success: true }
}

export async function updateRoundAutoHandicap(roundId: string, autoHandicap: boolean) {
  const supabase = createServerClient()
  const { error } = await supabase.from('rounds').update({ auto_handicap: autoHandicap }).eq('id', roundId)
  if (error) return { error: error.message }
  return { success: true }
}

export async function saveBankerHole(roundId: string, teamId: string, holeNumber: number, bankerPlayerId: string | null, maxBet: number) {
  const supabase = createServerClient()
  await supabase.from('banker_holes').upsert(
    { round_id: roundId, team_id: teamId, hole_number: holeNumber, banker_player_id: bankerPlayerId, max_bet: maxBet },
    { onConflict: 'round_id,team_id,hole_number' }
  )
  return { success: true }
}

export async function saveBankerBets(roundId: string, teamId: string, holeNumber: number, bets: { playerId: string; baseBet: number; playerDoubled: boolean; bankerDoubled: boolean }[]) {
  const supabase = createServerClient()
  await supabase.from('banker_bets').delete().eq('round_id', roundId).eq('team_id', teamId).eq('hole_number', holeNumber)
  if (bets.length > 0) {
    await supabase.from('banker_bets').insert(
      bets.map((b) => ({ round_id: roundId, team_id: teamId, hole_number: holeNumber, player_id: b.playerId, base_bet: b.baseBet, player_doubled: b.playerDoubled, banker_doubled: b.bankerDoubled }))
    )
  }
  return { success: true }
}

export async function saveHoleStrokes(roundId: string, holeNumber: number, playerIds: string[]) {
  const supabase = createServerClient()
  // Delete existing strokes for this hole in this round, then re-insert
  const { data: roundPlayers } = await supabase
    .from('players')
    .select('id')
    .in('id', playerIds.length > 0 ? playerIds : [''])
  const ids = (roundPlayers ?? []).map((p: { id: string }) => p.id)
  await supabase.from('hole_strokes').delete().eq('round_id', roundId).eq('hole_number', holeNumber)
  if (playerIds.length > 0) {
    await supabase.from('hole_strokes').insert(
      playerIds.map((pid) => ({ round_id: roundId, hole_number: holeNumber, player_id: pid }))
    )
  }
  return { success: true }
}

export async function updateSkinsSettings(_prev: unknown, formData: FormData) {
  const roundId = formData.get('roundId') as string
  const enabled = formData.get('skins_enabled') === 'true'
  const amount = parseFloat(formData.get('skins_amount') as string) || 0
  const supabase = createServerClient()
  const { error } = await supabase.from('rounds').update({ skins_enabled: enabled, skins_amount: amount }).eq('id', roundId)
  if (error) return { error: error.message }
  return { success: true }
}

export async function updatePlayerSkinsParticipation(playerId: string, participates: boolean) {
  const supabase = createServerClient()
  const { error } = await supabase.from('players').update({ skins_participant: participates }).eq('id', playerId)
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

export async function updateMatchupPresses(id: string, presses: { id: string; holeStart: number; holeEnd: number; amount: number; strokesSide?: string; strokes?: number }[]) {
  const sb = createServerClient()
  const { error } = await sb.from('matchups').update({ press: presses }).eq('id', id)
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

// Save per-hole Daytona payout value overrides for a specific group (team).
// Pass valuePerPoint: null to clear a hole's override (revert to round default).
export async function saveDaytonaHoleValues(
  roundId: string,
  teamId: string,
  entries: { holeNumber: number; valuePerPoint: number | null }[]
) {
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
    await supabase.from('daytona_hole_values').upsert(
      toUpsert.map((e) => ({ round_id: roundId, team_id: teamId, hole_number: e.holeNumber, value_per_point: e.valuePerPoint })),
      { onConflict: 'round_id,team_id,hole_number' }
    )
  }
  return { success: true }
}

export async function saveDaytonaAssignments(
  roundId: string,
  holeNumber: number,
  assignments: { playerId: string; side: 'left' | 'right' }[]
) {
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
    await supabase.from('daytona_hole_assignments').insert(
      assignments.map((a) => ({ round_id: roundId, hole_number: holeNumber, player_id: a.playerId, side: a.side }))
    )
  }
  return { success: true }
}
