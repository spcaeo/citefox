import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { Market } from '@shared/domain'
import type { HelpFillResult, ImportCommitResult, ImportRow, ImportRules } from '@shared/ipc'
import type { ImportEntity } from '@shared/import-fields'
import { errorText } from '../components/errorText'
import {
  Button,
  createHelpFillSource,
  Drawer,
  HelpFill,
  Stepper,
  SummaryBanner,
  type HelpFillBot,
  type HelpFillSource,
  type HelpFillWay
} from '../ui'
import { ChooseStep } from './components/ChooseStep'
import { FileBar } from './components/FileBar'
import { MatchCard, type PageChoice } from './components/MatchCard'
import { PreviewCard } from './components/PreviewCard'
import {
  addCount,
  IMPORT_STEPS,
  importHeading,
  nounOf,
  summaryParts,
  type ImportFilter,
  type ImportStep
} from './model'
import { takeHandedFile } from './handoff'
import { IMPORT_HELP, rowsAsPaste } from './help'
import { createImportSource, type ImportSource } from './source'
import { useImportFlow } from './useImportFlow'
import './importFlow.css'

/** Rows the preview card draws on the match step, and on the check step. */
const MATCH_ROWS = 8
const CHECK_ROWS = 400

/** ✦ Help me find them on Choose: open or not, its way and chatbot (on the drawer's URL). */
export interface ImportHelpUrl {
  open: boolean
  way: HelpFillWay | null
  bot: HelpFillBot | null
  onOpen: (open: boolean) => void
  onWay: (way: HelpFillWay) => void
  onBot: (bot: HelpFillBot) => void
}

export interface ImportDrawerProps {
  projectId: string
  entity: ImportEntity
  /** The page or topic rows go to (questions, keywords, markets). */
  targetId: string | null
  step: ImportStep
  filter: ImportFilter
  onStep: (step: ImportStep) => void
  onFilter: (filter: ImportFilter) => void
  onClose: () => void
  /**
   * `return`: the checked rows go back to the drawer or screen that opened this one
   * (Add questions, Import pages), which adds them. `commit`: rows are added here as
   * one batch (competitors, products, markets).
   */
  mode: 'return' | 'commit'
  onReturn?: (rows: readonly ImportRow[]) => void
  onCommitted?: (result: ImportCommitResult) => void
  pages?: readonly PageChoice[]
  defaultPage?: string | null
  markets?: readonly Market[]
  site?: string | null
  rules?: ImportRules
  /** The cost line for N rows added ("100 searches · 412 left"), or null. */
  costLine?: (count: number) => string | null
  /** ✦ Help me find them for a list with a helper kind (IMPORT_HELP). Absent: Choose as before. */
  help?: ImportHelpUrl
  /** Opens a chatbot link. Default: the app's safe path. Tests pass a spy. */
  openLink?: (url: string) => void
  source?: ImportSource
  helpSource?: HelpFillSource
}

/**
 * The shared import step (ImportMap.dc.html) as a stacked drawer:
 * "… › Add questions › Import a file". Choose a file (or drop or paste one),
 * match its columns, then check every row; nothing is added before the last
 * button, and nothing is searched. A list with a helper kind (competitors) also
 * offers ✦ Help me find them: the rows it reads come in as a paste and go
 * straight to the check.
 */
