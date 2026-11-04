import { useCallback, useMemo, useState, type JSX, type ReactNode } from 'react'
import { isTopicStage, TOPIC_STAGE_LABEL, type IntervalDays, type TopicStage } from '@shared/domain'
import type { HelpFillBot, HelpFillWay } from '@shared/helpfill'
import type { ImportCommitResult, ImportRow, QuestionTarget } from '@shared/ipc'
import { pluralize, questionsAndKeywords } from '@shared/pluralize'
import { useAiContext } from '../assistant/context/useAiContext'
import { useBuildTools, type BuildTools } from '../buildMenu/buildClient'
import { errorText } from '../components/errorText'
import { handFile } from '../importFlow/handoff'
import { checkError, checkStartMessage } from '../m3/source'
import { Drawer } from '../ui'
import { formatClock, formatMoment } from '../utils/dates'
import { BulkBar, ExpertPanel } from './components/BulkBar'
import { ImportBanner } from './components/ImportBanner'
import { QuestionRail } from './components/QuestionRail'
import { RowsGrid } from './components/RowsGrid'
import { SourceTabs } from './components/SourceTabs'
import { HelpTab } from './components/HelpTab'
import { MatchPanel } from './components/MatchPanel'
import { TrackedTab } from './components/TrackedTab'
import { useAddQuestions } from './hooks/useAddQuestions'
import { useHelpRows } from './hooks/useHelpRows'
import { useQuestionsDraft } from './hooks/useQuestionsDraft'
import { useSeenOnGoogle } from './hooks/useSeenOnGoogle'
import { useSuggestions } from './hooks/useSuggestions'
import { useTargets } from './hooks/useTargets'
import { createAddQuestionsSource, type AddQuestionsSource } from './source'
import {
  panelId,
  tabId,
  type AddTab,
  type DraftRow,
  type Suggestion,
  type TargetKind
} from './types'
import { addedText, checkNowProblem, costText, nextCheckLabel, questionsHash } from './utils/copy'
import { pageOptions, siteOf, targetMarkets } from './utils/targets'
import { stageCounts, thinStages } from './utils/rows'
import './addQuestions.css'

const TAB_HINT: Readonly<Record<AddTab, string>> = {
  type: 'Paste rows from Sheets or Excel: we split the columns.',
  import: 'CSV or Excel. You match the columns and check every row first.',
  suggest: 'Describe it for CiteFox AI, or use your own ChatGPT for free.',
  tracked: 'Copy questions another page or topic already tracks.'
}

export interface AddQuestionsDialogProps {
  projectId: string
  /** The page or topic to preselect (`topic=`, `page=` or the older `target=`). */
  targetId?: string | null
  /** Which kind the URL named, so an empty pick starts on topics or pages. */
  kindHint?: TargetKind | null
  tab?: AddTab
  onTab?: (tab: AddTab) => void
  /** ✦ Help me write: the way (`help=`) and the chatbot (`bot=`) on the drawer's URL. */
  help?: HelpFillWay | null
  bot?: HelpFillBot | null
  onHelp?: (way: HelpFillWay) => void
  onBot?: (bot: HelpFillBot) => void
  /**
   * ✦ Match pages (topics): open or not (`match=1`), its way (`mhelp=`) and chatbot
   * (`mbot=`) on the drawer's URL.
   */
  match?: MatchUrl
  /** Opens a chatbot link. Default: the app's safe path. Tests pass a spy. */
  openLink?: (url: string) => void
  /** Another page or topic picked in the rail (kept on the URL). */
  onTarget?: (id: string, kind: TargetKind) => void
  onClose: () => void
  /** "+ New topic": opens New topic over this drawer; the new topic comes back picked. */
  onNewTopic?: (receive: (topicId: string) => void) => void
  /** Import a file, stacked over this drawer; its checked rows come back into the grid. */
  onImport?: (receive: (rows: readonly ImportRow[]) => void) => void
  /** "+ Add a page", stacked; the new page comes back as the default page to be cited. */
  onAddPage?: (receive: (url: string) => void) => void
  source?: AddQuestionsSource
  /** "Today" for the next-check label. Tests pin it. */
  now?: () => Date
}

/** ✦ Match pages on the drawer's URL. */
export interface MatchUrl {
  open: boolean
  way: HelpFillWay | null
  bot: HelpFillBot | null
  onOpen: (open: boolean) => void
  onWay: (way: HelpFillWay) => void
  onBot: (bot: HelpFillBot) => void
}

