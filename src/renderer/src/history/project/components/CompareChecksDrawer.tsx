import { useEffect, useState, type JSX } from 'react'
import type { ContentDiff, Market } from '@shared/domain'
import type { HistorySubject, ProjectCheck } from '@shared/ipc'
import { errorText } from '../../../components/errorText'
import { marketLabel } from '../../../shell/model'
import { closeDrawersThen } from '../../../shell/drawers'
import { formatMoment } from '../../../utils/dates'
import { Drawer, Tabs } from '../../../ui'
import type { CompareSource } from '../../client'
import { DiffBody } from '../../CompareDialog'
import { changeCount } from '../../model'
import { changeText, checkHash, contentBlock, type CompareTab } from '../model'
import { usePairResults, type LoadRunResults } from '../hooks/useRunResults'
import { moveCounts, pairQuestions } from '../utils/compare'
import { CompareResults } from './CompareResults'

/**
 * Compare checks (`drawer=compare-checks&cmp.a=<older>&cmp.b=<newer>&cmp.tab=`):
 * two checks of the same page or topic, results first (totals, score change,
 * every question side by side), then "Page content", the diff of the two page
 * reads when the checks read different versions of a page. The pair and the
 * tab are on the URL, so a copied link reopens the same comparison.
 */
export function CompareChecksDrawer({
  source,
  projectId,
  pair,
  problem,
  subjects,
  markets,
  domain,
  tab,
  load,
  onTab,
  onClose
}: {
  source: CompareSource
  projectId: string
  /** Older first. Null when the link's checks are not both here. */
  pair: readonly [ProjectCheck, ProjectCheck] | null
  /** Why the link's pair cannot be compared, when it cannot. */
  problem: string | null
  subjects: ReadonlyMap<string, HistorySubject>
  markets: ReadonlyMap<string, Market>
  domain: string | null
  tab: CompareTab
  load: LoadRunResults
  onTab: (tab: CompareTab) => void
  onClose: () => void
}): JSX.Element {
  const results = usePairResults(load, problem === null ? pair : null)
  const content = pair === null ? 'No checks to compare.' : contentBlock(pair, subjects)
  const shownTab: CompareTab = tab === 'content' && content === null ? 'content' : 'results'
  const diff = useContentDiff(source, projectId, pair, content === null && shownTab === 'content')

  if (pair === null || problem !== null) {
    return (
      <Drawer
        id="compare-checks"
        title="Compare checks"
        testId="compare-checks-drawer"
        error={{ message: problem ?? 'Those checks are not in this project any more.' }}
        onClose={onClose}
      />
    )
  }

  const [older, newer] = pair
  const subject = subjects.get(older.pageId)
  const topic = subject?.kind === 'topic'
  const label = (check: ProjectCheck): string => formatMoment(check.startedAt)
  const title = `Compare ${label(older)} vs ${label(newer)}`
  const marketsLine =
    older.marketId === newer.marketId
      ? marketName(markets, older.marketId)
      : `${marketName(markets, older.marketId)} vs ${marketName(markets, newer.marketId)}`
  const moves =
    results.before !== null && results.after !== null
      ? moveCounts(pairQuestions(results.before, results.after, topic))
      : null
  const delta = older.score === null || newer.score === null ? null : newer.score - older.score

  return (
    <Drawer
      id="compare-checks"
      title={title}
      subtitle={`${subject?.label ?? 'Removed page'} · ${marketsLine}`}
      testId="compare-checks-drawer"
      focusOnOpen="close"
      headerExtra={
        <Tabs<CompareTab>
          label="Compare"
          size="sm"
          value={shownTab}
          onChange={onTab}
          tabs={[
            { id: 'results', label: 'Results' },
            ...(content === null ? [{ id: 'content' as const, label: 'Page content' }] : [])
          ]}
        />
      }
      loading={
        shownTab === 'results'
          ? results.before === null && results.error === null
          : diff.diff === null && diff.error === null
      }
      error={
        shownTab === 'results' && results.error !== null
          ? { message: results.error, onRetry: results.retry }
          : shownTab === 'content' && diff.error !== null
            ? { message: diff.error }
            : undefined
      }
      onClose={onClose}
      footer={{
        summary: (
          <>
            <strong>
              Score {older.score ?? '—'} → {newer.score ?? '—'}
            </strong>
            {delta === null ? '' : ` (${changeText(delta)})`}
            {moves === null ? '' : ` · ${moves.gained} gained · ${moves.lost} lost`}
          </>
        ),
        cancel: 'Close',
        secondary: {
          label: `Open the ${formatMoment(newer.startedAt)} results`,
          onClick: () => closeDrawersThen(checkHash(newer, subject))
        }
      }}
    >
      {shownTab === 'content' && diff.diff !== null ? (
        <>
          <p className="faint hp-cmp-diff-line">
            {changeCount(diff.diff)} {changeCount(diff.diff) === 1 ? 'change' : 'changes'} between
            the page reads of {formatMoment(diff.diff.from.fetchedAt)} and{' '}
            {formatMoment(diff.diff.to.fetchedAt)}.
          </p>
          <DiffBody diff={diff.diff} />
        </>
      ) : null}
      {shownTab === 'results' && content !== null ? (
        <p className="faint hp-cmp-diff-line">Page content: {content}</p>
      ) : null}
      {shownTab === 'results' && results.before !== null && results.after !== null ? (
        <CompareResults
          pair={pair}
          before={results.before}
          after={results.after}
          topic={topic}
          domain={domain}
        />
      ) : null}
    </Drawer>
  )
}

function marketName(markets: ReadonlyMap<string, Market>, marketId: string): string {
  const market = markets.get(marketId)
  return market ? marketLabel(market) : 'Removed market'
}

/** `history:compare` for the two checks' page reads, loaded when the Page content tab opens. */
function useContentDiff(
  source: CompareSource,
  projectId: string,
  pair: readonly [ProjectCheck, ProjectCheck] | null,
  wanted: boolean
): { diff: ContentDiff | null; error: string | null } {
  const pageId = pair?.[0].pageId ?? null
  const from = pair?.[0].snapshotId ?? null
  const to = pair?.[1].snapshotId ?? null
  const key = wanted && pageId !== null ? `${pageId}|${from}|${to}` : ''
  const [state, setState] = useState<{
    key: string
    diff: ContentDiff | null
    error: string | null
  }>({ key: '', diff: null, error: null })
  useEffect(() => {
    if (key === '' || pageId === null || from === null || to === null) return
    let live = true
    Promise.resolve()
      .then(() =>
        source['history:compare']({ projectId, pageId, fromSnapshotId: from, toSnapshotId: to })
      )
      .then(
        (diff) => {
          if (live) setState({ key, diff, error: null })
        },
        (cause: unknown) => {
          if (live)
            setState({ key, diff: null, error: errorText(cause, 'Could not compare the content.') })
        }
      )
    return () => {
      live = false
    }
  }, [key, source, projectId, pageId, from, to])
  return state.key === key ? { diff: state.diff, error: state.error } : { diff: null, error: null }
}
