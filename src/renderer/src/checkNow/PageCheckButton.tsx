import { useMemo, useRef, useState, type JSX } from 'react'
import { SEARCHES_PER_PROMPT_MAX, type Market, type SampleCount } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { useBuildTools } from '../buildMenu/buildClient'
import { errorText } from '../components/errorText'
import { marketLabel } from '../shell/model'
import { openDrawer } from '../shell/drawers'
import { navigateHash } from '../shell/routes'
import { estimateText } from '../scope'
import { RESULTS_SELECTION_KEY } from '../m3/results/tabs'
import { Button, buttonClass, LinkButton, MenuButton, UiIcon, type MenuItem } from '../ui'
import { useQueryList } from '../utils/queryState'
import { pageCheckValues } from './model'
import { runCheck } from './run'
import { createCheckNowSource, type CheckNowSource } from './source'
import './checkNow.css'

export interface PageCheckButtonProps {
  projectId: string
  pageId: string
  kind: 'page' | 'topic'
  /** The market picked in the header. */
  marketId: string
  markets: readonly Market[]
  samples: SampleCount
  /** Today's Check now: the page's check screen (every market). */
  href: string
  /** Primary until the first check (then the review screen has the one primary). */
  primary: boolean
  source?: CheckNowSource
}

interface Counts {
  /** Enabled questions. */
  questions: number
  /** Questions not cited last time in the header's market (any market when it has none). */
  notCited: readonly string[]
  /** The markets those were missed in. */
  notCitedMarkets: readonly string[]
  checked: boolean
  /** The header market these were read for. */
  marketId: string
}

/** "About 4–8 searches" for questions × markets × samples. */
function cost(questions: number, markets: number, samples: number): string {
  const min = questions * markets * samples
  return estimateText({ min, max: min * SEARCHES_PER_PROMPT_MAX, pages: 1 })
}

/**
 * The page header's "Check now ▾" (page.md §2d): the button keeps today's
 * behaviour (the page's check screen, every market), or, with rows ticked on
 * the Results grid (`?sel=`), opens Check now on exactly those questions in
 * the header's market; the menu checks this
 * market only, only the questions not cited last time in this market, or questions you pick,
 * each with its cost, or opens Check now on this page. The costs load when
 * the menu opens (`prompts:list`, `checks:notCited`).
 */