/**
 * + Add → Questions (AddQuestions.dc.html) in the shared Drawer
 * (`?drawer=add-questions&topic=…&tab=…`). Rows, not one-per-line text: each
 * question has its own stage and page to be cited, and every row is checked as
 * it is typed against everything tracked. Four ways in (type or paste, import a
 * file, ✦ Help me write, copy tracked questions), the topic and its default
 * page in the rail (both can be created here), then add to the next check or
 * add and check just these now. An add is one batch with Undo.
 */
export function AddQuestionsDialog({
  projectId,
  targetId = null,
  kindHint = null,
  tab = 'type',
  onTab,
  help = null,
  bot = null,
  onHelp,
  onBot,
  match,
  openLink,
  onTarget,
  onClose,
  onNewTopic,
  onImport,
  onAddPage,
  source: given,
  now = () => new Date()
}: AddQuestionsDialogProps): JSX.Element {
  const source = useMemo(() => given ?? createAddQuestionsSource(), [given])
  const tools = useBuildTools()
  const [reload, setReload] = useState(0)
  const [picked, setPicked] = useState<string | null>(null)
  const wanted = picked ?? targetId
  const targets = useTargets(source, projectId, wanted, kindHint, reload)
  const { data, target, kind } = targets
  const [state, actions] = useAddQuestions(source, projectId, target, kind)
  const draft = useQuestionsDraft(source, projectId, {
    targetId: target?.id ?? null,
    defaultPage: state.defaultPage,
    rows: state.rows
  })
  // Added or discarded: the draft kept in main goes too (an unanswered offer stays).
  const close = useCallback(() => {
    draft.clear()
    onClose()
  }, [draft, onClose])
  const [drafted, draftedActions] = useHelpRows(target)
  const [gaps, gapActions] = useSuggestions(source, projectId, target)
  const seen = useSeenOnGoogle(source, projectId, target, tab === 'suggest')
  const [showAll, setShowAll] = useState(false)
  const [expert, setExpert] = useState(false)
  const [showMarket, setShowMarket] = useState(false)
  const [showTags, setShowTags] = useState(false)
  const [intervalPick, setIntervalPick] = useState<IntervalDays | null>(null)
  const [intervalError, setIntervalError] = useState<string | null>(null)
  const intervalDays = intervalPick ?? target?.intervalDays ?? null

  const markets = useMemo(() => targetMarkets(data, target), [data, target])
  const pages = useMemo(() => pageOptions(data), [data])
  const takers = useMemo(
    () =>
      data?.targets.filter((item) => item.status === 'tracked' || item.status === 'paused') ?? [],
    [data]
  )

  const busy = state.adding !== null
  const { counts } = state
  const ready = target !== null && targets.loadError === null
  const canAdd = ready && counts.add > 0 && counts.pending === 0 && !busy && !state.checking
  const nowProblem =
    target === null
      ? null
      : checkNowProblem({
          questions: Math.max(counts.add, 1),
          markets: markets.length,
          samples: target.samples,
          searchesLeft: data?.searchesLeft ?? null
        })
  const cost =
    target === null || counts.add === 0
      ? null
      : costText({
          questions: counts.add,
          markets,
          samples: target.samples,
          searchesLeft: data?.searchesLeft ?? null
        })

  useAiContext({
    screen: 'drawer.add-questions',
    screenLabel: 'Add questions',
    entities: target
      ? [
          {
            kind: target.kind === 'topic' ? 'topic' : 'page',
            id: target.id,
            label: target.name,
            detail: pluralize(target.questions - target.keywords, 'question')
          }
        ]
      : [],
    numbers: [{ label: 'New questions', value: String(counts.add) }],
    capabilities: ['add-questions']
  })

  const thin = useMemo(() => {
    const own = targets.own.map((row) => row.stage)
    const stageTotals = stageCounts(own, state.rows)
    return thinStages(stageTotals).map((stage) => ({ stage, count: stageTotals[stage] }))
  }, [targets.own, state.rows])

  const pick = useCallback(
    (id: string) => {
      const next = data?.targets.find((item) => item.id === id)
      if (!next) return
      setPicked(id)
      setIntervalPick(null)
      onTarget?.(id, next.kind)
    },
    [data, onTarget]
  )

  const takeIdeas = useCallback(
    (
      from: { items: readonly Suggestion[] },
      take: (ids: readonly string[]) => void,
      ids: readonly string[]
    ) => {
      const chosen = from.items.filter((item) => ids.includes(item.id))
      if (chosen.length === 0) return
      actions.addRows(
        chosen.map((item) => ({
          question: item.text,
          stage: item.stage,
          ...(item.page ? { page: item.page } : {})
        })),
        'suggested'
      )
      take(ids)
    },
    [actions]
  )

  const receiveImport = useCallback(
    (rows: readonly ImportRow[]) => {
      actions.addRows(rows.map(rowFromImport), 'imported')
      onTab?.('type')
    },
    [actions, onTab]
  )

  function openImport(file?: File): void {
    if (!onImport) return
    if (file) handFile(file)
    onImport(receiveImport)
  }

  async function add(mode: 'later' | 'now'): Promise<void> {
    if (target === null) return
    setIntervalError(null)
    // The check rhythm is saved first: if it fails the drawer stays open with the rows
    // untouched, and nothing is added twice when the person tries again.
    if (intervalDays !== null && intervalDays !== target.intervalDays) {
      try {
        await source['pages:update']({ projectId, pageId: target.id, intervalDays })
      } catch (cause) {
        setIntervalError(
          `Could not save how often this is checked, so nothing was added. ${errorText(cause, '', { sentence: true })}`.trim()
        )
        return
      }
    }
    const result = await actions.commit(mode)
    if (result === null) return
    const ids = result.promptIds.flatMap((group) => group.promptIds)
    if (mode === 'now' && ids.length > 0) startCheck(source, tools, projectId, target, ids)
    announce(source, tools, projectId, target, result, mode === 'now')
    setReload((value) => value + 1)
    close()
  }

  const summary: ReactNode =
    target === null ? (
      'Pick a page or topic for the questions.'
    ) : (
      <span className="aq-sum">
        <span>
          <strong>{counts.add.toLocaleString('en-US')} to add</strong>
          {counts.duplicates > 0 ? ` · ${pluralize(counts.duplicates, 'duplicate')} skipped` : ''}
          {counts.decide > 0 ? ` · ${counts.decide.toLocaleString('en-US')} to decide` : ''}
          {counts.fix > 0 ? ` · ${counts.fix.toLocaleString('en-US')} need a fix` : ''}
          {counts.pending > 0 || state.checking ? ' · checking…' : ''}
        </span>
        {cost ? <span>{cost}</span> : null}
        {counts.add > 0 ? (
          <span>
            {kind === 'topic' ? 'Topic' : 'Page'} grows to{' '}
            {questionsAndKeywords(
              target.questions - target.keywords + counts.add - counts.keywords,
              target.keywords + counts.keywords
            )}
          </span>
        ) : null}
        {nowProblem !== null && counts.add > 0 ? (
          <span className="aq-sum-warn">{nowProblem}</span>
        ) : null}
      </span>
    )

  return (
    <Drawer
      id="add-questions"
      title="Add questions"
      subtitle="Write the questions your buyers would type into Google. Each row is one question, with its stage and the page that should be cited."
      status="Nothing is searched yet"
      className="aq-drawer"
      testId="add-questions-drawer"
      dirty={state.dirty && !busy}
      guard={{
        title: 'Discard your questions?',
        body: 'The rows you typed and picked are not added.'
      }}
      closeDisabled={busy}
      busy={busy}
      onClose={close}
      footer={{
        summary,
        secondary: {
          label: nextCheckLabel(target?.nextCheckAt ?? null, now()),
          disabled: !canAdd || state.adding === 'now',
          busy: state.adding === 'later',
          onClick: () => void add('later'),
          testId: 'aq-add-later'
        },
        primary: {
          label: 'Add and check now',
          disabled: !canAdd || nowProblem !== null || state.adding === 'later',
          busy: state.adding === 'now',
          onClick: () => void add('now'),
          testId: 'aq-add-now'
        }
      }}
    >
      <div className="aq-layout">
        <div className="aq-main">
          <SourceTabs tab={tab} hint={TAB_HINT[tab]} onTab={(next) => onTab?.(next)} />
          <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)} className="aq-panel">
            {tab === 'type' ? (
              <ImportBanner
                onImport={() => openImport()}
                onDrop={(file) => openImport(file)}
                onTemplate={() =>
                  void source['import:template']({ entity: 'questions', format: 'csv' })
                }
              />
            ) : null}
            {tab === 'import' ? (
              <ImportBanner
                large
                onImport={() => openImport()}
                onDrop={(file) => openImport(file)}
                onTemplate={() =>
                  void source['import:template']({ entity: 'questions', format: 'csv' })
                }
              />
            ) : null}
            {tab === 'suggest' ? (
              <HelpTab
                projectId={projectId}
                targetId={target?.id ?? null}
                kind={kind}
                source={source}
                way={help}
                bot={bot}
                onWay={(way) => onHelp?.(way)}
                onBot={(next) => onBot?.(next)}
                page={target?.url ?? state.defaultPage ?? null}
                site={siteOf(data)}
                thin={thin.map((item) => TOPIC_STAGE_LABEL[item.stage])}
                items={drafted}
                seen={seen.items}
                disabled={!ready || busy}
                onRows={(result) => draftedActions.receive(result, false)}
                onAdd={(ids) => {
                  takeIdeas(seen, seen.take, ids)
                  takeIdeas({ items: drafted }, draftedActions.take, ids)
                }}
                onDismiss={(ids) => {
                  seen.take(ids)
                  draftedActions.take(ids)
                }}
                {...(openLink ? { openLink } : {})}
              />
            ) : null}
            {tab === 'tracked' ? (
              <TrackedTab
                tracked={targets.tracked}
                targetId={target?.id ?? null}
                disabled={!ready || busy}
                onAdd={(picks) =>
                  actions.addRows(
                    picks.map((item) => ({
                      question: item.text,
                      stage: item.stage !== null && isTopicStage(item.stage) ? item.stage : '',
                      keep: true
                    })),
                    'tracked'
                  )
                }
              />
            ) : null}
          </div>
          {draft.offer ? (
            <p className="aq-notice aq-draft" role="status" data-testid="aq-draft">
              {pluralize(draft.offer.rows.length, 'question')} you did not add yet, saved{' '}
              {savedWhen(draft.offer.savedAt, now())}.{' '}
              <button
                type="button"
                className="aq-link"
                onClick={() => {
                  const saved = draft.take()
                  if (saved === null) return
                  actions.restore(saved.rows)
                  const same = saved.targetId === null || saved.targetId === target?.id
                  if (!same && saved.targetId !== null) pick(saved.targetId)
                  if (same && saved.defaultPage !== null) actions.setDefaultPage(saved.defaultPage)
                }}
              >
                Continue
              </button>
              {' · '}
              <button type="button" className="aq-link" onClick={draft.discard}>
                Discard
              </button>
            </p>
          ) : null}
          {state.error ? (
            <p className="aq-error" role="alert">
              {state.error}
            </p>
          ) : null}
          {intervalError ? (
            <p className="aq-error" role="alert" data-testid="aq-interval-error">
              {intervalError}
            </p>
          ) : null}
          {draft.saveFailed ? (
            <p className="aq-notice" role="status" data-testid="aq-draft-failed">
              Your rows could not be saved for later. We will try again.
            </p>
          ) : null}
          {state.notice ? (
            <p className="aq-notice" role="status">
              {state.notice}{' '}
              <button type="button" className="aq-link" onClick={actions.clearNotice}>
                OK
              </button>
            </p>
          ) : null}
          <RowsGrid
            rows={state.rows}
            checks={state.checks}
            kind={kind}
            pages={pages}
            defaultPage={state.defaultPage}
            markets={markets}
            projectMarkets={data?.markets ?? markets}
            // Rows that came with a market (an imported file) show it without Expert options.
            showMarket={showMarket || state.rows.some((row) => row.market !== '')}
            showTags={showTags}
            disabled={busy}
            showAll={showAll}
            onShowAll={() => setShowAll(true)}
            onCell={actions.setCell}
            onPaste={actions.paste}
            onRemove={actions.remove}
            onKeepBoth={actions.keepBoth}
          />
          <BulkBar
            kind={kind}
            pages={pages}
            disabled={busy || !state.dirty}
            expertOpen={expert}
            onExpert={setExpert}
            onSetAll={actions.setAll}
            onFill={() => actions.fill(pages)}
            {...(match ? { matchOpen: match.open, onMatch: match.onOpen } : {})}
          />
          {match?.open && kind === 'topic' && target !== null ? (
            <MatchPanel
              projectId={projectId}
              targetId={target.id}
              rows={state.rows}
              site={siteOf(data)}
              source={source}
              way={match.way}
              bot={match.bot}
              disabled={!ready || busy}
              onWay={match.onWay}
              onBot={match.onBot}
              onPages={(matched) => {
                for (const [key, page] of matched) actions.setCell(key, { page })
              }}
              onClose={() => match.onOpen(false)}
              {...(openLink ? { openLink } : {})}
            />
          ) : null}
          {expert ? (
            <ExpertPanel
              kind={kind}
              showMarket={showMarket}
              showTags={showTags}
              keywordRule={state.keywordRule}
              intervalDays={intervalDays}
              disabled={busy}
              onShowMarket={setShowMarket}
              onShowTags={setShowTags}
              onKeywordRule={actions.setKeywordRule}
              onInterval={setIntervalPick}
            />
          ) : null}
        </div>
        <QuestionRail
          kind={kind}
          targets={takers}
          target={target}
          blocked={targets.blocked}
          loading={data === null && targets.loadError === null}
          loadError={targets.loadError}
          pages={pages}
          defaultPage={state.defaultPage}
          markets={markets}
          disabled={busy}
          onTarget={pick}
          onNewTopic={
            onNewTopic
              ? () =>
                  onNewTopic((topicId) => {
                    setPicked(topicId)
                    setReload((value) => value + 1)
                    onTarget?.(topicId, 'topic')
                  })
              : null
          }
          onDefaultPage={actions.setDefaultPage}
          onAddPage={
            onAddPage
              ? () =>
                  onAddPage((url) => {
                    setReload((value) => value + 1)
                    actions.setDefaultPage(url)
                  })
              : null
          }
          missing={
            target === null
              ? null
              : {
                  kind,
                  thin,
                  items: gaps.items,
                  busy: gaps.busy,
                  error: gaps.error,
                  disabled: busy,
                  onSuggest: (count) => void gapActions.suggest(count, gapInstruction(thin)),
                  onAdd: (ids) => takeIdeas(gaps, gapActions.take, ids)
                }
          }
        />
      </div>
    </Drawer>
  )
}

