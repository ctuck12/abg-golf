// Framework-free core of the offline write queue for score entry: failed
// server-action calls are persisted (localStorage in the app, injectable here
// for tests) and replayed in FIFO order once connectivity returns. All the
// queued writes are upsert/delete-then-insert style, so replaying them is safe.

export type QueueItem = {
  id: string
  kind: string
  args: unknown[]
  queuedAt: number
  attempts: number
}

export type QueueState = { count: number; lastError: string | null }

type AnyAsyncFn = (...args: never[]) => Promise<unknown>

export interface OfflineQueueOptions {
  storage: Pick<Storage, 'getItem' | 'setItem'>
  actions: Record<string, AnyAsyncFn>
  /** navigator.onLine in the app; () => true in tests. false pauses flushing. */
  isOnline?: () => boolean
  storageKey?: string
  /** Throws while online count toward this; the item is dropped when reached. */
  maxAttempts?: number
  now?: () => number
}

export function createOfflineQueue(opts: OfflineQueueOptions) {
  const key = opts.storageKey ?? 'abg-offline-queue-v1'
  const maxAttempts = opts.maxAttempts ?? 8
  const isOnline = opts.isOnline ?? (() => true)
  const now = opts.now ?? (() => Date.now())
  const listeners = new Set<(s: QueueState) => void>()
  let lastError: string | null = null
  let flushing = false
  let seq = 0

  function load(): QueueItem[] {
    try {
      const raw = opts.storage.getItem(key)
      const parsed: unknown = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? (parsed as QueueItem[]) : []
    } catch {
      return []
    }
  }
  function save(items: QueueItem[]) {
    try { opts.storage.setItem(key, JSON.stringify(items)) } catch { /* storage full/blocked — queue lives in memory-less mode */ }
  }
  function getState(): QueueState {
    return { count: load().length, lastError }
  }
  function notify() {
    const s = getState()
    for (const l of listeners) l(s)
  }
  function subscribe(cb: (s: QueueState) => void): () => void {
    listeners.add(cb)
    cb(getState())
    return () => { listeners.delete(cb) }
  }

  function enqueue(kind: string, args: unknown[]) {
    const items = load()
    items.push({ id: `${now()}-${seq++}`, kind, args, queuedAt: now(), attempts: 0 })
    save(items)
    notify()
  }

  function callAction(kind: string, args: unknown[]): Promise<unknown> {
    const fn = opts.actions[kind] as unknown as (...a: unknown[]) => Promise<unknown>
    return fn(...args)
  }

  // Replays queued items oldest-first. Stops (keeping the rest) on a network
  // failure; a server-returned { error } drops the item and records the message.
  async function flush(): Promise<void> {
    if (flushing) return
    flushing = true
    try {
      for (;;) {
        if (!isOnline()) break
        const items = load()
        if (items.length === 0) break
        const item = items[0]
        if (!opts.actions[item.kind]) { items.shift(); save(items); continue }
        let res: unknown
        try {
          res = await callAction(item.kind, item.args)
        } catch {
          // Thrown = request never reached the server. Only count attempts while
          // the browser believes it's online, so a real dead zone never expires items.
          if (!isOnline()) break
          item.attempts += 1
          if (item.attempts >= maxAttempts) {
            lastError = 'A queued save kept failing and was dropped — check the affected hole.'
            items.shift()
          }
          save(items)
          break
        }
        if (res && typeof res === 'object' && 'error' in res && (res as { error?: string }).error) {
          lastError = String((res as { error?: string }).error)
        }
        items.shift()
        save(items)
      }
    } finally {
      flushing = false
      notify()
    }
  }

  // Runs the action now when possible; queues it on network failure. When items
  // are already queued, new writes line up behind them so a replayed old write
  // can never overwrite a newer one (e.g. a hole edited again after going offline).
  async function runOrQueue(kind: string, args: unknown[]): Promise<unknown> {
    if (load().length > 0) {
      enqueue(kind, args)
      void flush()
      return { queued: true as const }
    }
    try {
      return await callAction(kind, args)
    } catch {
      enqueue(kind, args)
      return { queued: true as const }
    }
  }

  function clearError() {
    lastError = null
    notify()
  }

  return { runOrQueue, flush, getState, subscribe, clearError }
}
