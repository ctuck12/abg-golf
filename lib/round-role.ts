// How someone is using a given round on this device: entering scores, or just
// watching. Asked once on the leaderboard and then remembered, so the prompt
// never comes back for that round.
//
// Storage is injectable so this is testable, and every access is guarded: in
// Safari private mode localStorage throws on write. An in-memory map backs it
// up so a throwing store still can't make the prompt reappear on every render.

export type RoundRole = 'scorekeeper' | 'viewer'

export const roundRoleKey = (roundId: string) => `abg_role_${roundId}`

type Store = Pick<Storage, 'getItem' | 'setItem'>

const memory = new Map<string, RoundRole>()

function parse(value: string | null | undefined): RoundRole | null {
  return value === 'scorekeeper' || value === 'viewer' ? value : null
}

export function readRoundRole(storage: Store | null | undefined, roundId: string): RoundRole | null {
  if (!roundId) return null
  const held = memory.get(roundId)
  if (held) return held
  try {
    return parse(storage?.getItem(roundRoleKey(roundId)))
  } catch {
    return null
  }
}

export function writeRoundRole(storage: Store | null | undefined, roundId: string, role: RoundRole): void {
  if (!roundId) return
  memory.set(roundId, role)
  try {
    storage?.setItem(roundRoleKey(roundId), role)
  } catch {
    // Private mode — the memory map above still covers this tab.
  }
}

// Test seam: the memory map is module state and would otherwise leak between cases.
export function clearRoundRoleMemory(): void {
  memory.clear()
}
