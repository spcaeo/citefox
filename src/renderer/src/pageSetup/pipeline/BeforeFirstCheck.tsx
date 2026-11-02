import type { JSX, ReactNode } from 'react'
import type { PageDetail } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { pageHash } from '../../shell/routes'
import { LinkButton, Panel } from '../../ui'
import { FirstCheckBar } from './FirstCheckBar'
import { SetupGate } from './SetupGate'
import type { PipelineSource } from './source'

/**
 * The Results tab of a page that has never been checked (owner feedback 5):
 * the live setup panel while CiteFox sets the page up, then the review
 * summary with the one primary "Start first check". No manual steps.
 */
export function BeforeFirstCheck({
  page,
  onChanged,
  results,
  source
}: {
  page: PageDetail
  onChanged: () => void
  /** Shown when the page turns out to be checked already (a check ran meanwhile). */
  results: ReactNode
  /** Tests only. */
  source?: PipelineSource | null
}): JSX.Element {
  return (
    <SetupGate
      page={page}
      waitingFor="ready"
      onSettled={onChanged}
      {...(source !== undefined ? { source } : {})}
    >
      {({ pipeline, setCheckWhenReady }) =>
        pipeline.state === 'checked' ? (
          results
        ) : (
          <div className="bf-stack">
            <FirstCheckBar
              pipeline={pipeline}
              onCheckWhenReady={(on) => void setCheckWhenReady(on)}
            />
            <Panel title="Set up and ready to review" titleAs="h2">
              <p className="bf-line">
                CiteFox read the page, wrote its buyer profile,{' '}
                {pluralize(pipeline.prompts, 'buyer question')} and the content gaps, without a
                search. Results show here after the first check.
              </p>
              <div className="bf-links">
                <LinkButton variant="secondary" href={pageHash(page.id, 'prompts')}>
                  Review the questions
                </LinkButton>
                <LinkButton variant="ghost" href={pageHash(page.id, 'audience')}>
                  Buyer profile
                </LinkButton>
                <LinkButton variant="ghost" href={pageHash(page.id, 'gaps')}>
                  Content gaps
                </LinkButton>
              </div>
            </Panel>
          </div>
        )
      }
    </SetupGate>
  )
}
