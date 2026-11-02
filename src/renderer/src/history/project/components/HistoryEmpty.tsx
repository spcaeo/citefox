import type { JSX } from 'react'
import { openDrawer } from '../../../shell/drawers'
import { sectionHash } from '../../../shell/routes'
import { Button, EmptyState, LinkButton } from '../../../ui'

/**
 * Check history with no checks. A project that tracks nothing yet is told to add
 * a page first (Check now would find 0 pages due); one that tracks pages but has
 * not checked them yet goes to Check now.
 */
export function HistoryEmpty({ tracked }: { tracked: number }): JSX.Element {
  if (tracked === 0) {
    return (
      <EmptyState
        level={2}
        icon="inbox"
        title="No checks yet. Add a page to track first"
        body="Once a page or topic is tracked, CiteFox checks it and each check shows here with what it found and the searches it used."
        action={
          <span className="hp-empty-actions">
            <Button size="sm" variant="primary" icon="plus" onClick={() => openDrawer('add-page')}>
              Add a page
            </Button>
            <LinkButton size="sm" href={sectionHash('import-pages')}>
              Import pages
            </LinkButton>
          </span>
        }
      />
    )
  }
  return (
    <EmptyState
      level={2}
      title="No checks yet."
      body="When a page or topic is checked, each check shows here with what it found and the searches it used."
      action={
        <LinkButton size="sm" href={sectionHash('check')}>
          Check now
        </LinkButton>
      }
    />
  )
}