export function PageCheckButton({
  projectId,
  pageId,
  kind,
  marketId,
  markets,
  samples,
  href,
  primary,
  source: given
}: PageCheckButtonProps): JSX.Element {
  const source = useMemo(() => given ?? createCheckNowSource(), [given])
  const tools = useBuildTools()
  const [loaded, setLoaded] = useState<Counts | null>(null)
  // Read for another header market: read again when the menu opens.
  const counts = loaded?.marketId === marketId ? loaded : null
  const [error, setError] = useState<string | null>(null)
  const loading = useRef(false)
  const market = markets.find((item) => item.id === marketId) ?? null
  // Rows ticked on the Results grid (`?sel=`): Check now opens on exactly those questions.
  const [selected] = useQueryList(RESULTS_SELECTION_KEY)
  const selectedValues = (): Record<string, string | null> =>
    pageCheckValues(pageId, kind, {
      only: 'picked',
      prompts: [...selected],
      ...(market ? { markets: [marketId] } : {})
    })

  function load(): void {
    if (loading.current) return
    loading.current = true
    setError(null)
    Promise.all([
      source['prompts:list']({ projectId, pageId }),
      source['checks:notCited']({
        projectId,
        pageIds: [pageId],
        // Scoped to the market picked in the header: the other markets' misses stay out.
        marketIds: market ? [marketId] : null
      })
    ]).then(
      ([view, list]) => {
        const page = list.pages.find((item) => item.pageId === pageId)
        setLoaded({
          marketId,
          questions: view.prompts.filter((prompt) => prompt.enabled).length,
          notCited: page?.promptIds ?? [],
          notCitedMarkets: (page?.markets ?? []).map((item) => item.marketId),
          checked: page?.checked ?? false
        })
        loading.current = false
      },
      (cause: unknown) => {
        setError(errorText(cause, 'Could not read the questions.'))
        loading.current = false
      }
    )
  }

  function start(marketIds: string[] | null, promptIds: string[] | null, questions: number): void {
    const min = questions * (marketIds?.length ?? markets.length) * samples
    runCheck(source, tools.notify, projectId, {
      pageIds: [pageId],
      marketIds,
      promptIds,
      estimate: { min, max: min * SEARCHES_PER_PROMPT_MAX, pages: 1 }
    })
    navigateHash(href)
  }

  const pending = counts === null ? (error ?? 'Working out the cost…') : null
  const items: MenuItem[] = [
    ...(selected.length > 0
      ? [
          {
            id: 'selected',
            label: `Only the ${pluralize(selected.length, 'selected question')}`,
            hint: market ? `In ${marketLabel(market)} · pick in Check now` : 'Pick in Check now',
            onSelect: () => openDrawer('check-now', selectedValues())
          } satisfies MenuItem
        ]
      : []),
    {
      id: 'all',
      label: 'All markets',
      hint: pending ?? cost(counts?.questions ?? 0, markets.length, samples),
      onSelect: () => navigateHash(href)
    },
    {
      id: 'market',
      label: market ? `This market (${marketLabel(market)})` : 'This market',
      hint: pending ?? cost(counts?.questions ?? 0, 1, samples),
      disabled: market === null || markets.length < 2 || counts === null || counts.questions === 0,
      onSelect: () => start([marketId], null, counts?.questions ?? 0)
    },
    {
      id: 'notcited',
      label: market
        ? `Only not cited last time (${marketLabel(market)})`
        : 'Only not cited last time',
      hint:
        pending ??
        (counts && !counts.checked
          ? 'No check yet'
          : counts && counts.notCited.length === 0
            ? 'All cited last time'
            : cost(counts?.notCited.length ?? 0, counts?.notCitedMarkets.length ?? 1, samples)),
      disabled: counts === null || counts.notCited.length === 0,
      onSelect: () =>
        start(
          counts ? [...counts.notCitedMarkets] : null,
          [...(counts?.notCited ?? [])],
          counts?.notCited.length ?? 0
        )
    },
    {
      id: 'picked',
      label: 'Only questions I pick…',
      hint: 'Pick in Check now',
      onSelect: () => openDrawer('check-now', pageCheckValues(pageId, kind, { only: 'picked' }))
    },
    {
      id: 'choose',
      label: 'Choose what to check…',
      groupStart: true,
      onSelect: () => openDrawer('check-now', pageCheckValues(pageId, kind))
    }
  ]

  return (
    <span className="cn2-split" data-testid="page-check-split">
      {selected.length > 0 ? (
        <Button
          variant={primary ? 'primary' : 'secondary'}
          onClick={() => openDrawer('check-now', selectedValues())}
          data-testid="page-check-selected"
        >
          Check {pluralize(selected.length, 'selected question')}
        </Button>
      ) : (
        <LinkButton href={href} variant={primary ? 'primary' : 'secondary'}>
          Check now
        </LinkButton>
      )}
      <MenuButton
        label="More ways to check this page"
        items={items}
        width={340}
        onOpenChange={(open) => {
          if (open && counts === null) load()
        }}
        footer="Searches come from your search plan. Nothing runs until you pick."
        trigger={(props) => (
          <button
            {...props}
            type="button"
            aria-label="More ways to check this page"
            // The fox fill comes from cn2-split-toggle-primary, so the screen keeps one primary.
            className={buttonClass(
              'secondary',
              'md',
              primary ? 'cn2-split-toggle cn2-split-toggle-primary' : 'cn2-split-toggle'
            )}
          >
            <UiIcon name="chevron-down" size={16} />
          </button>
        )}
      />
    </span>
  )
}