/** A row the import drawer checked, as a grid row (its check runs again here). */
function rowFromImport(row: ImportRow): Partial<DraftRow> {
  const values = row.values
  const stage = values.stage ?? ''
  return {
    question: values.question ?? values.keyword ?? '',
    stage: isTopicStage(stage) ? stage : '',
    page: values.page ?? '',
    market: values.market ?? '',
    tags: values.tags ?? '',
    topic: values.topic ?? '',
    createTopic: values.createTopic === '1'
  }
}

/** "today at 2:05 PM", "yesterday at 2:05 PM" or "Oct 21, 2:05 PM": when a draft was saved. */
function savedWhen(iso: string, today: Date): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return 'earlier'
  const day = (value: Date): number =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const days = Math.round((day(today) - day(at)) / 86_400_000)
  if (days <= 0) return `today at ${formatClock(iso)}`
  if (days === 1) return `yesterday at ${formatClock(iso)}`
  return formatMoment(iso, { now: today })
}

function gapInstruction(thin: readonly { stage: TopicStage }[]): string | null {
  if (thin.length === 0) return null
  return `Only suggest questions for these buyer stages, which have the fewest questions: ${thin.map((item) => item.stage).join(', ')}.`
}

/** "6 questions added" with View them and Undo (the whole batch). */
function announce(
  source: AddQuestionsSource,
  tools: BuildTools,
  projectId: string,
  target: QuestionTarget,
  result: ImportCommitResult,
  checking: boolean
): void {
  const batchId = result.batchId
  tools.notify(
    addedText(result.added, checking),
    'ok',
    { label: 'View them', href: questionsHash(target.id) },
    batchId === null
      ? undefined
      : {
          label: 'Undo',
          onClick: () => {
            source['import:undo']({ projectId, batchId }).then(
              (undone) => tools.notify(undone.message, 'ok'),
              (cause: unknown) => tools.notify(checkError(cause, 'Could not undo the add.'), 'bad')
            )
          }
        }
  )
}

/**
 * Starts a check of just the added questions in every market of the page or topic.
 * `checks:start` resolves when the job ends, after the drawer has closed, so the
 * outcome comes back as a toast.
 */
function startCheck(
  source: AddQuestionsSource,
  tools: BuildTools,
  projectId: string,
  target: QuestionTarget,
  promptIds: readonly string[]
): void {
  const link = { label: 'View them', href: questionsHash(target.id) }
  source['checks:start']({ projectId, pageIds: [target.id], marketIds: null, promptIds }).then(
    (job) => {
      if (job.status === 'finished') {
        tools.notify(`Checked ${pluralize(promptIds.length, 'new question')}`, 'ok', link)
      } else {
        tools.notify(checkStartMessage(job), 'bad', link)
      }
    },
    (cause: unknown) => {
      tools.notify(
        checkError(cause, 'The questions were added, but the check did not start.'),
        'bad',
        link
      )
    }
  )
}
