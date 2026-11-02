import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import type { BuyerPrompt, CoverageMatrix } from '@shared/domain'
import type { GapStatus, PageDetail } from '@shared/ipc'
import type { AssistClient } from '../../assist/client'
import { LoadError } from '../../components/LoadError'
import { errorText as loadErrorText } from '../../components/errorText'
import { DrillHost } from '../../drill'
import type { ShellClient } from '../../projects/client'
import { DrawerLevel } from '../../shell/DrawerLevel'
import { openDrawer, useDrawerEntry } from '../../shell/drawers'
import { marketLabel } from '../../shell/model'
import { navigateHash, pageHash } from '../../shell/routes'
import type { TemplatesClient } from '../../templates/client'
import { pageGenerationRequest } from '../../templates/model'
import { Button, EmptyState, IconButton, TabPanel, Tabs } from '../../ui'
import { useHashQuery } from '../../utils/hashQuery'
import { setupScope } from '../drills'
import { GapsMatrix } from '../GapsMatrix'
import { GapsOneByOne, PageWideFixes } from '../GapsOneByOne'
import { focusedPromptId, gapItemId, soleLevel } from '../gapsFilter'
import { GapsChart, GapsTiles, GapsWork } from '../GapsSummary'
import {
  chartPopulation,
  filterGapRows,
  formatDay,
  formatReadStamp,
  joinGapRows,
  withGapStates,
  type GapListRow
} from '../model'
import { errorText } from '../text'
import { GapDraftDrawer } from './GapDraftDrawer'
import { useLegacyPanel } from '../legacyPanel'
import { useGapFilter, withGapFilter } from './filterQuery'
import { GapsSettingsDrawer } from './GapsSettings'
import { useGapEdits } from './useGapEdits'
import { focusForView, viewFromFocus, type GapView } from './view'

const PANEL_ID = 'gp-views'
const PANEL_QUERY = ['panel'] as const

export interface GapsReviewProps {
  client: ShellClient
  templatesClient: TemplatesClient
  projectId: string
  page: PageDetail
  marketId: string
  /** Route focus: `row:<promptId>`, `view:one` or `view:fixes`. */
  focus: string | null
  assistClient?: AssistClient
  /** Above everything: the first-check bar while the page has never been checked. */
  header?: ReactNode
  /** Bumped when setup settles, so the matrix is read again. */
  reloadKey: number
  /** "Write content gaps" for a page with prompts and no matrix (no searches). */
  onWrite: () => void
  writing: boolean
}

