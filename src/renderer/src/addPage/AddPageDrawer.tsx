import { useMemo, useState, type JSX } from 'react'
import {
  DEFAULT_INTERVAL_DAYS,
  DEFAULT_MARKET_DEVICE,
  DEFAULT_SAMPLE_COUNT,
  intervalDaysText,
  isIntervalDays,
  isSampleCount,
  QUICK_INTERVAL_DAYS,
  type IntervalDays,
  type SampleCount
} from '@shared/domain'
import type { MarketDraft } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { useBuildTools } from '../buildMenu/buildClient'
import { errorText } from '../components/errorText'
import { AddPageMarkets } from '../projects/AddPageMarkets'
import { nextMarketKey, searchRange, type MarketRow } from '../projects/addPageModel'
import { useScopeOptions } from '../scope'
import { pageHash } from '../shell/routes'
import {
  Drawer,
  DrawerGrid,
  DrawerMain,
  DrawerRail,
  DrawerSection,
  ExpertOptions,
  SegmentedControl,
  useAssistMenu
} from '../ui'
import { createCheckNowSource, type CheckNowSource } from '../checkNow/source'
import { PageSection } from './components/PageSection'
import { QuestionsSection } from './components/QuestionsSection'
import {
  addPageParamsPatch,
  checkedAddress,
  defaultMarketRow,
  MAX_TYPED_QUESTIONS,
  parseAddPageParams,
  pastedAddresses,
  trackedMatch,
  typedQuestions,
  type AddPageState
} from './model'
import { addQuestionsWhenReady } from './pendingQuestions'
import '../projects/AddPageScreen.css'
import '../checkNow/checkNow.css'
import './addPage.css'

const SAMPLE_OPTIONS = [1, 2, 3, 4, 5] as const satisfies readonly SampleCount[]

export interface AddPageDrawerProps {
  projectId: string
  params: Readonly<Record<string, string | undefined>>
  onParams: (patch: Record<string, string | null>) => void
  onClose: () => void
  /** The page was added: refresh the shell's lists, then open it. */
  onAdded: (pageId: string) => void
  source?: CheckNowSource
}

/**
 * Add a page (`?drawer=add-page`, tracking.md §10): the address (or a found
 * page), a label, markets, how it gets its questions and a group to file it
 * in, then Add page or Add and check now. The address, label, group and
 * question choice are on the URL (`addpage.*`); market rows and typed
 * questions are a draft in the drawer.
 */
