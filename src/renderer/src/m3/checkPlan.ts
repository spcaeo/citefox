import { countNoun } from './model'

/**
 * What the next check runs, before it starts: one search per prompt, market, and sample,
 * plus a second when Google loads the AI Overview separately.
 */
export function checkPlanLine(prompts: number, markets: number, samples: number): string {
  // The header above already names the markets and samples, so this line does not repeat them.
  const most = prompts * markets * samples * 2
  return (
    `Checking ${countNoun(prompts, 'question', 'questions')} in each market · ` +
    `1–2 searches per question, market and sample: up to ${most.toLocaleString('en-US')} searches`
  )
}

/**
 * Words for the idle check screen. "First check" only before the page has
 * ever been checked; after that the same screen starts a re-check.
 */
export function checkStartCopy(checkedBefore: boolean): {
  heading: string
  button: string
  step: string
} {
  return checkedBefore
    ? { heading: 'Check now', button: 'Check now', step: 'Check' }
    : { heading: 'First check', button: 'Start first check', step: 'First check' }
}
