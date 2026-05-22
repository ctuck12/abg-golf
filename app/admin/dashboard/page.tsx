import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase-server'
import AdminDashboard from '@/app/components/AdminDashboard'

export const dynamic = 'force-dynamic'

export default async function AdminDashboardPage() {
  const cookieStore = await cookies()
  if (!cookieStore.get('admin_auth')?.value) redirect('/admin')

  // Diagnostic: check env vars exist
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return (
      <div style={{ padding: 32, fontFamily: 'monospace' }}>
        <h2 style={{ color: 'red' }}>Configuration Error</h2>
        <p>Missing environment variables:</p>
        <ul>
          {!url && <li>NEXT_PUBLIC_SUPABASE_URL is not set</li>}
          {!key && <li>SUPABASE_SERVICE_ROLE_KEY is not set</li>}
        </ul>
        <p>Add these in Vercel → Settings → Environment Variables, then redeploy.</p>
      </div>
    )
  }

  try {
    const sb = createServerClient()

    const { data: round, error: roundError } = await sb
      .from('rounds')
      .select('id, name, date, course, balls_count, is_started')
      .eq('is_active', true)
      .single()

    if (roundError && roundError.code !== 'PGRST116') {
      return (
        <div style={{ padding: 32, fontFamily: 'monospace' }}>
          <h2 style={{ color: 'red' }}>Supabase Error</h2>
          <p><strong>Code:</strong> {roundError.code}</p>
          <p><strong>Message:</strong> {roundError.message}</p>
          <p><strong>Hint:</strong> {roundError.hint}</p>
          <p style={{ marginTop: 16 }}>Check that your Supabase URL and keys are correct and the SQL schema was run successfully.</p>
        </div>
      )
    }

    const roundId = round?.id

    const [teamsRes, holesRes, ballValuesRes] = await Promise.all([
      roundId
        ? sb.from('teams').select('id, name, pin, is_admin').eq('round_id', roundId).order('name')
        : Promise.resolve({ data: [] }),
      roundId
        ? sb.from('holes').select('hole_number, par').eq('round_id', roundId).order('hole_number')
        : Promise.resolve({ data: [] }),
      roundId
        ? sb.from('ball_values').select('ball_number, value_dollars').eq('round_id', roundId).order('ball_number')
        : Promise.resolve({ data: [] }),
    ])

    const teams = teamsRes.data ?? []
    const teamIds = teams.map((t) => t.id)

    const [playersRes, scoresRes] = await Promise.all([
      teamIds.length
        ? sb.from('players').select('id, team_id, name').in('team_id', teamIds).order('name')
        : Promise.resolve({ data: [] }),
      roundId
        ? sb.from('scores').select('player_id, hole_number, strokes')
        : Promise.resolve({ data: [] }),
    ])

    return (
      <AdminDashboard
        round={round ?? null}
        teams={teams}
        players={playersRes.data ?? []}
        holes={holesRes.data ?? []}
        ballValues={ballValuesRes.data ?? []}
        scores={scoresRes.data ?? []}
      />
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return (
      <div style={{ padding: 32, fontFamily: 'monospace' }}>
        <h2 style={{ color: 'red' }}>Server Error</h2>
        <p>{message}</p>
        <p style={{ marginTop: 16 }}>URL configured: {url ? url.slice(0, 30) + '…' : 'MISSING'}</p>
        <p>Key configured: {key ? 'Yes (length ' + key.length + ')' : 'MISSING'}</p>
      </div>
    )
  }
}