/** The Content gaps review (v2): KPI tiles, then Matrix · One by one · Page-wide fixes. */
export function GapsReview({
  client,
  templatesClient,
  projectId,
  page,
  marketId,
  focus,
  assistClient,
  header,
  reloadKey,
  onWrite,
  writing
}: GapsReviewProps): JSX.Element {
  const [matrix, setMatrix] = useState<CoverageMatrix | null | undefined>(undefined)
  const [rows, setRows] = useState<readonly GapListRow[]>([])
  const [readStamp, setReadStamp] = useState<string | null>(null)
  const [modified, setModified] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [templateId, setTemplateId] = useState('')
  // Search and filters are on the URL (`gf.*`): a filtered list is a link, Back undoes a filter.
  const [filter, setFilter] = useGapFilter()
  const [openId, setOpenId] = useState<string | null>(null)
  const [view, setView] = useState<GapView>(() => viewFromFocus(focus))
  // The route asks for a view or a row (a link from Prompts, Back, Forward).
  const [seenFocus, setSeenFocus] = useState(focus)
  if (focus !== seenFocus) {
    setSeenFocus(focus)
    setView(viewFromFocus(focus))
  }
  // Settings is a drawer on the URL (`?drawer=gp-settings`); old `?panel=settings` links open it.
  const [query] = useHashQuery(PANEL_QUERY)
  useLegacyPanel(query.panel === 'settings' ? { key: 'panel', id: 'gp-settings' } : null)
  const settings = useDrawerEntry('gp-settings')
  const [rewriteError, setRewriteError] = useState<string | null>(null)
  const [rewriting, setRewriting] = useState(false)
  /** A row whose one-by-one item should scroll into view and take focus after this render. */
  const focusRowId = useRef<string | null>(null)
  const [focusTick, setFocusTick] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const rowsRef = useRef<readonly GapListRow[]>([])
  /** The route focus already acted on, so a later matrix change does not jump back to it. */
  const handledFocus = useRef<string | null>(null)
  const reloadMatrix = useCallback(() => {
    void Promise.resolve()
      .then(() => client.getGaps({ projectId, pageId: page.id }))
      .then((next) => (next ? apply(next) : undefined))
      .catch(() => undefined)
    // `apply` only reads the client and page, which the deps cover.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, projectId, page.id])
  const edits = useGapEdits(client, projectId, page.id, `${reloadKey}:${attempt}`, reloadMatrix)
  const shownRows = useMemo(() => withGapStates(rows, edits.states), [rows, edits.states])
  const draftDrawer = useDrawerEntry('gap-draft')
  const draftRow = draftDrawer
    ? (shownRows.find((row) => row.id === draftDrawer.entry.params.gap) ?? null)
    : null

  useEffect(() => {
    const rowId = focusRowId.current
    if (!rowId) return
    const item = document.getElementById(gapItemId(rowId))
    if (!item) return
    if (typeof item.scrollIntoView === 'function') {
      item.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
    item.querySelector<HTMLElement>('.ps-acc-btn')?.focus({ preventScroll: true })
    focusRowId.current = null
  }, [focusTick, openId, view])

  useEffect(() => {
    let cancelled = false
    void load(client, projectId, page.id, marketId).then(
      (loaded) => {
        if (cancelled) return
        rowsRef.current = loaded.rows
        setMatrix(loaded.matrix)
        setRows(loaded.rows)
        setReadStamp(loaded.readStamp)
        setModified(loaded.modified)
        setOpenId((current) => current ?? loaded.rows[0]?.id ?? null)
        setLoadError(null)
      },
      (cause: unknown) => {
        if (!cancelled) setLoadError(loadErrorText(cause, 'Could not load the coverage matrix.'))
      }
    )
    return () => {
      cancelled = true
    }
  }, [client, projectId, page.id, marketId, attempt, reloadKey])

  // The route asks for a row or a view (a link from Prompts, Back, Forward).
  useEffect(() => {
    const focused = focusedPromptId(focus)
    if (!focused || matrix === undefined || handledFocus.current === focus) return
    handledFocus.current = focus
    const row = rowsRef.current.find((item) => item.promptId === focused)
    if (!row) return
    setOpenId(row.id)
    focusRowId.current = row.id
    setFocusTick((tick) => tick + 1)
  }, [focus, matrix])

  function changeView(next: GapView): void {
    setView(next)
    navigateHash(
      withGapFilter(
        pageHash(page.id, 'gaps', { marketId: marketId || null, filter: focusForView(next) })
      )
    )
  }

  /** Opens a row one by one, then scrolls to it and focuses it. */
  function openRow(row: GapListRow): void {
    setOpenId(row.id)
    setView('one')
    navigateHash(
      withGapFilter(
        pageHash(page.id, 'gaps', { marketId: marketId || null, filter: `row:${row.promptId}` })
      )
    )
    focusRowId.current = row.id
    setFocusTick((tick) => tick + 1)
  }

  async function rewrite(): Promise<void> {
    setRewriteError(null)
    setRewriting(true)
    try {
      await client.generateGaps(pageGenerationRequest(projectId, page.id, templateId))
      setAttempt((current) => current + 1)
      settings?.close()
    } catch (cause: unknown) {
      setRewriteError(errorText(cause, 'Could not write the content gaps.'))
    } finally {
      setRewriting(false)
    }
  }

  const population = chartPopulation(shownRows, filter)
  const listed = filterGapRows(shownRows, filter)
  const market = page.markets.find((item) => item.id === marketId) ?? page.markets[0]
  const scope = setupScope(page.id, market)
  // A failed reload for another market keeps the matrix on screen and says why.
  const shownError = error ?? edits.error ?? (matrix !== undefined ? loadError : null)

  return (
    <DrillHost>
      <div className="gp-stack">
        {header}
        {shownError ? (
          <p className="ps-error" role="alert">
            {shownError}
          </p>
        ) : null}
        {matrix === undefined && loadError ? (
          <LoadError
            title="CiteFox could not load the coverage matrix."
            message={loadError}
            onRetry={() => {
              setLoadError(null)
              setAttempt((current) => current + 1)
            }}
          />
        ) : null}
        {matrix === undefined && !loadError ? (
          <p role="status">Loading the coverage matrix…</p>
        ) : null}
        {matrix === null ? (
          <div className="ui-panel">
            <EmptyState
              level={2}
              title="Content gaps are not written yet"
              body={`CiteFox AI compares each buyer question with the page as CiteFox read it${
                readStamp ? ` on ${formatReadStamp(readStamp)}` : ''
              } and lists what to add. No searches.`}
              action={
                <Button busy={writing} onClick={onWrite}>
                  Write content gaps
                </Button>
              }
            />
          </div>
        ) : null}
        {matrix ? (
          <>
            <div className="gp-head">
              <div className="gp-head-text">
                <GapsWork population={population} scope={scope} />
                <p className="gp-source">
                  {market ? `${marketLabel(market)} questions` : 'Questions'} compared with the page
                  {readStamp ? ` as read ${formatReadStamp(readStamp)}` : ''}
                  {modified ? ` (last modified ${formatDay(modified)})` : ''}. Written again only
                  when the page content changes.
                  {matrix.stale ? ' The page changed since this was written.' : ''}
                </p>
              </div>
              <IconButton
                icon="sliders"
                label="Content gaps settings"
                data-tip="Content gaps settings"
                onClick={() => {
                  setRewriteError(null)
                  openDrawer('gp-settings')
                }}
              />
            </div>

            <GapsTiles
              population={population}
              coverage={filter.coverage}
              scope={scope}
              onToggleCoverage={(level) =>
                setFilter({ ...filter, coverage: soleLevel(filter.coverage, level) })
              }
            />

            <Tabs<GapView>
              label="Content gaps views"
              size="sm"
              panelId={PANEL_ID}
              value={view}
              onChange={changeView}
              tabs={[
                { id: 'matrix', label: 'Matrix', count: listed.length },
                { id: 'one', label: 'One by one', count: listed.length },
                { id: 'fixes', label: 'Page-wide fixes', count: matrix.findings.length }
              ]}
            />
            <TabPanel panelId={PANEL_ID} id={view} className="gp-panel">
              {view === 'matrix' ? (
                <div className="gp-stack">
                  <GapsChart population={population} scope={scope} />
                  <GapsMatrix
                    pageId={page.id}
                    rows={shownRows}
                    population={population}
                    listed={listed}
                    filter={filter}
                    onFilter={setFilter}
                    scope={scope}
                    onOpenRow={openRow}
                    onSetStatus={(chosen, status) => void changeStatus(chosen, status)}
                    onRedo={(row) => void redo(row)}
                    onEditDraft={edits.editable ? editDraft : undefined}
                    onPlanFix={(chosen) => edits.planFix(page.id, chosen)}
                    onCopyJsonLd={edits.copyJsonLd}
                  />
                </div>
              ) : null}
              {view === 'one' ? (
                <GapsOneByOne
                  rows={listed}
                  openId={openId}
                  onToggle={(rowId) => setOpenId((current) => (current === rowId ? null : rowId))}
                  scope={scope}
                  projectId={projectId}
                  pageId={page.id}
                  marketId={marketId}
                  assistClient={assistClient}
                  onSetStatus={(row, status) => void changeStatus([row], status)}
                  onEditDraft={edits.editable ? editDraft : undefined}
                  onPlanFix={(row) => edits.planFix(page.id, [row])}
                  onCopyJsonLd={(row) => edits.copyJsonLd([row])}
                />
              ) : null}
              {view === 'fixes' ? (
                <PageWideFixes pageId={page.id} findings={matrix.findings} />
              ) : null}
            </TabPanel>
            {settings ? (
              <DrawerLevel depth={settings.depth}>
                <GapsSettingsDrawer
                  matrix={matrix}
                  templatesClient={templatesClient}
                  templateId={templateId}
                  onTemplate={setTemplateId}
                  busy={rewriting}
                  error={rewriteError}
                  onRewrite={() => void rewrite()}
                  onClose={() => settings.close()}
                />
              </DrawerLevel>
            ) : null}
            {draftDrawer && draftRow ? (
              <DrawerLevel depth={draftDrawer.depth}>
                <GapDraftDrawer
                  key={draftRow.id}
                  row={draftRow}
                  brands={edits.brands}
                  onClose={() => draftDrawer.close()}
                  onSave={async (change) => {
                    await edits.saveDraft(draftRow, change)
                    draftDrawer.close()
                  }}
                />
              </DrawerLevel>
            ) : null}
          </>
        ) : null}
      </div>
    </DrillHost>
  )

  function editDraft(row: GapListRow): void {
    openDrawer('gap-draft', { gap: row.id })
  }

  /** Open, published or verified: the status store when there is one, else the done mark. */
  async function changeStatus(chosen: readonly GapListRow[], status: GapStatus): Promise<void> {
    if (edits.editable) {
      await edits.setStatus(chosen, status)
      return
    }
    for (const row of chosen) await setDone(row, status !== 'open')
  }

  async function apply(next: CoverageMatrix): Promise<void> {
    setMatrix(next)
    const joined = joinGapRows(next, await promptsOf(client, projectId, page.id))
    rowsRef.current = joined
    setRows(joined)
  }

  async function setDone(row: GapListRow, done: boolean): Promise<void> {
    setError(null)
    try {
      await apply(
        await client.setGapDone({ projectId, pageId: page.id, promptId: row.promptId, done })
      )
    } catch (cause: unknown) {
      setError(errorText(cause, 'Could not update the row.'))
    }
  }

  async function redo(row: GapListRow): Promise<void> {
    setError(null)
    try {
      await apply(await client.redoGap({ projectId, pageId: page.id, promptId: row.promptId }))
    } catch (cause: unknown) {
      setError(errorText(cause, 'Could not redo the row.'))
    }
  }
}

async function promptsOf(
  client: ShellClient,
  projectId: string,
  pageId: string
): Promise<readonly BuyerPrompt[]> {
  const view = await client.listPrompts({ projectId, pageId })
  return view.prompts
}

async function load(
  client: ShellClient,
  projectId: string,
  pageId: string,
  marketId: string
): Promise<{
  matrix: CoverageMatrix | null
  rows: GapListRow[]
  readStamp: string | null
  modified: string | null
}> {
  const [matrix, prompts, read] = await Promise.all([
    client.getGaps({ projectId, pageId }),
    client.listPrompts({ projectId, pageId }),
    client.getRead({ projectId, pageId })
  ])
  const rows = matrix
    ? joinGapRows(matrix, prompts.prompts).map((row) => ({
        ...row,
        text:
          row.text ||
          textFor(
            prompts.prompts.find((prompt) => prompt.id === row.promptId)?.variants ?? [],
            marketId
          )
      }))
    : []
  return {
    matrix,
    rows,
    readStamp: read?.fetchedAt ?? null,
    modified: read?.modifiedAt ?? null
  }
}

function textFor(
  variants: readonly { marketId: string; text: string }[],
  marketId: string
): string {
  return variants.find((variant) => variant.marketId === marketId)?.text ?? variants[0]?.text ?? ''
}
