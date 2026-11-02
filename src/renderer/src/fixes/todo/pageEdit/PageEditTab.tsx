import type { JSX, ReactNode } from 'react'
import { BusyLine, Button } from '../../../ui'
import { PageEditDoc, PageEditReview } from './PageEditor'
import type { PageEditPanel } from './usePageEditPanel'
import './pageEdit.css'

/** The main column: the button and its progress, or the page with its edits. */
export function PageEditMain({
  panel,
  noAiNotice
}: {
  panel: PageEditPanel
  /** Shown instead of a run when CiteFox AI is not connected. */
  noAiNotice: ReactNode
}): JSX.Element {
  const { page } = panel
  const { state } = page
  if (state.phase === 'no-ai') return <>{noAiNotice}</>
  if (state.phase === 'done') {
    return <PageEditDoc edit={state.edit} edits={page.edits} onEdits={page.setEdits} />
  }
  return (
    <div className="pe-start" data-testid="page-edit-start">
      {state.phase === 'loading' ? null : (
        <p className="muted">
          CiteFox AI reads this page and marks what to cut and what to add, so it answers the
          searches this fix can win the way Google&apos;s answer needs.
        </p>
      )}
      {state.phase === 'idle' || state.phase === 'error' ? (
        <Button variant="primary" size="sm" icon="sparkle" onClick={page.start}>
          {state.phase === 'error' ? 'Try again' : 'Show page edits'}
        </Button>
      ) : null}
      <BusyLine
        active={state.phase === 'running'}
        label="CiteFox AI is reading the page and marking the edits"
        usual={[25, 90]}
        note="No searches"
        end="Page edits ready"
      />
      {state.phase === 'error' ? (
        <p className="fxt-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </div>
  )
}

/** The rail's Review card, once the edits are written. */
export function PageEditRail({ panel }: { panel: PageEditPanel }): JSX.Element | null {
  const { page, download } = panel
  if (page.state.phase !== 'done') return null
  return (
    <PageEditReview
      edit={page.state.edit}
      edits={page.edits}
      onEdits={page.setEdits}
      onDownload={download}
      onRedo={page.start}
    />
  )
}
