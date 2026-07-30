'use client'

import { useRef, useState } from 'react'
import {
  generateBalancedTeams, teamsSignature, parseHcpInput, fmtHcp,
  type GeneratedPlayer, type GeneratedTeam,
} from '@/lib/team-generator'

const navy = '#0f172a'

type RosterPlayer = { id: string; name: string; handicap_index?: number | null }

/**
 * Preview-only balanced team/group generator.
 *
 * Same pool picking, config, generation and history navigation as the Admin
 * Hub's round-building generator, minus the commit step — nothing here writes
 * teams to the round, so it is safe to run at any time to try out splits.
 */
export default function TeamGeneratorPanel({
  roster, nounCap, onUpdateRosterHandicap,
}: {
  roster: RosterPlayer[]
  /** 'Team' or 'Group' — matches whatever the round builds. */
  nounCap: string
  /** Persists an inline handicap edit made from the player list. Omit to keep edits local. */
  onUpdateRosterHandicap?: (rosterPlayerId: string, handicap: number | null) => void | Promise<void>
}) {
  const noun = nounCap.toLowerCase()

  const [selectedRosterIds, setSelectedRosterIds] = useState<Set<string>>(new Set())
  const [manualPlayers, setManualPlayers] = useState<{ tempId: string; name: string; handicap: string }[]>([])
  const [manualName, setManualName] = useState('')
  const [manualHcp, setManualHcp] = useState('')
  const manualSeq = useRef(0)
  const [rosterSearch, setRosterSearch] = useState('')
  const [numTeams, setNumTeams] = useState('2')
  const [error, setError] = useState('')

  // Inline handicap editing, for roster players and manually added ones
  const [editingRosterHcpId, setEditingRosterHcpId] = useState<string | null>(null)
  const [rosterHcpDraft, setRosterHcpDraft] = useState('')
  const [editingManualId, setEditingManualId] = useState<string | null>(null)
  const [manualHcpDraft, setManualHcpDraft] = useState('')

  const [generatedTeams, setGeneratedTeams] = useState<GeneratedTeam[] | null>(null)
  const [editNames, setEditNames] = useState<string[]>([])
  // Generation history for Previous/Next navigation (entry 0 = initial generation)
  const [history, setHistory] = useState<{ teams: GeneratedTeam[]; names: string[] }[]>([])
  const [historyIdx, setHistoryIdx] = useState(0)
  const [atStartNotice, setAtStartNotice] = useState(false)
  const [poolOpen, setPoolOpen] = useState(true)

  const totalSelected = selectedRosterIds.size + manualPlayers.length

  function buildInputs(): { allPlayers: GeneratedPlayer[]; teamCount: number } | null {
    const teamCount = parseInt(numTeams, 10)
    if (isNaN(teamCount) || teamCount < 2) { setError(`Enter at least 2 ${noun}s.`); return null }

    const rosterPlayers: GeneratedPlayer[] = roster
      .filter(rp => selectedRosterIds.has(rp.id))
      .map(rp => ({ id: rp.id, name: rp.name, handicap: rp.handicap_index ?? null, source: 'roster' as const }))

    const manualConverted: GeneratedPlayer[] = manualPlayers.map(p => ({
      id: p.tempId, name: p.name,
      handicap: p.handicap !== '' ? parseFloat(p.handicap) : null,
      source: 'manual' as const,
    }))

    const allPlayers = [...rosterPlayers, ...manualConverted]
    if (allPlayers.length < teamCount) {
      setError(`Need at least ${teamCount} players to fill ${teamCount} ${noun}s.`)
      return null
    }
    return { allPlayers, teamCount }
  }

  function handleGenerate() {
    const inputs = buildInputs()
    if (!inputs) return
    setError('')
    const result = generateBalancedTeams(inputs.allPlayers, inputs.teamCount)
    const names = result.map(t => t.name)
    setHistory([{ teams: result, names }])
    setHistoryIdx(0)
    setGeneratedTeams(result)
    setEditNames(names)
    setPoolOpen(false)
  }

  function handleRegenerate() {
    const inputs = buildInputs()
    if (!inputs) return
    setError('')
    const currentSig = generatedTeams ? teamsSignature(generatedTeams) : ''
    let result: GeneratedTeam[] | null = null
    for (let attempt = 0; attempt < 15; attempt++) {
      const candidate = generateBalancedTeams(inputs.allPlayers, inputs.teamCount, Math.random)
      if (teamsSignature(candidate) !== currentSig) { result = candidate; break }
    }
    if (!result) {
      setError(`This roster only has one balanced arrangement — no different ${noun}s to generate.`)
      return
    }
    const names = result.map(t => t.name)
    const appendIdx = history.length
    // Keep any name edits made to the current generation before moving on
    setHistory(prev => {
      const copy = [...prev]
      if (copy[historyIdx]) copy[historyIdx] = { ...copy[historyIdx], names: editNames }
      return [...copy, { teams: result!, names }]
    })
    setHistoryIdx(appendIdx)
    setGeneratedTeams(result)
    setEditNames(names)
  }

  function gotoGeneration(idx: number) {
    if (idx < 0) { setAtStartNotice(true); return }
    if (idx > history.length - 1) return
    const entry = history[idx]
    if (!entry) return
    setHistory(prev => {
      const copy = [...prev]
      if (copy[historyIdx]) copy[historyIdx] = { ...copy[historyIdx], names: editNames }
      return copy
    })
    setHistoryIdx(idx)
    setGeneratedTeams(entry.teams)
    setEditNames(entry.names)
  }

  // A generated-but-stale preview would carry an old handicap or player set
  function invalidatePreview() {
    if (generatedTeams) setGeneratedTeams(null)
  }

  async function commitRosterHcp(rosterPlayerId: string) {
    const hcp = parseHcpInput(rosterHcpDraft)
    setEditingRosterHcpId(null)
    invalidatePreview()
    await onUpdateRosterHandicap?.(rosterPlayerId, hcp)
  }

  function commitManualHcp(tempId: string) {
    const hcp = parseHcpInput(manualHcpDraft)
    setEditingManualId(null)
    setManualPlayers(prev => prev.map(p => p.tempId === tempId ? { ...p, handicap: hcp == null ? '' : String(hcp) } : p))
    invalidatePreview()
  }

  const visibleRoster = roster.filter(rp => !rosterSearch || rp.name.toLowerCase().includes(rosterSearch.toLowerCase()))

  return (
    <div className="border border-indigo-200 rounded-xl bg-indigo-50 px-4 py-4 space-y-4">
      {atStartNotice && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={() => setAtStartNotice(false)}>
          <div className="bg-white rounded-2xl shadow-xl px-6 py-5 max-w-xs w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900 text-base mb-2">At the Initial Generation</h3>
            <p className="text-sm text-gray-600 mb-4">
              You&apos;re back at the first set of generated {noun}s — there&apos;s nothing previous to see.
            </p>
            <button type="button" onClick={() => setAtStartNotice(false)}
              className="w-full py-2 rounded-xl text-sm font-semibold text-white" style={{ background: navy }}>
              Got it
            </button>
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-bold text-indigo-700 uppercase tracking-wide">Team/Group Generator</p>
        <p className="text-[11px] text-gray-500 mt-0.5">
          Try out balanced splits from the roster. Nothing here changes the round — build the real {noun}s in the round setup below.
        </p>
      </div>

      {/* Player pool */}
      <div className="space-y-2">
        {/* Collapses once teams are generated — the pool has done its job by
            then and the preview is what matters */}
        <button type="button" onClick={() => setPoolOpen(v => !v)}
          className="flex items-center gap-1.5 w-full text-left">
          <p className="text-xs font-semibold text-gray-700">Select Players</p>
          <span className="text-gray-400 text-xs ml-auto">{poolOpen ? '▲' : '▼'}</span>
        </button>
        {poolOpen && (<>

        {roster.length > 0 && (
          <div className="bg-white rounded-xl border border-indigo-200 p-3 space-y-2 max-h-52 overflow-y-auto">
            <input
              type="text"
              placeholder="Search roster…"
              value={rosterSearch}
              onChange={e => setRosterSearch(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none"
            />
            <div className="flex gap-3 mb-1">
              <button type="button" onClick={() => { setSelectedRosterIds(new Set(roster.map(r => r.id))); invalidatePreview() }}
                className="text-xs text-indigo-600 hover:underline">Select all</button>
              <button type="button" onClick={() => { setSelectedRosterIds(new Set()); invalidatePreview() }}
                className="text-xs text-gray-400 hover:underline">Clear</button>
            </div>
            {visibleRoster.map(rp => (
              <div key={rp.id} className="flex items-center gap-2 py-0.5">
                <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                  <input
                    type="checkbox"
                    checked={selectedRosterIds.has(rp.id)}
                    onChange={e => {
                      setSelectedRosterIds(prev => {
                        const next = new Set(prev)
                        if (e.target.checked) next.add(rp.id); else next.delete(rp.id)
                        return next
                      })
                      invalidatePreview()
                    }}
                    className="w-3.5 h-3.5 accent-indigo-600 flex-shrink-0"
                  />
                  <span className="text-sm text-gray-800 flex-1 truncate">{rp.name}</span>
                </label>
                {editingRosterHcpId === rp.id ? (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <input type="text" inputMode="decimal" value={rosterHcpDraft} onChange={e => setRosterHcpDraft(e.target.value)}
                      autoFocus placeholder="HCP"
                      className="w-14 border border-blue-300 rounded px-1.5 py-0.5 text-xs focus:outline-none"
                      onKeyDown={e => { if (e.key === 'Enter') void commitRosterHcp(rp.id); if (e.key === 'Escape') setEditingRosterHcpId(null) }} />
                    <button type="button" onClick={() => void commitRosterHcp(rp.id)} className="text-xs text-blue-600 font-medium">✓</button>
                    <button type="button" onClick={() => setEditingRosterHcpId(null)} className="text-xs text-gray-400">✕</button>
                  </div>
                ) : (
                  <button type="button"
                    onClick={() => { setEditingRosterHcpId(rp.id); setRosterHcpDraft(rp.handicap_index != null ? fmtHcp(rp.handicap_index) : '') }}
                    className="text-xs px-1.5 py-0.5 rounded border border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600 transition whitespace-nowrap flex-shrink-0"
                    title="Edit handicap">
                    {rp.handicap_index != null ? `HCP ${fmtHcp(rp.handicap_index)}` : 'HCP —'}
                  </button>
                )}
              </div>
            ))}
            {visibleRoster.length === 0 && <p className="text-xs text-gray-400">No matches.</p>}
          </div>
        )}
        {roster.length === 0 && (
          <p className="text-xs text-gray-400">No roster players. Add players manually below.</p>
        )}

        {/* Manual add */}
        <div>
          <p className="text-xs font-medium text-gray-600 mb-1.5">Add player not in roster:</p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Name"
              value={manualName}
              onChange={e => setManualName(e.target.value)}
              className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none"
            />
            <input
              type="text"
              placeholder="HCP (e.g. +2 or 14)"
              value={manualHcp}
              onChange={e => setManualHcp(e.target.value)}
              className="w-32 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                if (!manualName.trim()) return
                const hcp = parseHcpInput(manualHcp)
                // Counter, not a timestamp — two adds in the same millisecond
                // would otherwise collide on the React key
                setManualPlayers(prev => [...prev, {
                  tempId: `manual-${manualSeq.current++}`,
                  name: manualName.trim(),
                  handicap: hcp == null ? '' : String(hcp),
                }])
                setManualName('')
                setManualHcp('')
                invalidatePreview()
              }}
              className="text-white px-3 py-1.5 rounded-lg text-sm font-medium flex-shrink-0"
              style={{ background: navy }}>
              Add
            </button>
          </div>
          {manualPlayers.length > 0 && (
            <div className="mt-2 space-y-1">
              {manualPlayers.map(p => (
                <div key={p.tempId} className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 px-3 py-1.5">
                  <span className="text-sm text-gray-800 flex-1 truncate">{p.name}</span>
                  {editingManualId === p.tempId ? (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <input type="text" inputMode="decimal" value={manualHcpDraft} onChange={e => setManualHcpDraft(e.target.value)}
                        autoFocus placeholder="HCP"
                        className="w-14 border border-blue-300 rounded px-1.5 py-0.5 text-xs focus:outline-none"
                        onKeyDown={e => { if (e.key === 'Enter') commitManualHcp(p.tempId); if (e.key === 'Escape') setEditingManualId(null) }} />
                      <button type="button" onClick={() => commitManualHcp(p.tempId)} className="text-xs text-blue-600 font-medium">✓</button>
                      <button type="button" onClick={() => setEditingManualId(null)} className="text-xs text-gray-400">✕</button>
                    </div>
                  ) : (
                    <button type="button"
                      onClick={() => { setEditingManualId(p.tempId); setManualHcpDraft(p.handicap !== '' ? fmtHcp(parseFloat(p.handicap)) : '') }}
                      className="text-xs px-1.5 py-0.5 rounded border border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600 transition whitespace-nowrap flex-shrink-0"
                      title="Edit handicap">
                      {p.handicap !== '' ? `HCP ${fmtHcp(parseFloat(p.handicap))}` : 'HCP —'}
                    </button>
                  )}
                  <button type="button"
                    onClick={() => { setManualPlayers(prev => prev.filter(x => x.tempId !== p.tempId)); invalidatePreview() }}
                    className="text-xs text-red-400 hover:text-red-600 ml-1">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        </>)}

        {totalSelected > 0 && (
          <p className="text-xs text-indigo-600 font-medium">{totalSelected} player{totalSelected !== 1 ? 's' : ''} selected</p>
        )}
      </div>

      {/* Config row */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Number of {nounCap}s</label>
            <input
              type="number"
              min="2" max="20"
              value={numTeams}
              onChange={e => { setNumTeams(e.target.value); invalidatePreview() }}
              className="w-20 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none"
            />
          </div>

          {/* Live distribution summary */}
          {(() => {
            const n = parseInt(numTeams, 10)
            if (totalSelected < 2 || isNaN(n) || n < 2) return null
            const floor = Math.floor(totalSelected / n)
            const ceil = Math.ceil(totalSelected / n)
            const extras = totalSelected % n
            const distText = extras === 0
              ? `${n} ${noun}s of ${floor}`
              : `${extras} ${noun}${extras > 1 ? 's' : ''} of ${ceil} + ${n - extras} of ${floor}`
            const tooSmall = floor < 4
            const tooBig = ceil > 5
            const ok = !tooSmall && !tooBig
            return (
              <div className={`self-end pb-0.5 px-3 py-2 rounded-lg text-xs font-semibold border ${ok ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                {distText}
                {tooSmall && <span className="ml-1 font-normal">— some {noun}s under 4</span>}
                {tooBig && <span className="ml-1 font-normal">— some {noun}s over 5</span>}
              </div>
            )
          })()}
        </div>

        {/* Valid 4–5 player/team suggestions */}
        {(() => {
          if (totalSelected < 4) return null
          const validCounts = [2, 3, 4, 5, 6, 7, 8].filter(t => {
            const f = Math.floor(totalSelected / t), c = Math.ceil(totalSelected / t)
            return f >= 4 && c <= 5
          })
          if (validCounts.length === 0) return (
            <p className="text-xs text-amber-600">
              No clean 4–5 player/{noun} split for {totalSelected} players. Try adding or removing a player.
            </p>
          )
          return (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-500">Valid 4–5/{noun} splits:</span>
              {validCounts.map(t => {
                const c = Math.ceil(totalSelected / t), f = Math.floor(totalSelected / t)
                const extras = totalSelected % t
                const label = extras === 0 ? `${t} ${noun}s of ${f}` : `${t} ${noun}s (${extras}×${c} + ${t - extras}×${f})`
                const active = parseInt(numTeams, 10) === t
                return (
                  <button key={t} type="button"
                    onClick={() => { setNumTeams(String(t)); invalidatePreview() }}
                    className={`text-xs px-2.5 py-1 rounded-full border font-medium transition ${active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-indigo-600 border-indigo-300 hover:bg-indigo-50'}`}>
                    {label}
                  </button>
                )
              })}
            </div>
          )
        })()}
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>}

      <button
        type="button"
        onClick={handleGenerate}
        className="w-full py-2 rounded-xl font-semibold text-sm text-white transition"
        style={{ background: '#4f46e5' }}>
        Generate Balanced {nounCap}s
      </button>

      {/* Generated preview */}
      {generatedTeams && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Preview — edit names</p>
            <div className="flex items-center gap-1.5">
              {history.length >= 3 && historyIdx > 0 && (
                <button type="button" onClick={() => gotoGeneration(0)}
                  className="text-xs text-gray-600 border border-gray-300 px-2 py-1 rounded hover:bg-gray-50">
                  ⇤ First
                </button>
              )}
              {history.length > 1 && (
                <button type="button" onClick={() => gotoGeneration(historyIdx - 1)}
                  className="text-xs text-gray-600 border border-gray-300 px-2 py-1 rounded hover:bg-gray-50">
                  ← Previous
                </button>
              )}
              {history.length > 1 && (
                <span className="text-[10px] text-gray-400 font-semibold whitespace-nowrap">{historyIdx + 1}/{history.length}</span>
              )}
              {historyIdx < history.length - 1 && (
                <button type="button" onClick={() => gotoGeneration(historyIdx + 1)}
                  className="text-xs text-gray-600 border border-gray-300 px-2 py-1 rounded hover:bg-gray-50">
                  Next →
                </button>
              )}
              <button type="button" onClick={handleRegenerate}
                className="text-xs text-indigo-600 border border-indigo-200 px-2 py-1 rounded hover:bg-indigo-50">
                Re-generate
              </button>
            </div>
          </div>

          {generatedTeams.map((team, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={editNames[i] ?? team.name}
                  onChange={e => setEditNames(prev => {
                    const next = [...prev]
                    next[i] = e.target.value
                    return next
                  })}
                  className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm font-semibold focus:outline-none"
                  placeholder={`${nounCap} name`}
                />
                {team.avgHandicap != null && (
                  <span className="text-xs text-gray-400 flex-shrink-0">avg {team.avgHandicap < 0 ? `+${Math.abs(team.avgHandicap)}` : team.avgHandicap} HCP</span>
                )}
              </div>
              <div className="space-y-0.5">
                {team.players.map(p => (
                  <div key={p.id} className="flex items-center gap-2 text-sm text-gray-700 py-0.5 border-b border-gray-50 last:border-0">
                    <span className="flex-1 truncate">{p.name}</span>
                    <span className="text-xs text-gray-400">
                      {p.handicap != null
                        ? p.handicap < 0
                          ? `+${Math.abs(p.handicap)} HCP`
                          : `HCP ${p.handicap}`
                        : '—'}
                    </span>
                    {p.source === 'manual' && (
                      <span className="text-xs bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 font-medium">manual</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
