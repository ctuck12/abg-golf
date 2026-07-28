import { describe, it, expect } from 'vitest'

import { createOfflineQueue } from './offline-queue-core'

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { data: Record<string, string> } {
  const data: Record<string, string> = {}
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => { data[k] = v },
  }
}

type Call = { kind: string; args: unknown[] }

function makeHarness(opts?: { online?: () => boolean; maxAttempts?: number }) {
  const calls: Call[] = []
  let failNetwork = false
  let serverError: string | null = null
  const action = (kind: string) => async (...args: unknown[]) => {
    if (failNetwork) throw new TypeError('Failed to fetch')
    calls.push({ kind, args })
    return serverError ? { error: serverError } : { success: true }
  }
  const storage = memoryStorage()
  const queue = createOfflineQueue({
    storage,
    actions: {
      saveScores: action('saveScores') as (...args: never[]) => Promise<unknown>,
      saveOther: action('saveOther') as (...args: never[]) => Promise<unknown>,
    },
    isOnline: opts?.online ?? (() => true),
    maxAttempts: opts?.maxAttempts,
  })
  return {
    queue, calls, storage,
    setNetworkDown(v: boolean) { failNetwork = v },
    setServerError(e: string | null) { serverError = e },
  }
}

describe('offline queue core', () => {
  it('passes results straight through when the network is up', async () => {
    const h = makeHarness()
    const res = await h.queue.runOrQueue('saveScores', ['team1', 7])
    expect(res).toEqual({ success: true })
    expect(h.calls).toEqual([{ kind: 'saveScores', args: ['team1', 7] }])
    expect(h.queue.getState().count).toBe(0)
  })

  it('queues on network failure and reports { queued: true }', async () => {
    const h = makeHarness()
    h.setNetworkDown(true)
    const res = await h.queue.runOrQueue('saveScores', ['team1', 7])
    expect(res).toEqual({ queued: true })
    expect(h.queue.getState().count).toBe(1)
    expect(h.calls).toHaveLength(0)
  })

  it('replays queued items in FIFO order on flush', async () => {
    const h = makeHarness()
    h.setNetworkDown(true)
    await h.queue.runOrQueue('saveScores', ['hole7'])
    await h.queue.runOrQueue('saveOther', ['hole7-strokes'])
    await h.queue.runOrQueue('saveScores', ['hole8'])
    expect(h.queue.getState().count).toBe(3)

    h.setNetworkDown(false)
    await h.queue.flush()
    expect(h.queue.getState().count).toBe(0)
    expect(h.calls.map((c) => c.args[0])).toEqual(['hole7', 'hole7-strokes', 'hole8'])
  })

  it('new writes line up behind queued ones so replay order is preserved', async () => {
    const h = makeHarness()
    h.setNetworkDown(true)
    await h.queue.runOrQueue('saveScores', ['hole7-v1'])
    h.setNetworkDown(false)
    // Network is back but the queue hasn't flushed yet — the re-save of the
    // same hole must not run before (and then be clobbered by) the v1 replay.
    const res = await h.queue.runOrQueue('saveScores', ['hole7-v2'])
    expect(res).toEqual({ queued: true })
    // runOrQueue kicked off an opportunistic flush; wait for it to settle
    await h.queue.flush()
    expect(h.calls.map((c) => c.args[0])).toEqual(['hole7-v1', 'hole7-v2'])
  })

  it('keeps everything while offline, no matter how many flushes happen', async () => {
    let online = false
    const h = makeHarness({ online: () => online })
    h.setNetworkDown(true)
    await h.queue.runOrQueue('saveScores', ['hole7'])
    for (let i = 0; i < 20; i++) await h.queue.flush()
    expect(h.queue.getState().count).toBe(1)
    online = true
    h.setNetworkDown(false)
    await h.queue.flush()
    expect(h.queue.getState().count).toBe(0)
  })

  it('drops an item and records the message when the server returns an error', async () => {
    const h = makeHarness()
    h.setNetworkDown(true)
    await h.queue.runOrQueue('saveScores', ['hole7'])
    h.setNetworkDown(false)
    h.setServerError('Session expired. Please log in again.')
    await h.queue.flush()
    expect(h.queue.getState().count).toBe(0)
    expect(h.queue.getState().lastError).toBe('Session expired. Please log in again.')
  })

  it('drops an item after repeated throws while online', async () => {
    const h = makeHarness({ maxAttempts: 3 })
    h.setNetworkDown(true)
    await h.queue.runOrQueue('saveScores', ['hole7'])
    // Browser thinks it's online but requests keep failing (e.g. server down)
    for (let i = 0; i < 3; i++) await h.queue.flush()
    expect(h.queue.getState().count).toBe(0)
    expect(h.queue.getState().lastError).toMatch(/dropped/)
  })

  it('survives a reload: a second queue over the same storage sees the items', async () => {
    const h = makeHarness()
    h.setNetworkDown(true)
    await h.queue.runOrQueue('saveScores', ['hole7'])

    const calls: Call[] = []
    const reloaded = createOfflineQueue({
      storage: h.storage,
      actions: {
        saveScores: (async (...args: unknown[]) => { calls.push({ kind: 'saveScores', args }); return { success: true } }) as (...args: never[]) => Promise<unknown>,
      },
    })
    expect(reloaded.getState().count).toBe(1)
    await reloaded.flush()
    expect(calls.map((c) => c.args[0])).toEqual(['hole7'])
    expect(reloaded.getState().count).toBe(0)
  })

  it('notifies subscribers as the count changes', async () => {
    const h = makeHarness()
    const counts: number[] = []
    h.queue.subscribe((s) => counts.push(s.count))
    h.setNetworkDown(true)
    await h.queue.runOrQueue('saveScores', ['hole7'])
    h.setNetworkDown(false)
    await h.queue.flush()
    expect(counts[0]).toBe(0)          // initial state on subscribe
    expect(counts).toContain(1)        // after enqueue
    expect(counts[counts.length - 1]).toBe(0) // after flush
  })
})
