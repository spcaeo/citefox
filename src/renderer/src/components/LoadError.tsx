import type { JSX, ReactNode } from 'react'
import { Button } from '../ui/Button'
import { CopyText } from '../ui/CopyText'
import { EmptyState } from '../ui/EmptyState'
import { cleanErrorMessage } from './errorText'

/**
 * A failed load: what went wrong, in the app's own words, and a way to try
 * again. Screens show this in place of their content (not next to a
 * "Loading…" line that will never clear). It is the v2 EmptyState with a
 * warning icon and a Retry button, in a card, announced as an alert.
 */
export function LoadError({
  title,
  message,
  onRetry,
  retryLabel = 'Try again',
  level = 2,
  children
}: {
  /** One plain sentence: what could not be loaded. */
  title: string
  /** The error text from the main process, when there is one. */
  message?: string | null
  onRetry?: () => void
  retryLabel?: string
  /** Heading level of the title. Default 2 (it stands in for the screen's content). */
  level?: 2 | 3 | 4
  /** Extra actions, such as a link back. */
  children?: ReactNode
}): JSX.Element {
  // Callers pass engine text; never show Electron's invoke wrapper or a channel name.
  const detail = message ? cleanErrorMessage(message) : ''
  return (
    <div className="load-error" role="alert">
      <EmptyState
        icon="warning"
        title={title}
        level={level}
        body={detail && detail !== title ? <CopyText text={detail} wrap /> : undefined}
        action={
          onRetry || children ? (
            <>
              {onRetry ? (
                <Button size="sm" onClick={onRetry}>
                  {retryLabel}
                </Button>
              ) : null}
              {children}
            </>
          ) : undefined
        }
      />
    </div>
  )
}
