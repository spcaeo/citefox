import type { StartJourney } from '@shared/ipc'
import { journeyReached, type StartJourneyStep } from '@shared/site-start'

/** The strip's steps: Setup is onboarding (always done here); the rest are journey routes. */
export const GETTING_STARTED_STEPS: readonly {
  id: 'setup' | StartJourneyStep
  label: string
  href: string
}[] = [
  { id: 'setup', label: 'Setup', href: '#/start/setup' },
  { id: 'found', label: 'Your site', href: '#/start' },
  { id: 'plan', label: 'Plan', href: '#/start/plan' },
  { id: 'check', label: 'First check', href: '#/start/check' },
  { id: 'results', label: 'First results', href: '#/start/results' }
]

const ORDER: readonly StartJourneyStep[] = ['read', 'found', 'plan', 'check', 'results']

function dismissKey(projectId: string): string {
  return `citefox.gettingStarted.dismissed.${projectId}`
}

export function readDismissed(projectId: string): boolean {
  try {
    return localStorage.getItem(dismissKey(projectId)) === '1'
  } catch {
    return false
  }
}

export function writeDismissed(projectId: string): void {
  try {
    localStorage.setItem(dismissKey(projectId), '1')
  } catch {
    // Storage blocked: the strip hides for this view only.
  }
}

/** done, current or todo for one strip step, from the furthest journey step reached. */
export function stripState(
  id: 'setup' | StartJourneyStep,
  journey: StartJourney
): 'done' | 'current' | 'todo' {
  if (id === 'setup') return 'done'
  const reached = journeyReached(journey)
  if (reached === 'results') return 'done'
  // The step to do next: read the site, then pick the plan, then the check runs.
  const effective: StartJourneyStep =
    reached === 'read' ? 'found' : reached === 'found' ? 'plan' : reached
  const at = ORDER.indexOf(id)
  const now = ORDER.indexOf(effective)
  if (at < now) return 'done'
  if (at === now) return 'current'
  return 'todo'
}
