import { useEffect, useRef, useState, type JSX } from 'react'
import type { QuestionRow, QuestionSource, TopicPageCandidate, TopicTarget } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { ScreenDrawerLevel } from '../../shell/DrawerLevel'
import { openDrawer } from '../../shell/drawers'
import { pathOf } from '../../topics/clusters'
import {
  Button,
  Chip,
  Drawer,
  SearchBox,
  DrawerGrid,
  DrawerMain,
  DrawerRail,
  DrawerSection,
  UrlText
} from '../../ui'
import { countText } from '../model'
import type { QuestionsSource } from '../source'

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; candidates: readonly TopicPageCandidate[] }

/** Shown at most; the filter box finds the rest. */
const SHOWN_MAX = 60
/** Picked questions listed in the rail; the rest are counted. */
const LISTED_MAX = 8

/**
 * "Set target page" (`?panel=target&pick=…`), a drawer: the page the ticked topic
 * questions should be cited from, picked from the tracked pages and the sitemap
 * (`topics:pageCandidates`), or a page tracked from here. Page questions keep their
 * own page, so they are counted and skipped. The rail lists the questions it sets.
 */
export function TargetDrawer({
  rows,
  sources,
  source,
  projectId,
  busy,
  onClose,
  onApply
}: {
  /** The picked questions still in the list. */
  rows: readonly QuestionRow[]
  sources: ReadonlyMap<string, QuestionSource>
  source: QuestionsSource
  projectId: string
  busy: boolean
  onClose: () => void
  onApply: (target: TopicTarget) => void
}): JSX.Element {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [filter, setFilter] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  /** A page just tracked from "+ Track a new page…" (its id or URL), picked once loaded. */
  const tracked = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    source['topics:pageCandidates']({ projectId }).then(
      (result) => {
        if (cancelled) return
        setLoad({ status: 'ready', candidates: result.candidates })
        const wanted = tracked.current
        if (wanted !== null) {
          tracked.current = null
          const found = result.candidates.find(
            (candidate) => candidate.pageId === wanted || candidate.url === wanted
          )
          if (found) setPicked(found.url)
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setLoad({ status: 'error', message: errorText(cause, 'Could not load your pages.') })
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [source, projectId, attempt])

  const topicRows = rows.filter((row) => sources.get(row.sourceId)?.kind === 'topic')
  const skipped = rows.length - topicRows.length
  const needle = filter.trim().toLowerCase()
  const candidates = load.status === 'ready' ? load.candidates : []
  const matching = candidates.filter(
    (candidate) =>
      needle === '' ||
      candidate.url.toLowerCase().includes(needle) ||
      (candidate.title ?? '').toLowerCase().includes(needle)
  )
  const choice = candidates.find((candidate) => candidate.url === picked) ?? null
  const retry = (): void => {
    setLoad({ status: 'loading' })
    setAttempt((n) => n + 1)
  }

  return (
    <ScreenDrawerLevel onClose={onClose}>
      <Drawer
        id="question-target"
        title="Set target page"
        subtitle={`${countText(rows.length, 'question')} · the page they should be cited from. Fixes and drafts aim at it.`}
        dirty={picked !== null}
        busy={busy}
        closeDisabled={busy}
        onClose={onClose}
        testId="target-drawer"
        footer={{
          summary:
            choice !== null ? (
              <>
                <strong className="num">{countText(topicRows.length, 'question')}</strong> point at{' '}
                {pathOf(choice.url)} · No new searches
              </>
            ) : (
              'Pick a page · No new searches'
            ),
          primary: {
            label: `Set for ${countText(topicRows.length, 'question')}`,
            disabled: choice === null || topicRows.length === 0,
            busy,
            onClick: () => {
              if (choice !== null) onApply({ pageId: choice.pageId, url: choice.url })
            }
          }
        }}
      >
        <DrawerGrid className="qs-drawer">
          <DrawerMain>
            <DrawerSection
              title="Pick a page"
              {...(load.status === 'ready' ? { count: candidates.length } : {})}
              description="Your tracked pages first, then pages from your sitemap."
              loading={load.status === 'loading'}
              error={load.status === 'error' ? load.message : null}
              onRetry={retry}
              actions={
                <Button
                  size="sm"
                  variant="ghost"
                  icon="plus"
                  onClick={() =>
                    openDrawer(
                      'track-page',
                      {},
                      {
                        onResult: (page) => {
                          if (typeof page !== 'string') return
                          tracked.current = page
                          setAttempt((n) => n + 1)
                        }
                      }
                    )
                  }
                >
                  Track a new page…
                </Button>
              }
            >
              {load.status === 'loading' ? (
                <p className="sr-only" role="status">
                  Loading your pages…
                </p>
              ) : null}
              {load.status === 'ready' ? (
                <>
                  <SearchBox
                    className="qs-panel-find"
                    label="Search pages by path or title"
                    value={filter}
                    onChange={setFilter}
                  />
                  {matching.length === 0 ? <p className="faint">No page matches.</p> : null}
                  <ul className="qs-pages" aria-label="Pages">
                    {matching.slice(0, SHOWN_MAX).map((candidate) => (
                      <li key={candidate.url} className="qs-page">
                        <label className="qs-page-pick">
                          <input
                            type="radio"
                            name="qs-target"
                            checked={picked === candidate.url}
                            onChange={() => setPicked(candidate.url)}
                          />
                          <span className="qs-page-title">
                            {candidate.title ?? pathOf(candidate.url)}
                          </span>
                        </label>
                        {candidate.source === 'sitemap' ? <Chip size="sm">Sitemap</Chip> : null}
                        <UrlText url={candidate.url} label={pathOf(candidate.url)} />
                      </li>
                    ))}
                  </ul>
                  {matching.length > SHOWN_MAX ? (
                    <p className="faint">
                      {countText(matching.length - SHOWN_MAX, 'more page')}. Type to narrow the
                      list.
                    </p>
                  ) : null}
                </>
              ) : null}
            </DrawerSection>
          </DrawerMain>
          <DrawerRail label="These questions">
            <DrawerSection title="These questions" count={rows.length}>
              {rows.length === 0 ? (
                <p role="status">Tick questions in the list first, then Set target page.</p>
              ) : (
                <ul className="qs-dest" aria-label="Questions">
                  {rows.slice(0, LISTED_MAX).map((row) => (
                    <li key={row.promptId} className="qs-dest-row">
                      <span className="qs-dest-name">{row.text}</span>
                    </li>
                  ))}
                </ul>
              )}
              {rows.length > LISTED_MAX ? (
                <p className="faint">and {countText(rows.length - LISTED_MAX, 'more question')}</p>
              ) : null}
              {skipped > 0 ? (
                <p className="faint">
                  {countText(skipped, 'page question')} skipped: a page question&apos;s target is
                  its own page.
                </p>
              ) : null}
            </DrawerSection>
          </DrawerRail>
        </DrawerGrid>
      </Drawer>
    </ScreenDrawerLevel>
  )
}
