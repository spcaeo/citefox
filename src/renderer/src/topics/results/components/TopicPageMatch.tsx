import { useEffect, useRef, useState, type JSX } from 'react'
import type { TopicResultRow } from '@shared/domain'
import { targetPagePath } from '@shared/target-page'
import { Button } from '../../../ui'
import type { TopicResultsSource } from '../source'
import { targetGuess } from '../model/targetGuess'

/** Topics matched this session, so opening a topic twice asks CiteFox AI once. */
const asked = new Set<string>()

/**
 * Under the topic header while it has no target page: CiteFox AI matches every question
 * to its best page once on its own (fit % per question, Best page column), then the
 * card suggests the page that fits most questions as the topic's target page. Until one
 * is set, any page of the site counts as cited.
 */
export function TopicPageMatch({
  projectId,
  topicId,
  marketId,
  rows,
  hasTarget,
  source,
  onSaved
}: {
  projectId: string
  topicId: string
  marketId: string | null
  rows: readonly TopicResultRow[]
  hasTarget: boolean
  source: TopicResultsSource
  onSaved: () => void
}): JSX.Element | null {
  const [busy, setBusy] = useState<'match' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const match = async (): Promise<void> => {
    if (!source.matchTracked) return
    setBusy('match')
    setError(null)
    try {
      await source.matchTracked({ projectId, topicId, marketId })
      if (live.current) onSaved()
    } catch (caught) {
      if (live.current)
        setError(caught instanceof Error ? caught.message : 'CiteFox AI could not match the pages.')
    } finally {
      if (live.current) setBusy(null)
    }
  }

  const unmatched = rows.length > 0 && rows.every((row) => row.matchReason === null)
  useEffect(() => {
    if (!unmatched || !source.matchTracked || asked.has(topicId)) return
    // After this render: matching sets state, which an effect must not do itself.
    const timer = window.setTimeout(() => {
      if (asked.has(topicId)) return
      asked.add(topicId)
      void match()
    }, 0)
    return () => window.clearTimeout(timer)
    // Once per topic per session; `match` reads the latest props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unmatched, topicId])

  if (hasTarget) return null
  const guess = targetGuess(rows)

  const applyGuess = async (url: string): Promise<void> => {
    setBusy('save')
    setError(null)
    try {
      await source.update({ projectId, topicId, targetPage: url })
      if (live.current) onSaved()
    } catch (caught) {
      if (live.current)
        setError(caught instanceof Error ? caught.message : 'The target page was not saved.')
    } finally {
      if (live.current) setBusy(null)
    }
  }

  return (
    <section className="ui-panel tr-match" aria-label="Target page suggestion">
      {busy === 'match' ? (
        <p role="status">CiteFox AI is matching each question to its best page on your site…</p>
      ) : guess !== null ? (
        <p>
          <b>Suggested target page: {targetPagePath(guess.url)}</b>{' '}
          <span className="tv-muted">
            · best page for {guess.fits} of {rows.length} questions · {guess.avgFit}% fit on average
          </span>
        </p>
      ) : (
        <p>
          <b>No target page yet.</b>{' '}
          <span className="tv-muted">
            {unmatched
              ? 'Any page of your site counts as cited until you set one.'
              : 'No single page fits most of these questions. Any page of your site counts as cited; each question shows its best page.'}
          </span>
        </p>
      )}
      <div className="tr-match-actions">
        {guess !== null ? (
          <Button
            variant="primary"
            disabled={busy !== null}
            onClick={() => void applyGuess(guess.url)}
          >
            Use as target page
          </Button>
        ) : null}
        {source.matchTracked ? (
          <Button disabled={busy !== null} onClick={() => void match()}>
            {unmatched ? 'Match pages with AI' : 'Match again'}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="tv-muted">
          {error}
        </p>
      ) : null}
    </section>
  )
}
