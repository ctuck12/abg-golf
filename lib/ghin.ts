// ── GHIN handicap lookup ──────────────────────────────────────────────────────
// Uses the same api2.ghin.com endpoints the GHIN app / ghin.com use, signed in
// with a regular GHIN.com golfer account (set GHIN_EMAIL / GHIN_PASSWORD in the
// environment — any golfer login works, e.g. the admin's own). This is the
// unofficial hobby-project route: the USGA's official API is only licensed to
// golf associations, so if the endpoints change this module is the one place
// to update.

const GHIN_API = 'https://api2.ghin.com/api/v1'

let cachedToken: { token: string; at: number } | null = null
const TOKEN_TTL_MS = 30 * 60 * 1000

async function ghinLogin(): Promise<string> {
  const email = process.env.GHIN_EMAIL
  const password = process.env.GHIN_PASSWORD
  if (!email || !password) {
    throw new Error('GHIN sync is not configured — set GHIN_EMAIL and GHIN_PASSWORD (a ghin.com golfer login) in the environment.')
  }
  if (cachedToken && Date.now() - cachedToken.at < TOKEN_TTL_MS) return cachedToken.token

  const res = await fetch(`${GHIN_API}/golfer_login.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: 'nonblank',
      user: { email_or_ghin: email, password, remember_me: true },
      source: 'GHINcom',
    }),
  })
  if (!res.ok) throw new Error(`GHIN login failed (HTTP ${res.status}) — check GHIN_EMAIL / GHIN_PASSWORD.`)
  const data = await res.json().catch(() => null) as { golfer_user?: { golfer_user_token?: string } } | null
  const token = data?.golfer_user?.golfer_user_token
  if (!token) throw new Error('GHIN login succeeded but returned no token — the GHIN API may have changed.')
  cachedToken = { token, at: Date.now() }
  return token
}

// "5.2" → 5.2 · "+1.4" (plus handicap) → -1.4 · "NH"/missing → null
export function parseGhinIndex(raw: unknown): number | null {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s || s.toUpperCase() === 'NH') return null
  const n = s.startsWith('+') ? -parseFloat(s.slice(1)) : parseFloat(s)
  return isNaN(n) ? null : n
}

export async function fetchGhinHandicap(ghinNumber: string): Promise<number | null> {
  const token = await ghinLogin()
  const lookup = async (path: string) => {
    const res = await fetch(`${GHIN_API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.status === 401) { cachedToken = null; throw new Error('GHIN session expired — try again.') }
    if (!res.ok) throw new Error(`GHIN lookup failed (HTTP ${res.status})`)
    const data = await res.json().catch(() => null) as { golfers?: { handicap_index?: unknown }[] } | null
    return data?.golfers?.[0]
  }
  const q = `golfer_id=${encodeURIComponent(ghinNumber.trim())}&page=1&per_page=1&source=GHINcom`
  // Primary endpoint, with the older variant as a fallback in case one moves.
  let golfer = await lookup(`/golfers/search.json?${q}`).catch(() => undefined)
  if (!golfer) golfer = await lookup(`/golfers.json?${q}`)
  if (!golfer) throw new Error(`No GHIN golfer found for #${ghinNumber}`)
  return parseGhinIndex(golfer.handicap_index)
}
