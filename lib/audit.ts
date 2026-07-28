import { cookies } from 'next/headers'

import type { createServerClient } from '@/lib/supabase-server'

type SB = ReturnType<typeof createServerClient>

// ── Actor resolution ──────────────────────────────────────────────────────────

// Best-effort "who" from the device's auth cookies: a team/group login that
// belongs to this round is the most specific identity; otherwise an admin
// cookie means the org admin; otherwise unknown (e.g. direct API call).
async function resolveActor(supabase: SB, roundId: string): Promise<string> {
  try {
    const store = await cookies()
    const all = store.getAll().filter((c) => c.value)
    const teamIds = all.filter((c) => c.name.startsWith('team_auth_')).map((c) => c.name.slice('team_auth_'.length))
    const groupIds = all.filter((c) => c.name.startsWith('playing_group_auth_')).map((c) => c.name.slice('playing_group_auth_'.length))
    const isAdmin = all.some((c) => c.name === 'admin_auth' || c.name.startsWith('org_admin_'))

    const [{ data: teams }, { data: groups }] = await Promise.all([
      teamIds.length
        ? supabase.from('teams').select('name').eq('round_id', roundId).in('id', teamIds)
        : Promise.resolve({ data: [] as { name: string }[] }),
      groupIds.length
        ? supabase.from('playing_groups').select('name').eq('round_id', roundId).in('id', groupIds)
        : Promise.resolve({ data: [] as { name: string }[] }),
    ])
    const name = [...(teams ?? []), ...(groups ?? [])][0]?.name
    if (name) return isAdmin ? `${name} (admin)` : name
    return isAdmin ? 'Admin' : 'Unknown'
  } catch {
    return 'Unknown'
  }
}

// ── Event logging ─────────────────────────────────────────────────────────────

// Records one audit event for a round. Never throws and never surfaces an
// error to the caller — before the round_events table is created (see
// supabase/add_round_events.sql) the insert simply fails and is ignored.
export async function logRoundEvent(
  supabase: SB,
  roundId: string | null | undefined,
  action: string,
  detail: string
): Promise<void> {
  if (!roundId) return
  try {
    const actor = await resolveActor(supabase, roundId)
    await supabase.from('round_events').insert({ round_id: roundId, actor, action, detail })
  } catch (e) {
    console.error('[logRoundEvent] failed:', e)
  }
}

// ── Lookup helpers for building event details ────────────────────────────────

export function fmtHcp(h: number | null | undefined): string {
  return h == null ? 'none' : String(h)
}

// A player's name, current values, and the round they belong to — works for
// team players and playing-group guests (team_id null). Used to capture the
// "old" side of a change before writing, so read it BEFORE the update.
export async function playerAuditContext(supabase: SB, playerId: string): Promise<{
  name: string
  handicap: number | null
  holesRange: string | null
  skinsParticipant: boolean
  roundId: string | null
} | null> {
  const { data: p } = await supabase
    .from('players').select('name, handicap, holes_range, skins_participant, team_id')
    .eq('id', playerId).single()
  if (!p) return null

  let roundId: string | null = null
  if (p.team_id) {
    const { data: team } = await supabase.from('teams').select('round_id').eq('id', p.team_id).single()
    roundId = team?.round_id ?? null
  } else {
    const { data: link } = await supabase
      .from('playing_group_players').select('playing_group_id').eq('player_id', playerId).limit(1).maybeSingle()
    if (link?.playing_group_id) {
      const { data: group } = await supabase.from('playing_groups').select('round_id').eq('id', link.playing_group_id).single()
      roundId = group?.round_id ?? null
    }
  }
  return {
    name: p.name,
    handicap: p.handicap ?? null,
    holesRange: p.holes_range ?? null,
    skinsParticipant: !!p.skins_participant,
    roundId,
  }
}

// Map of player id → name for labeling matchup events.
export async function playerNames(supabase: SB, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (!unique.length) return new Map()
  const { data } = await supabase.from('players').select('id, name').in('id', unique)
  return new Map((data ?? []).map((p) => [p.id, p.name as string]))
}

export function firstName(full: string | undefined): string {
  return (full ?? '?').split(' ')[0]
}

// "John vs Bob" for a head-to-head matchup row.
export async function matchupLabel(supabase: SB, player1Id: string, player2Id: string): Promise<string> {
  const names = await playerNames(supabase, [player1Id, player2Id])
  return `${firstName(names.get(player1Id))} vs ${firstName(names.get(player2Id))}`
}

// "A/B vs C/D" for a best-ball matchup row.
export async function bestBallLabel(
  supabase: SB,
  t1p1: string, t1p2: string, t2p1: string, t2p2: string
): Promise<string> {
  const names = await playerNames(supabase, [t1p1, t1p2, t2p1, t2p2])
  const n = (id: string) => firstName(names.get(id))
  return `${n(t1p1)}/${n(t1p2)} vs ${n(t2p1)}/${n(t2p2)}`
}
