'use client'

import { useOfflineQueue, clearOfflineQueueError } from '@/lib/offline-queue'

// Status strip for score-entry pages: shows how many saves are queued while
// signal is out, and surfaces the last sync error once the queue drains.
// Renders nothing when everything is synced.
export default function OfflineSyncBanner() {
  const { count, lastError } = useOfflineQueue()

  if (count > 0) {
    return (
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-2">
        <p className="text-xs font-medium text-amber-800 text-center">
          📡 No signal — {count} save{count === 1 ? '' : 's'} waiting to sync. Keep scoring; everything syncs when coverage returns.
        </p>
      </div>
    )
  }
  if (lastError) {
    return (
      <div className="bg-red-50 border-b border-red-200 px-4 py-2 flex items-center justify-center gap-2">
        <p className="text-xs font-medium text-red-700 text-center">Sync problem: {lastError}</p>
        <button type="button" onClick={clearOfflineQueueError} className="text-red-400 hover:text-red-600 text-sm leading-none flex-shrink-0">✕</button>
      </div>
    )
  }
  return null
}
