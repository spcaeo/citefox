/**
 * How "All engines" counts a question (Docs/METRICS.md "All engines"). One setting, so
 * the rule can be switched in one place:
 *
 * - `once` (owner option A, the default): a question counts once. It is cited when any
 *   engine's answer cites your site, answered when any engine shows an answer. The
 *   engine filter shows each engine on its own.
 * - `per_engine`: a question checked on Google and on ChatGPT counts once for each engine.
 */
export type AllEnginesCounting = 'once' | 'per_engine'

export const ALL_ENGINES_COUNTING: AllEnginesCounting = 'once'
