# Backlog

Reminders parked from the July 2026 hardening session:

1. **Mid-round audit trail** — record who changed what (HCP edits, skins/settings
   changes, matchup edits) during a live round, with a "round history" view.
   Needs a small new table added in the Supabase dashboard first, then the
   actions get a logging call. Do this after the next big feature so the log
   covers it too.

2. **Offline resilience for score entry** — if a scorekeeper loses signal on the
   course, score taps should queue locally and sync when coverage returns
   instead of failing. The only architecture-touching item on the list.

3. **Daytona digit question** (found by the test suite) — `computeHoleDaytona`
   returns the leading ball × 10 (4+5 → 40), but its own doc comment describes
   two-digit concatenation (4+5 → 45, flipped 5+7 → 75). Confirm which is the
   real game rule; if concatenation is right, fix the function and update the
   pinned tests in `lib/scoring.test.ts`.
