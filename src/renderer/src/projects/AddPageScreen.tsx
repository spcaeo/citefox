import { useId, useMemo, useState, type FormEvent, type JSX } from 'react'
import {
  DEFAULT_INTERVAL_DAYS,
  DEFAULT_MARKET_DEVICE,
  DEFAULT_PROMPT_COUNT,
  DEFAULT_SAMPLE_COUNT,
  intervalDaysText,
  isIntervalDays,
  isSampleCount,
  QUICK_INTERVAL_DAYS,
  type IntervalDays,
  type SampleCount
} from '@shared/domain'
import type { MarketDraft, ProjectDetail } from '@shared/ipc'
import type { AssistClient } from '../assist/client'
import { errorText } from '../components/errorText'
import { ScreenHeader } from '../components/Header'
import { landingHash, navigateHash, sectionHash } from '../shell/routes'
import {
  EmptyState,
  LinkButton,
  Panel,
  RightRail,
  SegmentedControl,
  WizardFooter,
  useAssistMenu
} from '../ui'
import { AddPageMarkets } from './AddPageMarkets'
import { addressOf, nextMarketKey, searchRange, type MarketRow } from './addPageModel'
import { UrlCombobox } from './UrlCombobox'
import { checkSearchEstimate, monthlyCheckEstimate } from './copy'
import type { ShellClient } from './client'
import './AddPageScreen.css'

const SAMPLE_OPTIONS = [1, 2, 3, 4, 5] as const satisfies readonly SampleCount[]

export interface AddPageUrlFlowProps {
  client: ShellClient
  /** The open project. Null shows "create a project first". */
  project: ProjectDetail | null
  /** Called with the new page's id once it is saved; the caller opens Page read. */
  onAdded: (pageId: string) => void
  /**
   * Shows Back in the footer (the "What do you want to track?" chooser passes
   * it). Without it the footer shows Cancel, back to All pages.
   */
  onBack?: () => void
  /** Tests only. Production picks the assist client from the client mode. */
  assistClient?: AssistClient
}

/**
 * The "A page URL" path of Add (FR-1.6, Mockups/AddPage.dc.html in the v2
 * wizard look): the page address, its markets, the re-check cadence, samples
 * and prompt count, with the search estimate in the footer. Saving the page
 * starts Page read; nothing is searched until the first check.
 */
