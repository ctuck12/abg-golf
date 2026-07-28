'use client'

// App-facing offline queue for score entry: wraps the score-writing server
// actions so a signal drop on the course queues the write in localStorage and
// replays it (in order) when coverage returns, instead of failing the save.

import { useEffect, useState } from 'react'

import {
  submitHoleScores, submitGroupHoleScores, submitHammerHoleScores,
  saveDaytonaAssignments, saveDaytonaHoleValues, saveHoleStrokes,
  saveBankerHole, saveBankerBets, saveHammerHole,
} from '@/app/actions'

import { createOfflineQueue, type QueueState } from './offline-queue-core'

const ACTIONS = {
  submitHoleScores, submitGroupHoleScores, submitHammerHoleScores,
  saveDaytonaAssignments, saveDaytonaHoleValues, saveHoleStrokes,
  saveBankerHole, saveBankerBets, saveHammerHole,
} as const

type ActionKind = keyof typeof ACTIONS

export type Queued = { queued: true }

const noopStorage: Pick<Storage, 'getItem' | 'setItem'> = { getItem: () => null, setItem: () => {} }

let queue: ReturnType<typeof createOfflineQueue> | null = null
let armed = false

function getQueue() {
  if (!queue) {
    queue = createOfflineQueue({
      storage: typeof window === 'undefined' ? noopStorage : window.localStorage,
      actions: ACTIONS as unknown as Record<string, (...args: never[]) => Promise<unknown>>,
      isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
    })
  }
  if (!armed && typeof window !== 'undefined') {
    armed = true
    window.addEventListener('online', () => { void queue!.flush() })
    // Belt and braces: 'online' isn't fired reliably on iOS Safari when the
    // radio recovers, so also retry on a slow interval while anything is queued.
    setInterval(() => { if (queue!.getState().count > 0) void queue!.flush() }, 15000)
  }
  return queue
}

// Runs the server action now, or queues it if the network is gone. Returns the
// action's normal result, or { queued: true } when it was stored for later.
export async function runOrQueue<K extends ActionKind>(
  kind: K,
  args: Parameters<(typeof ACTIONS)[K]>
): Promise<Awaited<ReturnType<(typeof ACTIONS)[K]>> | Queued> {
  return getQueue().runOrQueue(kind, args) as Promise<Awaited<ReturnType<(typeof ACTIONS)[K]>> | Queued>
}

// How many writes are waiting to sync — used to pause poll-refetches so server
// state can't clobber locally saved-but-unsynced scores.
export function getOfflineQueueCount(): number {
  if (typeof window === 'undefined') return 0
  return getQueue().getState().count
}

// Dismisses the banner's "last sync error" message.
export function clearOfflineQueueError() {
  getQueue().clearError()
}

// Live queue state for the "waiting to sync" banner on score-entry pages.
export function useOfflineQueue(): QueueState {
  const [state, setState] = useState<QueueState>({ count: 0, lastError: null })
  useEffect(() => getQueue().subscribe(setState), [])
  return state
}
