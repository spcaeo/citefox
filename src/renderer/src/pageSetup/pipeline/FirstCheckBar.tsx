import { useId, type JSX } from 'react'
import type { PagePipeline } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { requestCheckStart } from '../../m3/startIntent'
import { navigateHash, runningHash } from '../../shell/routes'
import { Button, LinkButton } from '../../ui'
import { searchesLabel } from './model'
import './firstCheck.css'

/**
 * The review screen's one primary (owner feedback 5): "Start first check ·
 * ≈N searches", with the plan in plain words and the project's "check
 * automatically when ready" choice (off by default). Shown only while the
 * page has never been checked.
 */
export function FirstCheckBar({
  pipeline,
  onCheckWhenReady
}: {
  pipeline: PagePipeline
  onCheckWhenReady: (on: boolean) => void
}): JSX.Element | null {
  const toggleId = useId()
  if (pipeline.state !== 'ready') return null
  const searches = searchesLabel(pipeline)
  const plan = `${pluralize(pipeline.prompts, 'question')} × ${pluralize(pipeline.markets, 'market')} × ${pluralize(pipeline.samples, 'sample')}`
  return (
    <section className="ui-panel fc-bar" aria-label="First check" data-testid="first-check-bar">
      <div className="fc-copy">
        <p className="fc-title">
          {pipeline.firstCheckWaits ? 'Ready to check' : 'The first check starts by itself'}
        </p>
        <p className="fc-sub">
          {plan} · 1–2 searches each · {searches}. Nothing is searched until the check starts.
        </p>
        <label className="fc-auto" htmlFor={toggleId}>
          <input
            id={toggleId}
            type="checkbox"
            checked={pipeline.checkWhenReady}
            onChange={(event) => onCheckWhenReady(event.currentTarget.checked)}
          />
          Check new pages in this project automatically when they are ready
        </label>
      </div>
      {pipeline.firstCheckWaits ? (
        <Button
          variant="primary"
          iconEnd="arrow-right"
          disabled={pipeline.prompts === 0}
          onClick={() => {
            requestCheckStart(pipeline.pageId)
            navigateHash(runningHash(pipeline.pageId))
          }}
        >
          Start first check · {searches}
        </Button>
      ) : (
        <LinkButton variant="secondary" href={runningHash(pipeline.pageId)}>
          Open the check
        </LinkButton>
      )}
    </section>
  )
}
