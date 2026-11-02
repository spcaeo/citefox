import { useId, type JSX } from 'react'
import type { GenerationTemplateKind, TemplateSettings } from '@shared/domain'
import { Icon } from '../../components/Icon'
import { marketLabel } from '../../shell/model'
import type { TemplatesClient } from '../client'
import { AssistProgress, Button, SectionHead, useAssistProgress } from '../../ui'
import { useTryIt } from '../hooks/useTryIt'
import { TRY_SAVED_NOTHING, tryCostLabel, tryResultLine } from '../utils/stepCopy'
import { modelLabel } from '../utils/settingsForm'

/** Seconds Try it expects before the first run reports its own estimate. */
const TRY_EXPECTED_SECONDS = 15

/**
 * Try it (FR-26.6): run the current draft once on a real page and market.
 * Nothing is saved to the page. The playground stays one link away.
 */
export function TryItCard({
  client,
  projectId,
  kind,
  body,
  settings,
  settingsError,
  playgroundId
}: {
  client: TemplatesClient
  projectId: string | null
  kind: GenerationTemplateKind
  body: string
  settings: TemplateSettings
  settingsError: string | null
  /** App template to open in the playground. */
  playgroundId: string | null
}): JSX.Element {
  return (
    <section className="card tpl-card" aria-labelledby="try-h">
      <SectionHead
        id="try-h"
        title="Try it"
        description={`Run this template once on a real page. ${TRY_SAVED_NOTHING}`}
      />
      {projectId ? (
        <TryItForm
          client={client}
          projectId={projectId}
          kind={kind}
          body={body}
          settings={settings}
          settingsError={settingsError}
        />
      ) : (
        <p className="muted">Open a project to try this template on one of its pages.</p>
      )}
      {playgroundId ? (
        <p className="hint">
          <a href={`#/playground/${encodeURIComponent(playgroundId)}`}>Open in the playground</a> to
          compare saved templates on any URL.
        </p>
      ) : null}
    </section>
  )
}

function TryItForm({
  client,
  projectId,
  kind,
  body,
  settings,
  settingsError
}: {
  client: TemplatesClient
  projectId: string
  kind: GenerationTemplateKind
  body: string
  settings: TemplateSettings
  settingsError: string | null
}): JSX.Element {
  const pageFieldId = useId()
  const marketFieldId = useId()
  const tryIt = useTryIt({ client, projectId, kind })
  const progress = useAssistProgress(tryIt.running)
  const { result } = tryIt
  const cost = result
    ? tryCostLabel(result.label.connection, result.label.expectedSeconds)
    : tryCostLabel('claude-code', TRY_EXPECTED_SECONDS)
  const blocked = tryIt.pageId.length === 0 || settingsError !== null

  return (
    <>
      {tryIt.loadError ? (
        <p className="field-error" role="alert">
          {tryIt.loadError}
        </p>
      ) : null}
      {tryIt.pages.length === 0 && !tryIt.loadError ? (
        <p className="muted">This project has no pages yet. Add a page to try a template on it.</p>
      ) : (
        <div className="tpl-try-fields">
          <div className="field">
            <label className="field-label" htmlFor={pageFieldId}>
              Page
            </label>
            <select
              id={pageFieldId}
              className="ob-input"
              value={tryIt.pageId}
              onChange={(event) => tryIt.setPageId(event.target.value)}
            >
              {tryIt.pages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.label ?? page.title ?? page.url}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor={marketFieldId}>
              Market
            </label>
            <select
              id={marketFieldId}
              className="ob-input"
              value={tryIt.marketId}
              disabled={tryIt.markets.length === 0}
              onChange={(event) => tryIt.setMarketId(event.target.value)}
            >
              {tryIt.markets.length === 0 ? (
                <option value="">Page&apos;s default market</option>
              ) : null}
              {tryIt.markets.map((market) => (
                <option key={market.id} value={market.id}>
                  {marketLabel(market)}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      <div className="tpl-actions">
        <Button
          icon="play"
          disabled={blocked || tryIt.running}
          onClick={() => void tryIt.run(body, settings)}
        >
          {tryIt.running ? 'Running…' : 'Run on sample'}
        </Button>
        <span className="faint">{cost}</span>
      </div>
      {/* Owner feedback #1: the page read and Claude call of the try, live. */}
      {tryIt.running ? <AssistProgress progress={progress} title="Asking CiteFox AI…" /> : null}
      <div className="tpl-try-result" aria-live="polite">
        {tryIt.error ? (
          <p className="field-error" role="alert">
            <Icon name="warning" />
            {tryIt.error}
          </p>
        ) : null}
        {result ? (
          <p className={result.matched ? 'tpl-saved' : 'tpl-problem'}>
            <Icon name={result.matched ? 'check' : 'warning'} />
            <span>{tryResultLine(kind, result)}</span>
          </p>
        ) : null}
      </div>
      {result ? (
        <>
          <p className="hint">
            {TRY_SAVED_NOTHING}
            {result.model ? ` Model: ${modelLabel(result.model)}.` : ''}
          </p>
          <pre
            className="mono tpl-view tpl-try-output"
            tabIndex={0}
            role="region"
            aria-label="CiteFox AI's answer"
          >
            {result.output}
          </pre>
          <details className="tpl-prompt-details">
            <summary>The prompt CiteFox sent</summary>
            <pre className="mono tpl-view">{result.renderedPrompt}</pre>
          </details>
        </>
      ) : null}
    </>
  )
}
