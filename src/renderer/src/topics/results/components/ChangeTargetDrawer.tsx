import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { TopicPageCandidate } from '@shared/ipc'
import { errorText } from '../../../components/errorText'
import { openDrawer } from '../../../shell/drawers'
import {
  Button,
  Drawer,
  SearchBox,
  DrawerGrid,
  DrawerMain,
  DrawerSection,
  UrlText
} from '../../../ui'
import { urlPath } from '../model/scoring'
import type { TopicResultsSource } from '../source'
import type { TopicResultRow } from '../types'
import '../results.css'

const NO_PAGE = '__none__'
/** Shown at most; the filter box finds the rest. */
const SHOWN_MAX = 60

function count(n: number, noun: string): string {
  return `${n.toLocaleString('en-US')} ${noun}${n === 1 ? '' : 's'}`
}

/**
 * Change target page (`drawer=topic-target&tt.ids=<promptIds>` over a topic's
 * results): pick an own tracked (or sitemap) page for one or more questions, or
 * "No page yet", or track a new page from here. Saved through `topics:setTarget`;
 * the screen reloads so the to-do regroups. Unsaved changes ask before closing.
 */
export function ChangeTargetDrawer({
  projectId,
  topicId,
  rows,
  source,
  onClose,
  onSaved
}: {
  projectId: string
  topicId: string
  rows: readonly TopicResultRow[]
  source: TopicResultsSource
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const [candidates, setCandidates] = useState<readonly TopicPageCandidate[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')
  const [attempt, setAttempt] = useState(0)
  const first = rows[0]
  const initial = first?.targetUrl ?? NO_PAGE
  const [picked, setPicked] = useState<string>(initial)
  const initialAlso = useMemo(() => [...(first?.alsoUrls ?? [])].sort(), [first])
  const [also, setAlso] = useState<readonly string[]>(initialAlso)
  const alsoNow = also.filter((url) => url !== picked)
  const alsoChanged = [...alsoNow].sort().join('\n') !== initialAlso.join('\n')
  /** A page just tracked from "Track a new page…" (its id or URL), picked once loaded. */
  const tracked = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    source.pageCandidates(projectId).then(
      (result) => {
        if (cancelled) return
        setCandidates(result.candidates)
        setLoadError(null)
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
        if (!cancelled) setLoadError(errorText(cause, 'Could not list your pages.'))
      }
    )
    return () => {
      cancelled = true
    }
  }, [source, projectId, attempt])

  // Pages the topic already knows (CiteFox AI's picks, pages Google cites, targets) join
  // the list, so a site whose sitemap was never read still shows them.
  const known = useMemo(() => {
    const extra: TopicPageCandidate[] = []
    for (const row of rows) {
      for (const url of [
        row.aiPageUrl ?? null,
        row.targetUrl,
        row.citedOwnUrl,
        ...(row.alsoUrls ?? [])
      ]) {
        if (url) extra.push({ url, title: null, pageId: null, source: 'sitemap', outline: [] })
      }
    }
    return extra
  }, [rows])
  const list = useMemo(() => {
    if (candidates === null) return null
    const seen = new Set<string>()
    const keyOf = (url: string): string => url.replace(/\/+$/, '').toLowerCase()
    const out: TopicPageCandidate[] = []
    // Your primary and other pages first, then the AI's pick, then the rest.
    const ai = rows.length === 1 ? (first?.aiPageUrl ?? null) : null
    const top = [first?.targetUrl ?? null, ...initialAlso, ai]
    const lead = top.flatMap((url) => known.filter((k) => k.url === url))
    for (const item of [...lead, ...candidates, ...known]) {
      const key = keyOf(item.url)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(item)
    }
    return out
  }, [candidates, known, rows.length, first, initialAlso])
  const aiPick = rows.length === 1 && first?.aiPageUrl ? first.aiPageUrl : null
  const [reading, setReading] = useState(false)
  async function readSitemap(): Promise<void> {
    if (!source.readSitemap) return
    setReading(true)
    setLoadError(null)
    try {
      await source.readSitemap(projectId)
      setAttempt((n) => n + 1)
    } catch (cause) {
      setLoadError(errorText(cause, 'Could not read your sitemap.'))
    } finally {
      setReading(false)
    }
  }

  async function save(): Promise<void> {
    setSaving(true)
    setError(null)
    const candidate = list?.find((item) => item.url === picked) ?? null
    try {
      await source.setTarget({
        projectId,
        topicId,
        promptIds: rows.map((row) => row.promptId),
        target: candidate
          ? { pageId: candidate.pageId, url: candidate.url }
          : { pageId: null, url: null },
        alsoUrls: candidate ? alsoNow : []
      })
      onSaved()
      onClose()
    } catch (cause) {
      setError(errorText(cause, 'Could not change the target page.'))
      setSaving(false)
    }
  }

  // The example uses this project's own pages: your picks, else the AI's pick and the
  // next pages in the list. Never a fixed site.
  const example = useMemo(() => {
    const pathOf = (url: string): string => urlPath(url) ?? url
    const primary = picked !== NO_PAGE ? picked : (aiPick ?? list?.[0]?.url ?? null)
    if (primary === null) return null
    const others = alsoNow
    return { primary: pathOf(primary), also: others.slice(0, 3).map(pathOf) }
  }, [picked, aiPick, list, alsoNow])

  const needle = filter.trim().toLowerCase()
  const matching = (list ?? []).filter(
    (candidate) =>
      needle === '' ||
      candidate.url.toLowerCase().includes(needle) ||
      (candidate.title ?? '').toLowerCase().includes(needle)
  )
  const title =
    rows.length === 1 && first
      ? 'Target pages for this question'
      : rows.length === 0
        ? 'Change target pages'
        : `Target pages for ${rows.length} questions`
  const pickedPath =
    picked === NO_PAGE
      ? 'no page yet'
      : `${urlPath(picked) ?? picked}${alsoNow.length > 0 ? ` + ${alsoNow.length} more` : ''}`

  return (
    <Drawer
      id="topic-target"
      title={title}
      subtitle={
        rows.length === 1 && first
          ? first.text
          : first
            ? `“${first.text}” and ${rows.length - 1} more`
            : 'The pages these questions should be cited from.'
      }
      dirty={picked !== initial || alsoChanged}
      busy={saving}
      closeDisabled={saving}
      onClose={onClose}
      testId="change-target-drawer"
      {...(rows.length === 0
        ? { error: { message: 'These questions are not in this topic any more.' } }
        : {})}
      footer={{
        summary: error ? (
          <span className="ui-drawer-error" role="alert">
            {error}
          </span>
        ) : (
          <>
            <strong className="num">{count(rows.length, 'question')}</strong> → {pickedPath} · No
            new searches
          </>
        ),
        ...(rows.length > 0
          ? {
              primary: {
                label: 'Save target',
                busy: saving,
                // Nothing changed yet: saving would only rewrite (or clear) the current target.
                disabled:
                  (picked === initial && !alsoChanged) ||
                  (candidates === null && picked !== NO_PAGE),
                onClick: () => void save()
              }
            }
          : {})
      }}
    >
      <DrawerGrid className="tr-retarget">
        <DrawerMain>
          <DrawerSection
            title="Pick pages"
            {...(list !== null ? { count: list.length } : {})}
            description={
              'Pick one Primary page, then tick Also OK on any other pages of yours that answer this question too.'
            }
            loading={candidates === null && loadError === null}
            error={loadError}
            onRetry={() => {
              setLoadError(null)
              setAttempt((n) => n + 1)
            }}
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
            {candidates === null && loadError === null ? (
              <p className="sr-only" role="status">
                Loading your pages…
              </p>
            ) : null}
            <div className="tr-also-help" role="note">
              <p>
                <b>Primary</b> is the page you most want Google to cite. <b>Also OK</b> marks your
                other pages that answer the question too: Google may cite any of them, even two at
                once, and that changes as you update pages.
              </p>
              {example ? (
                <p className="tv-muted">
                  Example from this question: Primary <code>{example.primary}</code>
                  {example.also.length > 0 ? (
                    <>
                      , Also OK{' '}
                      {example.also.map((path, index) => (
                        <span key={path}>
                          {index > 0 ? (index === example.also.length - 1 ? ' and ' : ', ') : ''}
                          <code>{path}</code>
                        </span>
                      ))}
                    </>
                  ) : (
                    <>, plus any page you tick Also OK</>
                  )}
                  . If Google cites any of them, the result is <b>Right page</b> and names the one
                  it cited. Any other page of yours is <b>Your other page</b>. Saving spends no
                  search.
                </p>
              ) : (
                <p className="tv-muted">
                  If Google cites any of them, the result is <b>Right page</b> and names the one it
                  cited. Any other page of yours is <b>Your other page</b>. Saving spends no search.
                </p>
              )}
            </div>
            {candidates !== null ? (
              <>
                {candidates.length === 0 && source.readSitemap ? (
                  <p className="faint">
                    Your sitemap has not been read yet, so only pages Google already cites are
                    listed.{' '}
                    <Button size="sm" busy={reading} onClick={() => void readSitemap()}>
                      Read my sitemap
                    </Button>
                  </p>
                ) : null}
                {(list?.length ?? 0) > 8 ? (
                  <SearchBox
                    label="Search pages by path or title"
                    value={filter}
                    onChange={setFilter}
                  />
                ) : null}
                <fieldset className="tr-targets">
                  <legend className="sr-only">Pick a page</legend>
                  {matching.slice(0, SHOWN_MAX).map((candidate) => (
                    <div key={candidate.url} className="tr-target">
                      <label className="tr-target-main">
                        {/* Named by the path alone, not by the Copy and Open buttons beside it. */}
                        <input
                          type="radio"
                          name="target"
                          value={candidate.url}
                          aria-label={`Primary: ${urlPath(candidate.url) ?? candidate.url}`}
                          checked={picked === candidate.url}
                          onChange={() => setPicked(candidate.url)}
                        />
                        <UrlText
                          url={candidate.url}
                          label={urlPath(candidate.url) ?? candidate.url}
                        />
                      </label>
                      {candidate.url === aiPick ? (
                        <span className="tr-target-note">
                          AI pick · {first?.matchConfidence ?? 0}% fit
                        </span>
                      ) : null}
                      {picked === candidate.url ? (
                        <span className="tr-target-badge">Primary</span>
                      ) : (
                        <label className="tr-target-also">
                          <input
                            type="checkbox"
                            className="ui-check"
                            disabled={picked === NO_PAGE}
                            checked={also.includes(candidate.url)}
                            onChange={(event) => {
                              const on = event.currentTarget.checked
                              setAlso((now) =>
                                on
                                  ? [...now, candidate.url].slice(-10)
                                  : now.filter((url) => url !== candidate.url)
                              )
                            }}
                          />
                          <span>Also OK</span>
                        </label>
                      )}
                    </div>
                  ))}
                  <label className="tr-target">
                    <input
                      type="radio"
                      name="target"
                      value={NO_PAGE}
                      checked={picked === NO_PAGE}
                      onChange={() => setPicked(NO_PAGE)}
                    />
                    <span>No page yet</span>
                  </label>
                </fieldset>
                {matching.length > SHOWN_MAX ? (
                  <p className="faint">
                    {count(matching.length - SHOWN_MAX, 'more page')}. Type to narrow the list.
                  </p>
                ) : null}
              </>
            ) : null}
          </DrawerSection>
        </DrawerMain>
      </DrawerGrid>
    </Drawer>
  )
}
