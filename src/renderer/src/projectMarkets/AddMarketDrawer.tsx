import { useEffect, useMemo, useState, type JSX } from 'react'
import type { MarketDevice } from '@shared/domain'
import type { ProjectMarketsView } from '@shared/ipc'
import { errorText } from '../components/errorText'
import { countryOptionsFor } from '../onboarding/markets'
import { DEVICE_OPTIONS } from '../projectSettings/constants'
import { marketLabel } from '../shell/model'
import {
  Drawer,
  DrawerField,
  DrawerFields,
  DrawerGrid,
  DrawerMain,
  DrawerRail,
  DrawerSection,
  showUndo,
  type HelpFillBot,
  type HelpFillSource,
  type HelpFillUrlState,
  type HelpFillWay
} from '../ui'
import { MarketHelp } from './MarketHelp'
import { languageOptionsWith, type MarketPick } from './marketPicks'
import {
  addedSearches,
  countText,
  draftFromMarketForm,
  draftOf,
  findMarket,
  isTrackedMarket,
  pagesIn,
  pagesText,
  trackedCountries,
  untrackedDefault,
  type MarketForm
} from './model'
import type { ProjectMarketsSource } from './source'
import '../pageSettings/page-settings.css'

export interface AddMarketDrawerProps {
  source: ProjectMarketsSource
  projectId: string
  /** Opened from one page (`am.page`): that page is picked. Null: every page. */
  pageId: string | null
  /** Closes the drawer; `marketId` is the added market, for a picker that opened it. */
  onClose: (marketId?: string) => void
  /** ✦ Help me fill this: way and bot on the drawer's URL. Absent: kept here (tests). */
  help?: HelpFillUrlState
  /** Tests only: the helper's channels. */
  helpSource?: HelpFillSource
}

type Scope = 'all' | 'pick'

/**
 * Add market (deep audit setup S5.2): country, language, city and device, then
 * which pages and topics are checked in it, with what it adds to each check. It
 * starts on a country the project does not track yet. Window-wide on the URL as
 * `drawer=add-market` (`am.page` for one page); it hands the market id back.
 */
