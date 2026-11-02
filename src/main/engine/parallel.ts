import { createLimiter, type Limiter } from './checks/check-pace'

/**
 * Independent work side by side (owner, 2026-10-29: "parallel processing across the
 * entire application wherever we can"). Claude and Codex calls still pass the one
 * process-wide gate (`sharedClaudeGate`, Settings' "Calls at once") and its limit pause;
 * these helpers only make sure a step's independent calls wait at that gate together,
 * so it stays full, instead of the step awaiting one call before asking the next.
 */

/**
 * Claude tasks one step keeps in flight: the Settings "Calls at once" (LLM-7). More would
 * only queue at the gate and hold up a ✦ action the user starts meanwhile.
 */
export function aiTasksAtOnce(claudeConcurrency: number): number {
  return Number.isFinite(claudeConcurrency) ? Math.max(1, Math.floor(claudeConcurrency)) : 1
}

/** A step's own limiter for its Claude tasks; share one between steps that run together. */
export function aiLimiter(claudeConcurrency: number): Limiter {
  return createLimiter(aiTasksAtOnce(claudeConcurrency))
}

/** One item done (`ok`) or failed (`error`), in the item's place. */
export type Settled<R> = { ok: true; value: R } | { ok: false; error: unknown }

/**
 * Runs `work` for every item through `limiter`, started in item order. One item's
 * failure never stops the others. Results come back in item order, not finish order.
 */
export async function settleEach<T, R>(
  items: readonly T[],
  limiter: Limiter,
  work: (item: T, index: number) => Promise<R>
): Promise<Settled<R>[]> {
  return Promise.all(
    items.map((item, index) =>
      limiter
        .run(() => work(item, index))
        .then(
          (value): Settled<R> => ({ ok: true, value }),
          (error: unknown): Settled<R> => ({ ok: false, error })
        )
    )
  )
}

/**
 * `settleEach` for a step that failed on its first throw when it ran one item at a
 * time: every item still runs, then the first failure in item order is thrown.
 */
export async function mapEach<T, R>(
  items: readonly T[],
  limiter: Limiter,
  work: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const settled = await settleEach(items, limiter, work)
  const values: R[] = []
  for (const outcome of settled) {
    if (!outcome.ok) throw outcome.error
    values.push(outcome.value)
  }
  return values
}
