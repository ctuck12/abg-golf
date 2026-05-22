'use client'

import { useActionState, useEffect } from 'react'
import { teamLogin } from '@/app/actions'

type Team = { id: string; name: string }

const navy = '#0f172a'

export default function PinLoginModal({ teams, onClose }: { teams: Team[]; onClose: () => void }) {
  const [state, action, pending] = useActionState(teamLogin, null)

  useEffect(() => {
    if (state && 'success' in state && state.success) {
      window.location.href = `/score/${state.teamId}`
    }
  }, [state])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-gray-900">Enter Team PIN</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <form action={action} className="space-y-3">
          {state && 'error' in state && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{state.error}</p>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Your Team</label>
            <select
              name="teamId"
              required
              defaultValue=""
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 bg-white text-gray-900 text-sm focus:outline-none"
            >
              <option value="" disabled>Select your team…</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Team PIN</label>
            <input
              type="password"
              name="pin"
              inputMode="numeric"
              maxLength={4}
              required
              placeholder="4-digit PIN"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-gray-900 text-sm focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-60 transition active:scale-95"
            style={{ background: navy }}
          >
            {pending ? 'Verifying…' : 'Open Scorecard →'}
          </button>
        </form>
      </div>
    </div>
  )
}
