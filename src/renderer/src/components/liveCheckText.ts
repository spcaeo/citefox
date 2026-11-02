import type { LiveCheck } from '@shared/ipc'

/** "Checked just now" shows this long after a check ends. */
export const JUST_NOW_MS = 2 * 60 * 1000

/** The words of the line, or null when there is nothing to say (pure, for tests). */
export function liveCheckText(
  live: LiveCheck | null | undefined,
  checkedAt: string | null,
  now: number
): { tone: 'running' | 'stopped' | 'done'; text: string } | null {
  if (live?.state === 'running') {
    return {
      tone: 'running',
      text: `Checking… ${live.done} of ${live.total} done · numbers update as answers come in`
    }
  }
  if (live?.state === 'stopped') {
    return {
      tone: 'stopped',
      text: `From a check that stopped part-way · ${live.done} of ${live.total} done`
    }
  }
  if (checkedAt === null) return null
  // A check that ended after the screen's clock was read is just now too.
  const age = now - Date.parse(checkedAt)
  return age < JUST_NOW_MS ? { tone: 'done', text: 'Checked just now' } : null
}