export function AddPageUrlFlow({
  client,
  project,
  onAdded,
  onBack,
  assistClient
}: AddPageUrlFlowProps): JSX.Element {
  const urlId = useId()
  const hintId = useId()
  const promptsId = useId()
  const samplesId = useId()
  const defaultMarket = project?.defaultMarket
  const [url, setUrl] = useState('')
  const [rows, setRows] = useState<MarketRow[]>(() => [
    {
      key: nextMarketKey(),
      country: defaultMarket?.country ?? 'US',
      language: defaultMarket?.language ?? 'en',
      location: defaultMarket?.location ?? '',
      localWording: defaultMarket?.localWording ?? false
    }
  ])
  const [intervalDays, setIntervalDays] = useState<IntervalDays>(DEFAULT_INTERVAL_DAYS)
  const [samples, setSamples] = useState<SampleCount>(DEFAULT_SAMPLE_COUNT)
  const [promptCount, setPromptCount] = useState(String(DEFAULT_PROMPT_COUNT))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const prompts = Number(promptCount)
  const promptOk = Number.isInteger(prompts) && prompts >= 1
  const shownPrompts = promptOk ? prompts : 0
  const projectId = project?.id ?? null
  const suggest = useMemo(() => {
    const suggestUrls = client.suggestUrls?.bind(client)
    if (!suggestUrls || projectId === null) return undefined
    return (query: string) => suggestUrls({ projectId, query, limit: 8 })
  }, [client, projectId])
  const { menu, card } = useAssistMenu({
    label: 'AI actions for markets',
    scope: { projectId: project?.id ?? null, pageId: null, client: assistClient },
    actions: [{ assistId: 'markets.suggest', label: 'Suggest markets', seconds: 10 }]
  })

  function updateRow(key: string, patch: Partial<MarketRow>): void {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  function back(): void {
    if (onBack) onBack()
    else navigateHash(landingHash())
  }

  async function submit(): Promise<void> {
    setError(null)
    if (!project) {
      setError('Create a project before adding a page.')
      return
    }
    let parsed: URL
    try {
      parsed = new URL(addressOf(url, project.domain))
    } catch {
      setError('Enter the page’s public http or https address.')
      return
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      setError('Enter the page’s public http or https address.')
      return
    }
    if (!promptOk) {
      setError('Enter a whole number of buyer questions.')
      return
    }
    const markets: MarketDraft[] = rows.map((row) => ({
      country: row.country,
      language: row.language,
      location: row.location.trim() ? row.location.trim() : null,
      device: DEFAULT_MARKET_DEVICE,
      localWording: row.localWording
    }))
    setBusy(true)
    try {
      const page = await client.addPage({
        projectId: project.id,
        url: parsed.toString(),
        markets,
        intervalDays,
        samples,
        promptCount: prompts
      })
      onAdded(page.id)
    } catch (cause) {
      setError(errorText(cause, 'Could not add that page.'))
      setBusy(false)
    }
  }

  function onSubmit(event: FormEvent): void {
    event.preventDefault()
    void submit()
  }

  return (
    <div className="ap2">
      <ScreenHeader
        nav={{
          back: onBack
            ? { href: sectionHash('add'), label: 'Add' }
            : { href: landingHash(), label: project?.name ?? 'All pages' }
        }}
        title="Add a page to track"
        subtitle={
          <p className="section-subtitle">
            Add the address. CiteFox reads the page and drafts the buyer profile, questions and
            content gaps without a search; you review them, then start the first check.
          </p>
        }
      />
      {!project ? (
        <Panel label="No project">
          <EmptyState
            title="Create a project before adding a page."
            action={
              <LinkButton href={sectionHash('new-project')} size="sm">
                New project
              </LinkButton>
            }
          />
        </Panel>
      ) : (
        <form className="ap2-layout" aria-label="New page" onSubmit={onSubmit} noValidate>
          {/* Enter in a field submits; the visible Add page is in the footer. */}
          <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
          <div className="ap2-main">
            <Panel title="Page">
              <div className="ap2-field">
                <label className="ap2-label" htmlFor={urlId}>
                  Page URL
                </label>
                <UrlCombobox
                  id={urlId}
                  value={url}
                  onChange={setUrl}
                  placeholder={`Type a path, such as /pricing, or paste a ${project.domain} address`}
                  describedBy={hintId}
                  {...(suggest ? { suggest } : {})}
                />
                <span className="ap2-hint" id={hintId}>
                  Pick a page from your sitemap or paste its public address. Other {project.domain}{' '}
                  links count as another page of this project.
                </span>
              </div>
            </Panel>
            <Panel
              title="Markets"
              actions={
                <>
                  <span className="ap2-count num">
                    {rows.length === 1 ? '1 market' : `${rows.length} markets`}
                  </span>
                  {menu}
                </>
              }
            >
              <p className="ap2-hint ap2-lead">
                Google answers differ by country, language and city. Each market is checked on its
                own.
              </p>
              <AddPageMarkets
                rows={rows}
                onChange={updateRow}
                onRemove={(key) => setRows((current) => current.filter((row) => row.key !== key))}
                onAdd={() =>
                  setRows((current) => [
                    ...current,
                    {
                      key: nextMarketKey(),
                      country: defaultMarket?.country ?? 'US',
                      language: defaultMarket?.language ?? 'en',
                      location: '',
                      localWording: false
                    }
                  ])
                }
              />
              {card}
            </Panel>
            <Panel title="Checks">
              <div className="ap2-checks">
                <div className="ap2-field">
                  <span className="ap2-label" aria-hidden="true">
                    Re-check every
                  </span>
                  <SegmentedControl
                    label="Re-check every"
                    value={String(intervalDays)}
                    options={QUICK_INTERVAL_DAYS.map((days) => ({
                      value: String(days),
                      label: intervalDaysText(days)
                    }))}
                    onChange={(value) => {
                      const days = Number(value)
                      if (isIntervalDays(days)) setIntervalDays(days)
                    }}
                  />
                </div>
                <label className="ap2-field" htmlFor={samplesId}>
                  <span className="ap2-label">Samples per question</span>
                  <select
                    id={samplesId}
                    className="ui-input ap2-narrow"
                    value={samples}
                    onChange={(event) => {
                      const value = Number(event.target.value)
                      if (isSampleCount(value)) setSamples(value)
                    }}
                  >
                    {SAMPLE_OPTIONS.map((count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    ))}
                  </select>
                  <span className="ap2-hint">
                    AI Overviews vary between searches. Each sample repeats every search.
                  </span>
                </label>
                <label className="ap2-field" htmlFor={promptsId}>
                  <span className="ap2-label">Number of buyer questions</span>
                  <input
                    id={promptsId}
                    className="ui-input mono ap2-narrow"
                    type="number"
                    min={1}
                    value={promptCount}
                    onChange={(event) => setPromptCount(event.target.value)}
                  />
                  <span className="ap2-hint">
                    CiteFox AI writes this many from the page by itself. You review them first.
                  </span>
                </label>
              </div>
            </Panel>
            {error ? (
              <p className="ap2-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <RightRail label="Cost">
            <Panel title="What each check costs" titleAs="h2">
              <dl className="ap2-cost">
                <div>
                  <dt>Searches per check</dt>
                  <dd className="num">{searchRange(shownPrompts, rows.length, samples)}</dd>
                </div>
                <div>
                  <dt>Questions × markets × samples</dt>
                  <dd className="num">
                    {shownPrompts} × {rows.length} × {samples}
                  </dd>
                </div>
              </dl>
              <p className="ap2-hint">{checkSearchEstimate(shownPrompts, rows.length, samples)}</p>
              <p className="ap2-hint" role="region" aria-label="Cost estimate">
                {monthlyCheckEstimate(shownPrompts, rows.length, samples, intervalDays)} CiteFox AI
                usage is not included.
              </p>
              <p className="ap2-hint">
                Reading the page is free. Searches are only used when you run a check.
              </p>
            </Panel>
          </RightRail>
        </form>
      )}
      {project ? (
        <WizardFooter
          onBack={back}
          backLabel={onBack ? 'Back' : 'Cancel'}
          note={`Setup is automatic and uses no searches · each check: ${searchRange(shownPrompts, rows.length, samples)} searches`}
          primary={{
            label: 'Add page',
            onClick: () => void submit(),
            busy,
            disabled: busy
          }}
        />
      ) : null}
    </div>
  )
}

/** The Add page route (`#/add-page`): the page URL flow on its own. */
export function AddPageScreen(props: AddPageUrlFlowProps): JSX.Element {
  return <AddPageUrlFlow {...props} />
}
