import { useState, type JSX } from 'react'
import type { PromptGoogleSearch } from '@shared/domain'
import { copyQuestions, questionEditSource, type QuestionEditSource } from '../../questionEdit'
import { drawerHref } from '../../shell/drawers'
import { CopyText, IconButton, UrlText } from '../../ui'
import { Card } from './OverviewCards'

/**
 * Google's own results for this prompt, from the search the check already ran: where
 * the site ranks among the organic results, and Google's "People also ask". A
 * question that passes this page's question checks as it is gets + Track (added to
 * this page or topic at once, with Undo); the others can be reworded in Add
 * questions, which lists them under "Seen on Google". Hidden when the stored
 * searches hold neither.
 */
export function GoogleSearchCard({
  google,
  projectId,
  target,
  source
}: {
  google: PromptGoogleSearch
  projectId: string
  /** Where + Track adds the question: this prompt's page or topic. */
  target: { id: string; name: string }
  /** Tests only. Production uses the window-wide question source. */
  source?: QuestionEditSource
}): JSX.Element | null {
  const [tracked, setTracked] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const questions = google.questions.filter((item) => !tracked.has(item.text))
  if (!google.hasResults && google.questions.length === 0) return null
  const reword = questions.some((item) => !item.trackable)

  async function track(text: string): Promise<void> {
    setBusy(text)
    const added = await copyQuestions(
      source ?? questionEditSource(),
      projectId,
      [{ text }],
      target,
      'Added'
    )
    setBusy(null)
    if (added !== null) setTracked((current) => new Set([...current, text]))
  }

  return (
    <Card headingId="pd-google-h" title="Google search">
      {google.hasResults ? <RankLine google={google} /> : null}
      {google.questions.length > 0 ? (
        <>
          <p className="pd2-label" id="pd-paa-h">
            People also ask on Google
          </p>
          {questions.length > 0 ? (
            <ul className="pd2-list pd2-paa" aria-labelledby="pd-paa-h">
              {questions.map(({ text, trackable }) => (
                <li key={text}>
                  <CopyText text={text} />
                  {trackable ? (
                    <IconButton
                      icon="plus"
                      size="sm"
                      tip
                      aria-busy={busy === text || undefined}
                      disabled={busy !== null}
                      label={`Track: ${text}`}
                      onClick={() => void track(text)}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="pd2-muted">All of them are tracked now.</p>
          )}
          {reword ? (
            <p className="pd2-faint">
              Questions without Track need rewording to be tracked here.{' '}
              <a href={drawerHref('add-questions', { target: target.id, tab: 'suggest' })}>
                Reword them in Add questions
              </a>
            </p>
          ) : null}
        </>
      ) : null}
    </Card>
  )
}

function RankLine({ google }: { google: PromptGoogleSearch }): JSX.Element {
  const rank = google.ownRank
  if (rank === null) {
    return (
      <p data-testid="pd-google-rank">
        <strong>Not in the top 10</strong> of Google&apos;s results.
      </p>
    )
  }
  return (
    <p data-testid="pd-google-rank">
      {rank.thisPage ? 'Your page ranks ' : 'Another of your pages ranks '}
      <strong>#{rank.position}</strong> in Google&apos;s results
      {rank.thisPage ? '.' : ': '}
      {rank.thisPage ? null : <UrlText url={rank.url} own />}
    </p>
  )
}
