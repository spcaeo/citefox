import type { JSX } from 'react'
import type { FillFromWebsiteResult } from '@shared/ipc'
import { cleanErrorMessage } from '../components/errorText'
import { AssistProgress, UiIcon, UrlText } from '../ui'
import { FillTabs } from './FillTabs'
import type { FillActions } from './types'
import type { FillState } from './useFillFromWebsite'
import './fill.css'

/** A typical read: four pages, a site read, then one web search per product (batch 2 row 5). */
const FILL_EXPECTED_SECONDS = 90

/** What the read uses, in the progress panel and the card's meta line. */
const FILL_READS = 'reads your site · searches the web for competitors'

/**
 * Progress, error, and the suggestions from `projects:fillFromWebsite`, as
 * one v2 suggestion card (Seed-Profile.png "Fill gaps from your site").
 * Nothing is applied until the user picks a suggestion. The card opens with what the
 * business does, then five tabs (owner feedback, work console mock-up): Competitors
 * (per product, with a price column and the cheapest in green), Buyers, Switching
 * from, Integrations, and Brand & market. The open tab is in the URL (`?fill=`).
 */
export function FillSuggestions({
  state,
  ...actions
}: FillActions & { state: FillState }): JSX.Element {
  return (
    <>
      {/* Owner feedback #1: every page read and the Claude call as they happen, then folded. */}
      <AssistProgress
        progress={state.live}
        title="Reading your website"
        reads={FILL_READS}
        expectedSeconds={FILL_EXPECTED_SECONDS}
      />
      {state.error ? (
        <p className="fill-error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.result ? (
        <Suggestions
          result={state.result}
          reads={state.origin === 'chatbot' ? 'from your chatbot’s answer' : FILL_READS}
          {...actions}
        />
      ) : null}
    </>
  )
}

function Suggestions({
  result,
  reads,
  ...actions
}: FillActions & { result: FillFromWebsiteResult; reads: string }): JSX.Element {
  const market = result.suggestedMarket
  const message = cleanErrorMessage(result.message) || result.message
  // A mapped message may already end with the engine's next step ("Try again.").
  const nextStep = result.nextStep && !message.includes(result.nextStep) ? result.nextStep : null
  const count =
    result.brands.length +
    result.competitors.length +
    result.switchingFrom.length +
    result.integrations.length +
    (market ? 1 : 0)
  return (
    <section className="fill-card" role="region" aria-label="Suggestions from the website">
      <div className="fill-head">
        <span className="fill-mark" aria-hidden="true">
          <UiIcon name="sparkle" size={14} />
        </span>
        <div className="fill-titles">
          <p className="fill-title">
            From <UrlText domain={result.domain} plain />
          </p>
          <p className="fill-meta num">
            {count} {count === 1 ? 'suggestion' : 'suggestions'} · {reads} · nothing changes until
            you add it
          </p>
        </div>
      </div>
      {result.summary ? (
        <p className="fill-summary">
          <span className="fill-label">What {result.domain} does</span>
          {result.summary}
        </p>
      ) : null}
      <div className="fill-body">
        <p>{message}</p>
        {nextStep ? <p className="fill-hint">{nextStep}</p> : null}
      </div>
      <FillTabs result={result} {...actions} />
      {result.pagesRead.length > 0 ? (
        <p className="fill-note">
          Pages read:{' '}
          {result.pagesRead
            .map((page) => `${page.role} ${page.ok ? 'ok' : 'not loaded'}`)
            .join(' · ')}
        </p>
      ) : null}
    </section>
  )
}
