# Backlog

Reminders parked from the July 2026 hardening session:

~~1. Mid-round audit trail~~ — done: `round_events` table (run
   `supabase/add_round_events.sql` in the Supabase SQL editor once) records
   who changed what during a round — HCP/player edits, skins settings and
   participants, all matchup types, team/group settings, ball values, pars,
   holes ranges, Daytona presses, and score clears. Viewable in the Admin
   Hub's "Round History" section. Until the table is created, logging fails
   silently and the app behaves as before.

~~2. Offline resilience for score entry~~ — done: score writes on all three
   scorekeeper surfaces (team, playing group, hammer) go through an offline
   queue (`lib/offline-queue.ts`). If a save can't reach the server it's
   stored in localStorage, the hole still marks as saved, a "waiting to sync"
   banner shows the queued count, and everything replays in order when
   coverage returns (`online` event + 15s retry). Poll-refetches pause while
   anything is queued so server state can't clobber unsynced local scores.

~~3. Daytona digit question~~ — resolved: owner confirmed the leading-ball × 10
   scoring is correct (4+5 → 40); the doc comment was fixed to match and the
   tests assert the confirmed behavior.
