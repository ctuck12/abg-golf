// Where the manual bet doublers are offered in Banker.
//
// Two different things multiply a Banker bet, and only the first is what this
// governs:
//
//   1. The doublers — a player pressing 2× on their own bet, or the banker
//      pressing 2× on all of them. Those are chosen before the hole is played.
//      By default they belong to par 3s, where a one-shot hole makes the press
//      interesting; 'all' restores them on every hole.
//
//   2. The automatic multiplier on the result — a birdie pays double, an eagle
//      or better pays triple. That is a property of the score, applies on every
//      hole regardless of this setting, and lives with the scoring maths.

export type BankerDoubleScope = 'par3' | 'all'

/** NULL / unset rows read as par-3s-only, so the default needs no backfill. */
export function bankerDoubleScope(stored: string | null | undefined): BankerDoubleScope {
  return stored === 'all' ? 'all' : 'par3'
}

export function doublingAllowedOnHole(scope: BankerDoubleScope, par: number): boolean {
  return scope === 'all' || par === 3
}