export function AddPageDrawer({
  projectId,
  params,
  onParams,
  onClose,
  onAdded,
  source: given
}: AddPageDrawerProps): JSX.Element {
  const source = useMemo(() => given ?? createCheckNowSource(), [given])
  const tools = useBuildTools()
  const key = JSON.stringify(params)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const state = useMemo(() => parseAddPageParams(params), [key])
  const { options, error: loadError, reload } = useScopeOptions(projectId, source)
  const defaultMarket = useMemo(
    () =>
      options?.markets.find((market) => market.id === options.defaultMarketId) ??
      options?.markets[0] ??
      null,
    [options]
  )
  const firstRow = useMemo(() => defaultMarketRow(defaultMarket), [defaultMarket])
  const [rows, setRows] = useState<MarketRow[] | null>(null)
  const marketRows = rows ?? [firstRow]
  const [typed, setTyped] = useState('')
  const [intervalDays, setIntervalDays] = useState<IntervalDays>(DEFAULT_INTERVAL_DAYS)
  const [samples, setSamples] = useState<SampleCount>(DEFAULT_SAMPLE_COUNT)
  const [busy, setBusy] = useState<'add' | 'check' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { menu, card } = useAssistMenu({
    label: 'AI actions for markets',
    scope: { projectId, pageId: null },
    actions: [{ assistId: 'markets.suggest', label: 'Suggest markets', seconds: 10 }]
  })

  const lines = typedQuestions(typed)
  const questions = state.way === 'type' ? lines.length : state.count
  const many = pastedAddresses(state.url).length > 1
  const checked = options ? checkedAddress(state.url, options.domain) : null
  const tracked = options && checked?.url ? trackedMatch(checked.url, options.pages) : null
  const problem =
    options === null
      ? 'Loading…'
      : many
        ? 'Add one address, or import them all.'
        : (checked?.problem ??
          (tracked
            ? 'This page is already tracked.'
            : state.way === 'type' && lines.length === 0
              ? 'Type at least one question.'
              : state.way === 'type' && lines.length > MAX_TYPED_QUESTIONS
                ? `At most ${MAX_TYPED_QUESTIONS} questions at a time.`
                : null))
  const range = searchRange(Math.max(questions, 0), marketRows.length, samples)
  const left = options?.searchesLeft ?? null
  const dirty = state.url.trim().length > 0 || typed.trim().length > 0 || state.label.length > 0

  function change(patch: Partial<AddPageState>): void {
    setError(null)
    onParams(addPageParamsPatch(patch))
  }

  function updateRow(rowKey: string, patch: Partial<MarketRow>): void {
    setRows(marketRows.map((row) => (row.key === rowKey ? { ...row, ...patch } : row)))
  }

  async function submit(checkNow: boolean): Promise<void> {
    if (problem !== null || !checked?.url) {
      setError(problem ?? 'Enter the page’s address.')
      return
    }
    setBusy(checkNow ? 'check' : 'add')
    setError(null)
    const markets: MarketDraft[] = marketRows.map((row) => ({
      country: row.country,
      language: row.language,
      location: row.location.trim() ? row.location.trim() : null,
      device: DEFAULT_MARKET_DEVICE,
      localWording: row.localWording
    }))
    try {
      const page = await source['pages:add']({
        projectId,
        url: checked.url,
        markets,
        intervalDays,
        samples,
        promptCount: Math.max(1, questions),
        ...(checkNow ? { checkWhenReady: true } : {})
      })
      const label = state.label.trim()
      const followUps: Promise<unknown>[] = []
      if (label) {
        followUps.push(source['pages:update']({ projectId, pageId: page.id, label }))
      }
      if (state.groupId) {
        followUps.push(
          source['structure:setGroupPages']({
            projectId,
            groupId: state.groupId,
            add: [page.id],
            remove: []
          })
        )
      }
      const settled = await Promise.allSettled(followUps)
      const failed = settled.find((item) => item.status === 'rejected')
      if (state.way === 'type') {
        addQuestionsWhenReady(source, tools.notify, projectId, page.id, lines)
      }
      const name = label || page.title || checked.url
      tools.notify(
        failed
          ? `Added ${name}, but ${errorText(failed.reason, 'its label or group was not saved.')}`
          : checkNow
            ? `Added ${name}. CiteFox reads it, drafts its questions, then checks it (${range} searches).`
            : `Added ${name}. CiteFox reads it and drafts its questions. No searches yet.`,
        failed ? 'bad' : 'ok',
        { label: 'Open the page', href: pageHash(page.id, 'prompts') }
      )
      onAdded(page.id)
    } catch (cause) {
      setError(errorText(cause, 'Could not add that page.'))
      setBusy(null)
    }
  }

  const footerSummary =
    options === null ? (
      'Loading…'
    ) : (
      <span data-testid="add-page-cost">
        Checking uses about {range} searches
        {left === null ? '' : ` · ${left.toLocaleString('en-US')} left this month`} · reading the
        page is free
      </span>
    )

  return (
    <Drawer
      id="add-page"
      title="Add a page"
      subtitle="CiteFox reads the page and drafts its buyer questions without a search. Nothing is searched until a check."
      className="adp-drawer"
      testId="add-page-drawer"
      loading={options === null && loadError === null}
      error={loadError ? { message: loadError, onRetry: reload } : undefined}
      dirty={dirty && busy === null}
      guard={{
        title: 'Discard this page?',
        body: 'The address and choices you made are not added.'
      }}
      closeDisabled={busy !== null}
      busy={busy !== null}
      onClose={onClose}
      footer={{
        summary: footerSummary,
        secondary: {
          label: 'Add page',
          disabled: busy !== null || problem !== null,
          busy: busy === 'add',
          onClick: () => void submit(false),
          testId: 'add-page-add'
        },
        primary: {
          label: 'Add and check now',
          disabled: busy !== null || problem !== null,
          busy: busy === 'check',
          onClick: () => void submit(true),
          testId: 'add-page-check'
        }
      }}
    >
      {options ? (
        <DrawerGrid className="adp-grid">
          <DrawerMain>
            <PageSection
              state={state}
              options={options}
              source={source}
              disabled={busy !== null}
              error={error}
              onChange={change}
            />
            <QuestionsSection
              state={state}
              typed={typed}
              disabled={busy !== null}
              onChange={change}
              onTyped={setTyped}
            />
            <ExpertOptions summary="Re-check every 14 or 30 days; samples per question.">
              <div className="adp-expert">
                <div className="adp-field">
                  <span className="ui-drawer-label" aria-hidden="true">
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
                <label className="adp-field">
                  <span className="ui-drawer-label">Samples per question</span>
                  <select
                    className="ui-input adp-narrow"
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
                </label>
              </div>
            </ExpertOptions>
          </DrawerMain>
          <DrawerRail label="Markets and group">
            <DrawerSection
              title="Markets"
              count={marketRows.length}
              description="Google answers differ by country, language and city."
              actions={menu}
              testId="add-page-markets"
            >
              <AddPageMarkets
                rows={marketRows}
                onChange={updateRow}
                onRemove={(rowKey) => setRows(marketRows.filter((row) => row.key !== rowKey))}
                onAdd={() =>
                  setRows([
                    ...marketRows,
                    { ...defaultMarketRow(defaultMarket), key: nextMarketKey(), location: '' }
                  ])
                }
              />
              {card}
            </DrawerSection>
            <DrawerSection
              title="Group"
              description="Optional. File the page in one of your groups."
              testId="add-page-group"
            >
              {options.groups.length === 0 ? (
                <p className="ui-drawer-hint">No groups yet. Make groups in Site structure.</p>
              ) : (
                <label className="adp-field">
                  <span className="ui-drawer-label">Add to group</span>
                  <select
                    className="ui-input"
                    value={state.groupId ?? ''}
                    disabled={busy !== null}
                    onChange={(event) => change({ groupId: event.target.value || null })}
                  >
                    <option value="">No group</option>
                    {options.groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name} ({pluralize(group.count, 'page')})
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </DrawerSection>
          </DrawerRail>
        </DrawerGrid>
      ) : null}
    </Drawer>
  )
}
