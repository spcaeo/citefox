import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { TopicResultRow } from '@shared/domain'
import { currentClientMode } from '../../onboarding/flags'
import { DrawerLevel } from '../../shell/DrawerLevel'
import { openDrawer, useDrawerEntry } from '../../shell/drawers'
import { Button, ToolButton, UiIcon, UrlText } from '../../ui'
import { ChangeTargetDrawer } from '../../topics/results/components/ChangeTargetDrawer'
import { urlPath } from '../../topics/results/model/scoring'
import { topicResultsSource, type TopicResultsSource } from '../../topics/results/source'

const STATE_WORDS: Record<TopicResultRow['state'], string> = {
  right_page: 'Right page cited',
  other_page: 'Your other page cited',
  not_cited: 'Not cited',
  no_page: 'Not cited · no target page yet',
  no_aio: 'No AI Overview',
  failed: 'Check failed',
  not_checked: 'Not checked yet'
}

/** Where the question's target page came from, in plain words. */
function targetSource(row: TopicResultRow): string {
  if (row.targetUrl === null) return 'No target page yet: any of your pages counts as cited.'
  if (row.targetConfirmed) return 'You picked this page.'
  if (row.aiPageUrl && row.aiPageUrl === row.targetUrl)
    return `CiteFox AI's pick · ${row.matchConfidence ?? 0}% fit.`
  return "The topic's target page."
}

/**
 * On a topic question's page: its target page (yours, CiteFox AI's or the topic's)
 * with Change, which opens the same "Target page" drawer as the topic's list, for
 * this one question. The result line follows the target at once; the stored check
 * on the page below follows on the next check.
 */
export function QuestionTarget({
  projectId,
  topicId,
  promptId,
  marketId,
  source: given
}: {
  projectId: string
  topicId: string
  promptId: string
  marketId: string | null
  source?: TopicResultsSource
}): JSX.Element | null {
  const source = useMemo(() => given ?? topicResultsSource(currentClientMode()), [given])
  const [row, setRow] = useState<TopicResultRow | null>(null)
  const [attempt, setAttempt] = useState(0)
  const drawer = useDrawerEntry('topic-target')

  useEffect(() => {
    let cancelled = false
    source.results({ projectId, topicId, marketId, runId: null }).then(
      (results) => {
        if (!cancelled) setRow(results.rows.find((item) => item.promptId === promptId) ?? null)
      },
      () => {
        if (!cancelled) setRow(null)
      }
    )
    return () => {
      cancelled = true
    }
  }, [source, projectId, topicId, promptId, marketId, attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  if (row === null) return null
  const path = row.targetUrl === null ? null : (urlPath(row.targetUrl) ?? row.targetUrl)
  const hint =
    row.targetUrl === null && row.aiPageUrl
      ? ` CiteFox AI suggests ${urlPath(row.aiPageUrl) ?? row.aiPageUrl}.`
      : ''

  const how = row.targetConfirmed
    ? 'you picked it'
    : row.targetUrl !== null && row.aiPageUrl === row.targetUrl
      ? `AI pick · ${row.matchConfidence ?? 0}% fit`
      : row.targetUrl !== null
        ? "topic's page"
        : null
  return (
    <span
      className={path === null ? 'pd2-target is-unset' : 'pd2-target'}
      title={`${targetSource(row)}${hint} Result: ${STATE_WORDS[row.state]}.`}
    >
      <UiIcon name="target" size={14} />
      <span className="pd2-target-label">Target page</span>
      {path === null ? (
        <span className="pd2-target-path is-empty">
          none yet
          {row.aiPageUrl
            ? ` · AI suggests ${urlPath(row.aiPageUrl) ?? row.aiPageUrl} (${row.matchConfidence ?? 0}% fit)`
            : ''}
        </span>
      ) : (
        <UrlText
          className="pd2-target-path"
          url={row.targetUrl ?? ''}
          label={path}
          icon={false}
        />
      )}
      {(row.alsoUrls ?? []).length > 0 ? (
        <span
          className="tv-muted"
          title={`Also OK: ${(row.alsoUrls ?? []).map((url) => urlPath(url) ?? url).join(', ')}`}
        >
          + {(row.alsoUrls ?? []).length} more
        </span>
      ) : null}
      {how ? <span className="tv-muted">{how}</span> : null}
      {row.citedOwnUrl ? (
        <span className={row.state === 'right_page' ? 'pd2-target-cited' : 'tv-muted'}>
          {row.state === 'right_page' ? 'Right page: Google cites ' : 'Google cites your '}
          <UrlText url={row.citedOwnUrl} label={urlPath(row.citedOwnUrl) ?? row.citedOwnUrl} icon={false} />
        </span>
      ) : null}
      {path === null ? (
        <Button size="sm" onClick={() => openDrawer('topic-target', { 'tt.ids': promptId })}>
          Link pages
        </Button>
      ) : (
        <ToolButton
          kind="edit"
          label="Change pages"
          onClick={() => openDrawer('topic-target', { 'tt.ids': promptId })}
        />
      )}
      {drawer ? (
        <DrawerLevel depth={drawer.depth}>
          <ChangeTargetDrawer
            projectId={projectId}
            topicId={topicId}
            rows={[row]}
            source={source}
            onClose={() => drawer.close()}
            onSaved={reload}
          />
        </DrawerLevel>
      ) : null}
    </span>
  )
}
