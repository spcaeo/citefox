import type { PagePipeline, PagePipelineStepId } from '@shared/ipc'
import { formatClock } from '../../utils/dates'

/** "42 s", "3 min 05 s", "1 h 02 min". Never negative. */
export function elapsedLabel(startMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - startMs) / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ${String(seconds % 60).padStart(2, '0')} s`
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`
}

export function panelTitle(state: PagePipeline['state']): string {
  switch (state) {
    case 'failed':
      return 'Setup needs you'
    case 'stopped':
      return 'Setup stopped'
    case 'held':
      return 'Setup is waiting'
    case 'ready':
    case 'checked':
      return 'Set up'
    default:
      return 'Setting up this page'
  }
}

const WAITING: Readonly<Record<PagePipelineStepId, string>> = {
  read: 'What CiteFox read shows here as soon as the page is read.',
  profile: 'The buyer profile shows here as soon as CiteFox AI writes it.',
  prompts: 'The buyer questions show here as soon as CiteFox AI writes them. You only review.',
  coverage: 'Content gaps show here once CiteFox AI compares each question with the page.',
  ready: 'Results show here after the first check.'
}

export function waitingLine(step: PagePipelineStepId): string {
  return WAITING[step]
}

/** "Next try at 2:20 PM · attempt 2 of 4", on the computer's own clock. */
export function retryLabel(retryAt: string, attempts: number): string {
  const time = Number.isNaN(new Date(retryAt).getTime()) ? '' : formatClock(retryAt)
  return `Next try ${time === '' ? 'soon' : `at ${time}`} · attempt ${attempts + 1} of 4`
}

/** True once the step this tab depends on is stored. */
export function stepDone(pipeline: PagePipeline, step: PagePipelineStepId): boolean {
  return pipeline.steps.find((item) => item.id === step)?.state === 'done'
}

/** "≈10–20 searches". */
export function searchesLabel(pipeline: Pick<PagePipeline, 'searchesMin' | 'searchesMax'>): string {
  const min = pipeline.searchesMin.toLocaleString('en-US')
  const max = pipeline.searchesMax.toLocaleString('en-US')
  return pipeline.searchesMin === pipeline.searchesMax
    ? `≈${min} searches`
    : `≈${min}–${max} searches`
}
