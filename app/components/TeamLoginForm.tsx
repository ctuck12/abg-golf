'use client'

import { useActionState } from 'react'
import { teamLogin } from '@/app/actions'

type Team = { id: string; name: string }
type Round = { id: string; name: string; date: string; course: string; balls_count: number }

const navy = '#0f172a'
const gold = '#f59e0b'

export default function TeamLoginForm({ teams, round }: { teams: Team[]; round: Round }) {
  const [state, action, pending] = useActionState(teamLogin, null)
  const ballLabels = Array.from({ length: round.balls_count }, (_, i) => `${i + 1}-ball`).join(', ')
  const formattedDate = new Date(round.date + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>
      <header className="text-white py-7 px-4 text-center shadow-md" style={{ background: navy }}>
        <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: gold }}>
          Anything But Golf Group
        </p>
        <h1 className="text-2xl font-bold">{round.name}</h1>
        <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
          {round.course && `${round.course} · `}{formattedDate}
        </p>
        <p className="text-xs mt-1" style={{ color: gold }}>
          Playing {ballLabels}
        </p>
      </header>

      <main className="max-w-sm mx-auto px-4 pt-8">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-5">Enter Your Scores</h2>
          <form action={action} className="space-y-4">
            {state?.error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{state.error}</p>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Your Team</label>
              <select name="teamId" required defaultValue=""
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 bg-white text-gray-900 focus:outline-none">
                <option value="" disabled>Select your team…</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Team PIN</label>
              <input type="password" name="pin" inputMode="numeric" maxLength={4} required
                placeholder="4-digit PIN"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-gray-900 focus:outline-none" />
              <p className="text-xs text-gray-500 mt-1">Your PIN was set when the team was created.</p>
            </div>
            <button type="submit" disabled={pending}
              className="w-full text-white py-3 rounded-xl font-semibold transition active:scale-95 disabled:opacity-60"
              style={{ background: navy }}>
              {pending ? 'Verifying…' : 'Open Scorecard →'}
            </button>
          </form>
        </div>

        <div className="mt-5 text-center space-y-2">
          <a href="/leaderboard" className="block font-medium hover:underline" style={{ color: navy }}>
            View Live Leaderboard →
          </a>
        </div>
      </main>
    </div>
  )
}
