import { ordinal } from '@shared/aio-observations'
import type { OverviewRead } from '@shared/overview-read'
import { pluralize } from '@shared/pluralize'
import type { SuggestionItem } from '../../../ui'

/** How long a passage stays highlighted after "Show". */
export const FLASH_MS = 1600

/** A heading as the card names it; the passages before the first heading are "the opening". */
export function sectionText(section: string | null): string {
  return section ?? 'the opening'
}

/** "8th of 14 passages, about halfway down". */
export function depthText(first: { order: number; of: number }): string {
  const share = first.of <= 1 ? 0 : (first.order - 1) / (first.of - 1)
  const where =
    share <= 0.2
      ? 'near the top'
      : share < 0.4
        ? 'in the first half'
        : share <= 0.6
          ? 'about halfway down'
          : share < 0.85
            ? 'in the second half'
            : 'near the end'
  return `${ordinal(first.order)} of ${pluralize(first.of, 'passage')}, ${where}`
}

/** "2nd of 12". */
export function placeText(position: number, total: number): string {
  return `${ordinal(position)} of ${total}`
}

/**
 * Scrolls to a passage of the overview on screen, opens any closed section around it,
 * flashes it and its citation chip, and moves focus to the chip (or the passage).
 * Returns false when the passage is not on screen.
 */
export function flashPassage(id: string, root: ParentNode = document): boolean {
  const passage = root.querySelector<HTMLElement>(`[data-passage="${id}"]`)
  if (!passage) return false
  for (let node = passage.parentElement; node; node = node.parentElement) {
    if (node instanceof HTMLDetailsElement) node.open = true
  }
  const chip = passage.querySelector<HTMLElement>(
    ':scope > .aio-cite .aio-cite-btn, :scope > .aio-table-cite .aio-cite-btn'
  )
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  passage.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
  for (const element of chip ? [passage, chip] : [passage]) {
    element.classList.remove('is-flash')
    // Restarts the animation when the same passage is shown twice in a row.
    void element.offsetWidth
    element.classList.add('is-flash')
    window.setTimeout(() => element.classList.remove('is-flash'), FLASH_MS)
  }
  if (chip) chip.focus({ preventScroll: true })
  else {
    if (!passage.hasAttribute('tabindex')) passage.setAttribute('tabindex', '-1')
    passage.focus({ preventScroll: true })
  }
  return true
}

const TONE_TEXT: Readonly<Record<OverviewRead['tone']['value'], string>> = {
  positive: 'Positive',
  neutral: 'Neutral',
  negative: 'Negative',
  absent: 'Absent: the overview does not name you'
}

/** The read as suggestion card lines: tone, what earns competitors their spots, actions. */
export function readItems(read: OverviewRead): SuggestionItem[] {
  return [
    {
      id: 'tone',
      label: 'Tone toward you',
      text: TONE_TEXT[read.tone.value],
      detail: read.tone.quote ? `“${read.tone.quote}”` : null
    },
    ...read.competitors.map((line, index) => ({
      id: `competitor-${index}`,
      label: `Why ${line.name} is there`,
      text: line.reason,
      detail: line.quote ? `“${line.quote}”` : null
    })),
    ...read.actions.map((action, index) => ({
      id: `action-${index}`,
      label: `Action ${index + 1}`,
      text: action.text,
      detail: `Answers: ${action.basis}`
    }))
  ]
}

/** "Run Oct 23, 2026 · 10:56 · confidence medium: One sample only." */
export function readMeta(
  ranAt: string,
  read: OverviewRead,
  stamp: (iso: string) => string
): string {
  const reason = read.confidence.reason ? `: ${read.confidence.reason}` : ''
  return `Run ${stamp(ranAt)} · confidence ${read.confidence.level}${reason}`
}
