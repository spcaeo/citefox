import { landingHash, pageHash, promptHash, type RouteScope } from '../../shell/routes'
import type { PageNavLink, PageNavProps } from '../../ui'
import type { PromptNeighbours } from '../types'

/**
 * The header's PageNav row (FR-13.1): back to Results, the path, and steps to
 * the previous and next prompt.
 */
export function promptNav({
  projectName,
  pageId,
  pageLabel,
  promptNumber,
  nav,
  scope = {}
}: {
  projectName: string
  pageId: string
  pageLabel: string
  promptNumber: number | null
  nav: PromptNeighbours
  /** A pinned market and check: Results and the step links stay on that check. */
  scope?: RouteScope
}): PageNavProps {
  const results = pageHash(pageId, 'results', scope)
  const crumbs: PageNavLink[] = [
    { label: projectName, href: landingHash() },
    { label: pageLabel, href: results },
    ...(promptNumber === null ? [] : [{ label: `Question ${promptNumber}` }])
  ]
  const step = (promptId: string | null): string | null =>
    promptId === null ? null : promptHash(pageId, promptId, scope)
  return {
    back: { href: results, label: 'Results' },
    crumbs,
    ...(nav.index >= 0
      ? {
          pager: {
            label: 'Step through questions',
            position: nav.index + 1,
            total: nav.total,
            previous: { href: step(nav.previousId), label: 'Previous question' },
            next: { href: step(nav.nextId), label: 'Next question' }
          }
        }
      : {})
  }
}