export function AddMarketDrawer({
  source,
  projectId,
  pageId,
  onClose,
  help: helpUrl,
  helpSource
}: AddMarketDrawerProps): JSX.Element {
  const [view, setView] = useState<ProjectMarketsView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [form, setForm] = useState<MarketForm | null>(null)
  const [scope, setScope] = useState<Scope>(pageId ? 'pick' : 'all')
  const [picked, setPicked] = useState<readonly string[]>(pageId ? [pageId] : [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inForm, setInForm] = useState<string | null>(null)
  const [localWay, setLocalWay] = useState<HelpFillWay | null>(null)
  const [localBot, setLocalBot] = useState<HelpFillBot | null>(null)
  const help: HelpFillUrlState = helpUrl ?? {
    way: localWay,
    onWay: setLocalWay,
    bot: localBot,
    onBot: setLocalBot
  }

  useEffect(() => {
    let cancelled = false
    void Promise.resolve()
      .then(() => source['projectSettings:markets']({ projectId }))
      .then(
        (next) => {
          if (cancelled) return
          setView(next)
          setLoadError(null)
          setForm((current) => {
            if (current) return current
            // Start on a market the page (or the project) does not have yet.
            const scopeMarkets = pageId
              ? next.markets.filter((market) =>
                  next.pages.find((page) => page.id === pageId)?.marketIds.includes(market.id)
                )
              : next.markets
            const start = untrackedDefault(scopeMarkets)
            return { ...start, city: '', device: 'desktop' }
          })
        },
        (cause: unknown) => {
          if (!cancelled) setLoadError(errorText(cause, 'Could not load the markets.'))
        }
      )
    return () => {
      cancelled = true
    }
  }, [source, projectId, pageId, attempt])

  const targets = useMemo(() => {
    if (!view) return []
    return scope === 'all' ? view.pages : view.pages.filter((page) => picked.includes(page.id))
  }, [view, scope, picked])

  const draft = form ? draftFromMarketForm(form) : null
  const existing = view && draft ? findMarket(view, draft) : null
  const added = addedSearches(targets, existing?.id ?? null)
  const allHaveIt = targets.length > 0 && added.pages === 0
  const tracked = view ? trackedCountries(view.markets) : new Set<string>()
  const dirty = form !== null && (form.city.trim().length > 0 || picked.length > (pageId ? 1 : 0))

  function patch(next: Partial<MarketForm>): void {
    setForm((current) => (current ? { ...current, ...next } : current))
    setError(null)
    setInForm(null)
  }

  /** A suggested market fills the form; the footer's button still adds it. */
  function applyPick(pick: MarketPick): void {
    patch({ country: pick.country, language: pick.language, city: pick.city })
    setInForm(pick.id)
  }

  async function add(): Promise<void> {
    if (!view || !draft || targets.length === 0 || allHaveIt) return
    setBusy(true)
    setError(null)
    const before = view
    try {
      const result = await source['projectSettings:addMarket']({
        projectId,
        market: draft,
        pageIds: targets.map((page) => page.id)
      })
      const label = marketLabel(draft)
      const addedPages = before.pages.filter((page) => result.added.includes(page.id))
      showUndo({
        message: `Added ${label} to ${pagesText(addedPages)}.`,
        effect: 'Its baseline starts on its first check.',
        undo: async () => {
          for (const page of addedPages) {
            const markets = page.marketIds
              .map((id) => before.markets.find((market) => market.id === id))
              .filter((market) => market !== undefined)
              .map(draftOf)
            await source['pages:update']({ projectId, pageId: page.id, markets })
          }
        }
      })
      onClose(result.marketId)
    } catch (cause) {
      setError(errorText(cause, 'Could not add the market.'))
    } finally {
      setBusy(false)
    }
  }

  const countries = form ? countryOptionsFor(form.country) : []
  const summary =
    targets.length === 0
      ? 'Pick at least one page or topic.'
      : allHaveIt
        ? `Every picked ${targets.length === 1 ? 'one already has' : 'page already has'} this market.`
        : `Adds ${countText(added.pages, 'page', 'pages')} · about ${added.min.toLocaleString('en-US')}–${added.max.toLocaleString('en-US')} searches per check`

  return (
    <Drawer
      id="add-market"
      title="Add market"
      subtitle="A country, language and device Google is searched in. Each market is scored on its own."
      dirty={dirty}
      busy={busy}
      closeDisabled={busy}
      loading={view === null && loadError === null}
      error={
        loadError ? { message: loadError, onRetry: () => setAttempt((n) => n + 1) } : undefined
      }
      onClose={() => onClose()}
      testId="add-market-drawer"
      footer={{
        summary: error ? (
          <span className="pset-error" role="alert">
            {error}
          </span>
        ) : (
          <span data-testid="add-market-summary">{summary}</span>
        ),
        primary: {
          label: 'Add market',
          onClick: () => void add(),
          busy,
          disabled: busy || targets.length === 0 || allHaveIt || form === null
        }
      }}
    >
      {view && form ? (
        <DrawerGrid>
          <DrawerMain>
            <DrawerSection
              title="Market"
              description="Starts on a country you do not track yet. Tracked ones are marked."
            >
              <DrawerFields columns={2}>
                <DrawerField label="Country">
                  {({ id, describedBy }) => (
                    <select
                      id={id}
                      aria-describedby={describedBy}
                      className="ui-input"
                      value={form.country}
                      onChange={(event) => patch({ country: event.target.value })}
                      data-autofocus
                    >
                      {countries.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                          {tracked.has(option.value) ? ' (tracked)' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </DrawerField>
                <DrawerField label="Language">
                  {({ id, describedBy }) => (
                    <select
                      id={id}
                      aria-describedby={describedBy}
                      className="ui-input"
                      value={form.language}
                      onChange={(event) => patch({ language: event.target.value })}
                    >
                      {languageOptionsWith(form.language).map((option) => {
                        const taken = isTrackedMarket(
                          {
                            country: form.country,
                            language: option.value,
                            location: form.city.trim() || null,
                            device: form.device
                          },
                          view.markets
                        )
                        return (
                          <option key={option.value} value={option.value}>
                            {option.label}
                            {taken ? ' (tracked)' : ''}
                          </option>
                        )
                      })}
                    </select>
                  )}
                </DrawerField>
                <DrawerField label="City" hint="Optional. Empty searches the whole country.">
                  {({ id, describedBy }) => (
                    <input
                      id={id}
                      aria-describedby={describedBy}
                      className="ui-input"
                      value={form.city}
                      placeholder="e.g. Toronto"
                      onChange={(event) => patch({ city: event.target.value })}
                    />
                  )}
                </DrawerField>
                <DrawerField label="Device">
                  {({ id, describedBy }) => (
                    <select
                      id={id}
                      aria-describedby={describedBy}
                      className="ui-input"
                      value={form.device}
                      onChange={(event) => patch({ device: event.target.value as MarketDevice })}
                    >
                      {DEVICE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  )}
                </DrawerField>
              </DrawerFields>
              {existing ? (
                <p className="pset-cost" data-testid="add-market-existing">
                  {marketLabel(existing)} is already tracked on{' '}
                  {pagesText(pagesIn(view, existing.id))}. Adding it here keeps their history.
                </p>
              ) : null}
            </DrawerSection>
            <DrawerSection
              title="Help me fill this"
              description="Suggests markets you don't track yet. Use one to fill the form above."
              testId="add-market-help"
            >
              <MarketHelp
                projectId={projectId}
                pageId={pageId}
                {...help}
                picked={inForm}
                onUse={applyPick}
                fallbackLanguage={form.language}
                disabled={busy}
                {...(helpSource ? { source: helpSource } : {})}
              />
            </DrawerSection>
            <DrawerSection
              title="Check it on"
              count={targets.length}
              description="Pages and topics that already have the market are left as they are."
            >
              <fieldset className="pset-markets">
                <legend className="sr-only">Check it on</legend>
                <label className="pset-market">
                  <input
                    type="radio"
                    name="am-scope"
                    checked={scope === 'all'}
                    onChange={() => setScope('all')}
                  />
                  <span>All pages and topics ({pagesText(view.pages)})</span>
                </label>
                <label className="pset-market">
                  <input
                    type="radio"
                    name="am-scope"
                    checked={scope === 'pick'}
                    onChange={() => setScope('pick')}
                  />
                  <span>Pages I pick</span>
                </label>
              </fieldset>
              {scope === 'pick' ? (
                <ul className="am-pages" aria-label="Pages and topics">
                  {view.pages.map((page) => {
                    const has = existing !== null && page.marketIds.includes(existing.id)
                    return (
                      <li key={page.id}>
                        <label className="am-page">
                          <input
                            type="checkbox"
                            checked={picked.includes(page.id)}
                            onChange={(event) =>
                              setPicked((current) =>
                                event.target.checked
                                  ? [...current, page.id]
                                  : current.filter((id) => id !== page.id)
                              )
                            }
                          />
                          <span className="am-page-name">{page.name}</span>
                          <span className="am-page-meta">
                            {page.kind === 'topic' ? 'Topic · ' : ''}
                            {has ? 'has it' : countText(page.marketIds.length, 'market', 'markets')}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </DrawerSection>
          </DrawerMain>
          <DrawerRail label="What this adds">
            <DrawerSection title="What it costs">
              <p className="pset-note num" data-testid="add-market-cost">
                {added.pages === 0
                  ? 'Nothing new to check.'
                  : `About ${added.min.toLocaleString('en-US')}–${added.max.toLocaleString('en-US')} more searches per check, across ${countText(added.pages, 'page', 'pages')}.`}
              </p>
              {view.searchesLeft !== null ? (
                <p className="pset-note num">
                  {view.searchesLeft.toLocaleString('en-US')} searches left this month.
                </p>
              ) : null}
            </DrawerSection>
            <DrawerSection title="What happens next">
              <p className="pset-note">
                The market gets its own baseline on its first check. Existing markets and their
                history stay as they are.
              </p>
            </DrawerSection>
          </DrawerRail>
        </DrawerGrid>
      ) : null}
    </Drawer>
  )
}