export function ImportDrawer({
  projectId,
  entity,
  targetId,
  step: wanted,
  filter,
  onStep,
  onFilter,
  onClose,
  mode,
  onReturn,
  onCommitted,
  pages = [],
  defaultPage = null,
  markets = [],
  site = null,
  rules = { keywords: true },
  costLine,
  help,
  openLink,
  source: given,
  helpSource: givenHelp
}: ImportDrawerProps): JSX.Element {
  const source = useMemo(() => given ?? createImportSource(), [given])
  const helpSource = useMemo(() => givenHelp ?? createHelpFillSource(), [givenHelp])
  const helper = help === undefined ? undefined : IMPORT_HELP[entity]
  // The banner of the answer the helper read, shown over the checked rows.
  const [helped, setHelped] = useState<HelpFillResult | null>(null)
  const [state, actions] = useImportFlow({
    source,
    projectId,
    entity,
    targetId,
    rules,
    defaultPage
  })
  // A file dropped on the drawer below is read as soon as this one opens.
  const handed = useRef(false)
  useEffect(() => {
    if (handed.current) return
    handed.current = true
    const file = takeHandedFile()
    if (file === null) return
    void actions.dropFile(file).then((ok) => {
      if (ok) onStep('match')
    })
  }, [actions, onStep])
  const [committing, setCommitting] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)
  const { read, preview } = state
  // A step on the URL without a file read (after a reload) starts again at Choose.
  const step: ImportStep = read === null ? 'choose' : wanted === 'choose' ? 'match' : wanted
  const counts = preview?.counts ?? null
  const toAdd = counts === null ? 0 : addCount(counts)
  const returned = useMemo(
    () =>
      (preview?.rows ?? []).filter(
        (row) =>
          row.result !== 'duplicate' &&
          // Question rows that need a fix are fixed in Add questions' rows; a list such
          // as pages has nowhere to fix them, so they stay behind.
          !(row.result === 'fix' && (row.fix === 'empty' || entity !== 'questions'))
      ),
    [preview, entity]
  )
  const marketLabel = (id: string): string => {
    const market = markets.find((item) => item.id === id)
    return market === undefined ? id : market.country.toUpperCase()
  }
  const defaultMarket = markets[0]?.id ?? null

  async function pick(): Promise<void> {
    if (await actions.pickFile()) onStep('match')
  }

  async function finish(): Promise<void> {
    if (preview === null) return
    if (mode === 'return') {
      onReturn?.(returned)
      return
    }
    setCommitting(true)
    setCommitError(null)
    try {
      const result = await source['import:commit']({
        projectId,
        entity,
        targetId,
        rules,
        rows: preview.rows
          .filter((row) => row.result === 'new' || row.result === 'keyword')
          .map((row) => ({ values: row.values, keep: false }))
      })
      onCommitted?.(result)
    } catch (cause) {
      setCommitError(errorText(cause, 'Could not add the rows.', { sentence: true }))
      setCommitting(false)
    }
  }

  const cost = counts !== null && costLine ? costLine(toAdd) : null
  const summary =
    counts === null ? (
      step === 'choose' ? (
        'Nothing is added until every row is checked.'
      ) : (
        'Checking every row…'
      )
    ) : (
      <span className="ifl-sum">
        <span>
          <strong>{summaryParts(counts)[0]}</strong>
          {summaryParts(counts)
            .slice(1)
            .map((part) => ` · ${part}`)
            .join('')}
        </span>
        {cost ? <span>{cost}</span> : null}
      </span>
    )
  const error = state.error ?? commitError

  return (
    <Drawer
      id="import"
      title="Import a file"
      heading={importHeading(entity)}
      className="ifl-drawer"
      testId="import-drawer"
      status={
        <Stepper
          label="Import steps"
          steps={IMPORT_STEPS}
          current={step}
          onStep={(id) => onStep(id as ImportStep)}
        />
      }
      dirty={read !== null && !committing}
      guard={{ title: 'Leave this import?', body: 'The file and the column match are not kept.' }}
      busy={state.busy !== null || committing}
      closeDisabled={committing}
      focusKey={step}
      onClose={onClose}
      footer={{
        summary,
        cancel: step === 'choose' ? 'Cancel' : false,
        ...(step !== 'choose'
          ? {
              secondary: {
                label: 'Back',
                onClick: () => {
                  if (step === 'check') onStep('match')
                  else {
                    actions.reset()
                    setHelped(null)
                    onStep('choose')
                  }
                }
              }
            }
          : {}),
        ...(step === 'match'
          ? {
              primary: {
                label: `Check ${(read?.rowCount ?? 0).toLocaleString('en-US')} rows`,
                disabled: preview === null,
                onClick: () => onStep('check'),
                testId: 'import-check-rows'
              }
            }
          : step === 'check'
            ? {
                primary: {
                  label:
                    mode === 'return'
                      ? `Add ${returned.length.toLocaleString('en-US')} ${returned.length === 1 ? 'row' : 'rows'} to the list`
                      : `Add ${toAdd.toLocaleString('en-US')} ${nounOf(entity, toAdd)}`,
                  disabled:
                    preview === null ||
                    state.previewing ||
                    (mode === 'return' ? returned.length === 0 : toAdd === 0),
                  busy: committing,
                  onClick: () => void finish(),
                  testId: 'import-finish'
                }
              }
            : {})
      }}
    >
      <div className="ifl-body">
        {error ? (
          <p className="ifl-error" role="alert">
            {error}
          </p>
        ) : null}
        {(step === 'choose' || read === null) && helper && help?.open ? (
          <div className="ifl-help-panel" data-testid="import-help">
            <HelpFill
              kind={helper.kind}
              projectId={projectId}
              scope={{ pageId: null }}
              source={helpSource}
              way={help.way}
              onWay={help.onWay}
              bot={help.bot}
              onBot={help.onBot}
              disabled={state.busy !== null}
              describe={helper.describe}
              chatbot={helper.chatbot}
              onRows={(result) => {
                if (result.rows.length === 0) return
                void actions.usePaste(rowsAsPaste(helper.columns, result.rows)).then((ok) => {
                  if (!ok) return
                  setHelped(result)
                  onStep('check')
                })
              }}
              {...(openLink ? { openLink } : {})}
              testId="import-hf"
            />
            <Button variant="text" size="sm" onClick={() => help.onOpen(false)}>
              Import a file instead
            </Button>
          </div>
        ) : step === 'choose' || read === null ? (
          <ChooseStep
            entity={entity}
            {...(helper && help
              ? {
                  help: { label: helper.label, hint: helper.hint, onOpen: () => help.onOpen(true) }
                }
              : {})}
            busy={state.busy !== null}
            onPick={() => void pick()}
            onDrop={(file) => {
              void actions.dropFile(file).then((ok) => {
                if (ok) onStep('match')
              })
            }}
            onPaste={(text) => {
              void actions.usePaste(text).then((ok) => {
                if (ok) onStep('match')
              })
            }}
            onTemplate={(format) => void actions.template(format)}
          />
        ) : (
          <>
            {helped ? <SummaryBanner result={helped} testId="import-hf-summary" /> : null}
            <FileBar
              read={read}
              busy={state.busy !== null}
              onSheet={actions.chooseSheet}
              onHeader={actions.setHasHeader}
              onAnother={() => {
                actions.reset()
                setHelped(null)
                onStep('choose')
              }}
            />
            <div className={step === 'match' ? 'ifl-grid' : 'ifl-grid ifl-grid-check'}>
              {step === 'match' ? (
                <MatchCard
                  entity={entity}
                  read={read}
                  mapping={state.mapping}
                  preview={preview}
                  stageWords={state.stageWords}
                  pages={pages}
                  defaultPage={state.defaults.page}
                  usePageDefault={state.usePageDefault}
                  saveMapping={state.saveMapping}
                  onMap={actions.setMapping}
                  onStageWord={actions.setStageWord}
                  onDefaultPage={(page) => actions.setDefaults({ page })}
                  onUsePageDefault={actions.setUsePageDefault}
                  onSaveMapping={actions.setSaveMapping}
                />
              ) : null}
              <PreviewCard
                entity={entity}
                preview={preview}
                checking={state.previewing}
                filter={filter}
                limit={step === 'match' ? MATCH_ROWS : CHECK_ROWS}
                title={
                  step === 'match'
                    ? `first ${Math.min(MATCH_ROWS, read.rowCount)} of ${read.rowCount.toLocaleString('en-US')} · every row is checked`
                    : `${read.rowCount.toLocaleString('en-US')} rows checked`
                }
                marketLabel={marketLabel}
                site={site}
                defaultMarket={defaultMarket}
                busy={state.busy !== null}
                onFilter={onFilter}
                onAddMarkets={(codes) => void actions.addMarkets(codes)}
                onDropMarketColumn={actions.dropMarketColumn}
                onStageWord={actions.setStageWord}
              />
            </div>
          </>
        )}
      </div>
    </Drawer>
  )
}
