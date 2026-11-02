import { useEffect, useMemo, useState, type JSX } from 'react'
import type { Market } from '@shared/domain'
import type { CitationReview, ProjectDetail } from '@shared/ipc'
import { NeedsAttention } from '../allPages/components/NeedsAttention'
import { createAllPagesSource, type AllPagesSource } from '../allPages/source'
import { AskSparkle } from '../assistant/sparkle/AskSparkle'
import { CitedPages } from '../citations'
import { PinToSummary } from '../overview/board/PinToSummary'
import { citationsListLink } from '../citations/model'
import { CitationPages } from '../citations/pages/CitationPages'
import { createCitationsSource, type CitationsSource } from '../citations/source'
import { errorText } from '../components/errorText'
import { DrillHost } from '../drill'
import { ViewTabs, useScreenView } from '../ui'
import { useEngineRevision } from './engineRevision'
import { replaceHash } from './routes'
import { SectionFrame } from './SectionFrame'
import '../allPages/allPages.css'

/** The section ✦ menu's questions: what people ask about who AI Overviews cite. */
const ASK = [
  'Which competitor pages do AI Overviews cite most for my questions?',
  'Which of my pages are cited, and for which questions?',
  'Which other sites cited often should I treat as competitors?',
  'What do the most-cited pages have that mine lack?'
]

/** Pages: every search by page (the main view). List: every cited page and whose it is. */
const VIEWS = ['pages', 'list'] as const

/**
 * Citations across the project. Pages (the main view): every search seen from
 * the pages side, your pages, the sites cited instead of you and what needs no
 * page. List: which pages Google's AI Overviews cite for the project's
 * questions, and whose they are (`allpages:citedPages`, the latest full check
 * of every tracked page and topic in every market). Under the view tabs (one
 * row of tabs, then what they show), only when there is something to review,
 * "Wrong page cited" and own pages cited but not tracked (`allpages:citations`),
 * as on All pages. The page-level
 * Citations screen (`visibility/CitationsScreen`) stays on each page.
 */
export function CitationsSection({
  project,
  source: given,
  cited: givenCited
}: {
  project: ProjectDetail
  /** Tests pass sources. Production uses the preload bridge. */
  source?: AllPagesSource
  cited?: CitationsSource
}): JSX.Element {
  const source = useMemo(() => given ?? createAllPagesSource(), [given])
  const cited = useMemo(() => givenCited ?? createCitationsSource(), [givenCited])
  const revision = useEngineRevision()
  // Before the view is read: a List filter link opens the List (once, on arrival).
  useState(() => {
    const listLink = citationsListLink(window.location.hash)
    if (listLink !== null) replaceHash(listLink)
  })
  const screenView = useScreenView('citations', VIEWS, 'pages', { projectId: project.id })
  const [loaded, setLoaded] = useState<{
    key: string
    review: CitationReview | null
    error: string | null
  } | null>(null)
  const key = `${project.id}\0${revision}`
  const markets = useMemo(
    () => new Map<string, Market>((project.markets ?? []).map((market) => [market.id, market])),
    [project.markets]
  )

  useEffect(() => {
    let cancelled = false
    source.citations(project.id).then(
      (review) => {
        if (!cancelled) setLoaded({ key, review, error: null })
      },
      (cause: unknown) => {
        if (cancelled) return
        // The review lists are extra: without them the cited pages still show.
        setLoaded({
          key,
          review: null,
          error: errorText(cause, 'Could not load the pages to review.')
        })
      }
    )
    return () => {
      cancelled = true
    }
  }, [source, project.id, key])

  const review = loaded?.key === key ? loaded.review : null
  const reviewError = loaded?.key === key ? loaded.error : null
  // Track, Point it here and Merge keep their row (with its Undo) in place, so
  // nothing reloads after them; the next check refreshes the lists.
  const changed = (): void => undefined

  return (
    <SectionFrame
      title="Citations"
      subtitle="The pages AI answers cite, and whose they are."
      actions={
        <>
          <PinToSummary
            projectId={project.id}
            name="who gets cited"
            spec={{ kind: 'cited-sites', size: 'm' }}
          />
          <AskSparkle target={{ kind: 'section', label: 'Citations' }} questions={ASK} />
        </>
      }
    >
      <DrillHost>
        <div className="cit-screen">
          <ViewTabs
            label="Citations views"
            views={VIEWS}
            value={screenView.view}
            onChange={screenView.setView}
            hrefFor={screenView.hrefFor}
          />
          {reviewError ? (
            <p className="bridge-alert" role="alert">
              {reviewError}
            </p>
          ) : null}
          {review && (review.wrongPage.length > 0 || review.untracked.length > 0) ? (
            // One compact list, a group per kind, each folded when long.
            <NeedsAttention
              source={source}
              projectId={project.id}
              domain={project.domain}
              review={review}
              markets={markets}
              onChanged={changed}
              title="Needs review"
            />
          ) : null}
          {screenView.view === 'pages' ? (
            <CitationPages projectId={project.id} source={cited} />
          ) : (
            <CitedPages
              projectId={project.id}
              brand={project.name}
              markets={markets}
              source={cited}
            />
          )}
        </div>
      </DrillHost>
    </SectionFrame>
  )
}
