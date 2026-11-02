import { useEffect, useMemo, useState, type JSX } from 'react'
import {
  PLAYGROUND_MEMORY_RUNS,
  templateKindInfo,
  type GenerationTemplate,
  type GenerationTemplateKind,
  type ProjectSummary
} from '@shared/domain'
import {
  PLAYGROUND_SAVE_PARTS,
  TEMPLATE_ERROR_MESSAGES,
  type PlaygroundAioResult,
  type PlaygroundRunResult,
  type PlaygroundSavePart
} from '@shared/ipc'
import { useAiContext } from '../assistant/context/useAiContext'
import { Icon } from '../components/Icon'
import { LoadError } from '../components/LoadError'
import { errorText } from '../components/errorText'
import { DrawerLevel } from '../shell/DrawerLevel'
import { openDrawer, useDrawerEntry } from '../shell/drawers'
import { sectionHash } from '../shell/routes'
import { DrillHost } from '../drill'
import { Button } from '../ui'
import {
  compareBlockReason,
  compareRunRequest,
  isPlaygroundKind,
  singleRunRequest,
  toggleCompareId
} from '../templates/model'
import type { PlaygroundClient } from './client'
import { CompareColumn, ComparePicker } from './components/Compare'
import { RunHistory } from './components/RunHistory'
import { RunOutput } from './components/RunOutput'
import { TemplateList } from './components/TemplateList'
import { firstOpenablePart, type SaveNote } from './saveNote'
import { SaveDrawer } from './SaveDrawer'
import './playground.css'
import { parseCoverageMatrix, parseProfileParts, parsePromptLines } from './output'

const PART_LABELS: Readonly<Record<PlaygroundSavePart, string>> = {
  pageRead: 'Page read',
  buyerProfile: 'Buyer profile',
  prompts: 'Questions',
  coverage: 'Coverage',
  aioChecks: 'AI Overview checks'
}

export function PlaygroundScreen(props: {
  client: PlaygroundClient
  projectId: string
  projects: readonly ProjectSummary[]
  focusId?: string
}): JSX.Element {
  return (
    <DrillHost>
      <PlaygroundBody {...props} />
    </DrillHost>
  )
}

function PlaygroundBody({
  client,
  projectId,
  projects,
  focusId
}: {
  client: PlaygroundClient
  projectId: string
  projects: readonly ProjectSummary[]
  focusId?: string
}): JSX.Element {
  const [templates, setTemplates] = useState<readonly GenerationTemplate[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(focusId ?? null)
  const [url, setUrl] = useState('')
  const [brandName, setBrandName] = useState('')
  const [promptCount, setPromptCount] = useState('')
  const [body, setBody] = useState('')
  const [runs, setRuns] = useState<readonly PlaygroundRunResult[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [aioByRun, setAioByRun] = useState<Readonly<Record<string, PlaygroundAioResult>>>({})
  const [checked, setChecked] = useState<readonly string[]>([])
  const [phase, setPhase] = useState<'idle' | 'running' | 'checking'>('idle')
  const [checkCount, setCheckCount] = useState(0)
  const [status, setStatus] = useState("Playground runs aren't saved.")
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  // Save to project is on the URL (`drawer=playground-save&pgs.run=<id>`): Back closes it.
  const saveDrawer = useDrawerEntry('playground-save')
  const saveRunId = saveDrawer?.entry.params['pgs.run'] ?? null
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveParts, setSaveParts] = useState<readonly PlaygroundSavePart[]>(['pageRead'])
  const [saveProjectId, setSaveProjectId] = useState(projectId)
  const [saveNote, setSaveNote] = useState<SaveNote | null>(null)
  const [runMode, setRunMode] = useState<'one' | 'compare'>('one')
  const [compareKind, setCompareKind] = useState<GenerationTemplateKind>('buyer_profile')
  const [compareIds, setCompareIds] = useState<readonly string[]>([])
  const [compareResults, setCompareResults] = useState<readonly PlaygroundRunResult[]>([])

  const selected = templates.find((template) => template.id === selectedId) ?? null
  const current = runs.find((run) => run.runId === currentId) ?? null
  const saveRun = runs.find((run) => run.runId === saveRunId) ?? null
  const aio = current ? (aioByRun[current.runId] ?? null) : null
  const history = useMemo(() => [...runs].reverse(), [runs])
  const promptLines = current ? parsePromptLines(current.modelOutput) : null
  const coverage = current ? parseCoverageMatrix(current.modelOutput) : null
  const profile =
    current && !promptLines && !coverage ? parseProfileParts(current.modelOutput) : null
  const saveTargets = projects.filter((project) => project.status !== 'archived')
  useAiContext({
    entities: selected
      ? [
          {
            kind: 'template',
            id: selected.id,
            label: selected.name,
            detail: templateKindInfo(selected.kind).label
          }
        ]
      : [],
    filters: { mode: runMode === 'compare' ? 'Compare templates' : 'One template' },
    numbers: [
      { label: 'Runs in memory', value: String(runs.length) },
      ...(runMode === 'compare'
        ? [{ label: 'Templates to compare', value: String(compareIds.length) }]
        : []),
      ...(promptLines
        ? [{ label: 'Questions in this run', value: String(promptLines.length) }]
        : [])
    ],
    facts: [
      "Playground runs aren't saved.",
      ...(current ? [`Showing a run of ${current.templateName}`] : []),
      ...(selected && body !== selected.body ? ['The template text is edited for this run'] : [])
    ]
  })

  useEffect(() => {
    let cancelled = false
    void Promise.all([client.listTemplates(), client.listRuns()]).then(
      ([list, stored]) => {
        if (cancelled) return
        const runnable = list.filter((template) => isPlaygroundKind(template.kind))
        setTemplates(runnable)
        setRuns(stored)
        const preferred =
          runnable.find((template) => template.id === focusId) ?? runnable[0] ?? null
        if (preferred) {
          setSelectedId(preferred.id)
          setBody(preferred.body)
        }
        setLoading(false)
      },
      (cause: unknown) => {
        if (cancelled) return
        setLoadError(errorText(cause, 'Could not open the playground.'))
        setLoading(false)
      }
    )
    return () => {
      cancelled = true
    }
  }, [client, focusId, reload])

  function pickTemplate(id: string): void {
    const next = templates.find((template) => template.id === id)
    setSelectedId(id)
    if (next) setBody(next.body)
    setError(null)
  }

  function sharedOverrides(bodyOverride: string | null): {
    body: string | null
    promptCount: number | null
    brandName: string | null
  } {
    const count = promptCount.trim()
    return {
      body: bodyOverride,
      promptCount: count.length === 0 ? null : Number(count),
      brandName: brandName.trim().length === 0 ? null : brandName.trim()
    }
  }

  async function run(): Promise<void> {
    if (phase !== 'idle') return
    if (runMode === 'compare') {
      await runCompare()
      return
    }
    if (!selected) return
    setPhase('running')
    setError(null)
    setSaveNote(null)
    setCompareResults([])
    setStatus(`Running the ${selected.name} template.`)
    try {
      const results = await client.run(
        singleRunRequest({
          url,
          templateId: selected.id,
          overrides: sharedOverrides(body === selected.body ? null : body)
        })
      )
      const result = results[0]
      if (!result) throw new Error('The run returned no result. Try again.')
      const listed = await client.listRuns()
      setRuns(listed)
      setCurrentId(result.runId)
      const lines = parsePromptLines(result.modelOutput)
      setChecked(lines?.[0] ? [lines[0].text] : [])
      setStatus('Run finished. This run is not saved.')
    } catch (cause) {
      setError(errorText(cause, 'The run did not finish. Try again.'))
      setStatus('The run did not finish. Nothing was saved.')
    } finally {
      setPhase('idle')
    }
  }

  async function runCompare(): Promise<void> {
    const reason = compareBlockReason(compareIds.length)
    if (reason) {
      setError(reason)
      setStatus(reason)
      return
    }
    setPhase('running')
    setError(null)
    setSaveNote(null)
    setStatus(`Comparing ${compareIds.length} templates.`)
    try {
      const results = await client.run(
        compareRunRequest({
          url,
          templateIds: compareIds,
          overrides: sharedOverrides(null)
        })
      )
      const listed = await client.listRuns()
      setRuns(listed)
      setCompareResults(results)
      const first = results[0]
      if (first) setCurrentId(first.runId)
      setStatus('Compare finished. These runs are not saved.')
    } catch (cause) {
      const message = errorText(cause, '')
      setError(
        message.includes('compare_limit') || message.includes(TEMPLATE_ERROR_MESSAGES.compare_limit)
          ? TEMPLATE_ERROR_MESSAGES.compare_limit
          : message || 'The compare did not finish. Try again.'
      )
      setStatus('The compare did not finish. Nothing was saved.')
    } finally {
      setPhase('idle')
    }
  }

  function toggleCompare(id: string): void {
    const next = toggleCompareId(compareIds, id)
    setCompareIds(next.ids)
    setError(next.error)
  }

  async function checkAio(): Promise<void> {
    if (!current || phase !== 'idle' || checked.length === 0) return
    setPhase('checking')
    setCheckCount(checked.length)
    setError(null)
    setStatus(`Checking ${checked.length} ${checked.length === 1 ? 'question' : 'questions'}.`)
    try {
      const result = await client.checkAio({
        url: current.url,
        prompts: checked,
        market: null,
        runId: current.runId
      })
      const listed = await client.listRuns()
      setRuns(listed)
      setAioByRun((existing) => ({ ...existing, [current.runId]: result }))
      setStatus('AI Overview check finished. This run is not saved.')
    } catch (cause) {
      setError(errorText(cause, 'The AI Overview check did not finish. Try again.'))
      setStatus('The AI Overview check did not finish. Nothing was saved.')
    } finally {
      setPhase('idle')
    }
  }

  function openSave(): void {
    if (!current || !selected) return
    const suggested: PlaygroundSavePart[] = ['pageRead']
    if (selected.kind === 'buyer_profile') suggested.push('buyerProfile')
    if (selected.kind === 'buyer_prompts') suggested.push('prompts')
    if (selected.kind === 'coverage') suggested.push('coverage')
    if (aio) suggested.push('aioChecks')
    setSaveParts(suggested)
    setSaveProjectId(
      saveTargets.some((project) => project.id === projectId)
        ? projectId
        : (saveTargets[0]?.id ?? '')
    )
    setSaveError(null)
    openDrawer('playground-save', { 'pgs.run': current.runId })
  }

  async function confirmSave(): Promise<void> {
    if (!saveRun || saveParts.length === 0) return
    const parts = PLAYGROUND_SAVE_PARTS.filter((part) => saveParts.includes(part))
    const first = parts[0]
    if (!first) return
    setSaving(true)
    setSaveError(null)
    try {
      const result = await client.saveToProject({
        runId: saveRun.runId,
        projectId: saveProjectId,
        parts: [first, ...parts.slice(1)]
      })
      const project = saveTargets.find((item) => item.id === result.projectId)
      const projectName = project?.name ?? result.projectId
      const written =
        result.parts.length === 0
          ? 'Nothing was written. Those parts are not in this run.'
          : `Saved ${result.parts.map((part) => PART_LABELS[part]).join(', ')} to ${projectName}.`
      const skipped = saveParts.filter((part) => !result.parts.includes(part))
      setSaveNote({
        text: written,
        after:
          skipped.length === 0
            ? 'Anything you did not pick is still not saved.'
            : `Skipped ${skipped.map((part) => PART_LABELS[part]).join(', ')} because this run does not contain them.`,
        pageId: result.parts.length === 0 ? null : result.pageId,
        part: firstOpenablePart(result.parts),
        inOpenProject: result.projectId === projectId,
        projectName
      })
      setSaving(false)
      saveDrawer?.close()
      setStatus('Saved the parts you picked. The rest of this playground run is not saved.')
    } catch (cause) {
      setSaving(false)
      setSaveError(errorText(cause, 'Could not save to the project. Try again.'))
    }
  }

  function togglePrompt(text: string): void {
    setChecked((currentChecked) =>
      currentChecked.includes(text)
        ? currentChecked.filter((item) => item !== text)
        : [...currentChecked, text]
    )
  }

  function togglePart(part: PlaygroundSavePart): void {
    setSaveParts((currentParts) =>
      currentParts.includes(part)
        ? currentParts.filter((item) => item !== part)
        : [...currentParts, part]
    )
  }

  if (loading) return <p role="status">Loading the playground…</p>
  if (loadError) {
    return (
      <LoadError
        title="Could not open the playground."
        message={loadError}
        onRetry={() => {
          setLoadError(null)
          setLoading(true)
          setReload((n) => n + 1)
        }}
      />
    )
  }

  return (
    <div className="pg-page">
      <p className="pg-banner">
        Playground runs aren&apos;t saved. They stay in memory for this session, the latest{' '}
        {PLAYGROUND_MEMORY_RUNS}, until you pick parts and save them to a project.
      </p>
      {saveTargets.length === 0 ? (
        <p className="muted">
          You can run templates here without a project. To save a run, first{' '}
          <a href={sectionHash('new-project')}>create a project</a>.
        </p>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {status}
      </p>
      <div className="pg-split">
        <section className="pg-list-col" aria-label="Template list">
          <TemplateList
            templates={templates}
            selectedId={selected?.id ?? null}
            onPick={pickTemplate}
          />
        </section>
        <section className="card pg-main" aria-label="Playground run">
          <div className="tpl-editor-title">
            <h2>{selected?.name ?? 'Playground'}</h2>
            <p className="hint">
              Pick a template, enter any URL, and run. Change the wording and run again. Overrides
              apply to this run only.
            </p>
          </div>
          <label className="field">
            <span className="field-label">URL</span>
            <input
              className="ob-input"
              type="url"
              value={url}
              placeholder="https://example.com/blog/your-page/"
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <div className="grid2">
            <label className="field">
              <span className="field-label">Brand name</span>
              <input
                className="ob-input"
                value={brandName}
                placeholder="Use the page brand"
                onChange={(event) => setBrandName(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">Questions to write</span>
              <input
                className="ob-input mono"
                inputMode="numeric"
                value={promptCount}
                placeholder="10"
                onChange={(event) => setPromptCount(event.target.value)}
              />
            </label>
          </div>
          <label className="field">
            <span className="field-label" id="pg-template-label">
              Template
            </span>
            <textarea
              className="ob-input mono tpl-textarea"
              rows={10}
              aria-labelledby="pg-template-label"
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <fieldset className="tpl-facet">
            <legend>Run</legend>
            <label className="tpl-check">
              <input
                type="radio"
                name="playground-run-mode"
                checked={runMode === 'one'}
                onChange={() => {
                  setRunMode('one')
                  setError(null)
                }}
              />
              <span>One template</span>
            </label>
            <label className="tpl-check">
              <input
                type="radio"
                name="playground-run-mode"
                checked={runMode === 'compare'}
                onChange={() => {
                  setRunMode('compare')
                  setError(null)
                }}
              />
              <span>Compare</span>
            </label>
          </fieldset>
          {runMode === 'compare' ? (
            <ComparePicker
              templates={templates}
              kind={compareKind}
              ids={compareIds}
              onKind={(next) => {
                setCompareKind(next)
                setCompareIds([])
                setError(null)
              }}
              onToggle={toggleCompare}
            />
          ) : null}
          <div className="tpl-actions">
            <Button
              variant="primary"
              disabled={phase !== 'idle' || (runMode === 'one' && !selected)}
              aria-describedby={runMode === 'compare' ? 'compare-hint' : undefined}
              onClick={() => void run()}
            >
              {runMode === 'compare' ? 'Compare' : 'Run'}
            </Button>
            <span className="faint" id="compare-hint">
              {runMode === 'compare'
                ? 'Pick 1 to 3 templates of one kind. Nothing is written to a project.'
                : 'Nothing is written to a project.'}
            </span>
          </div>
          {error ? (
            <p className="field-error" role="alert">
              <Icon name="warning" size="chev" />
              {error}
            </p>
          ) : null}
          {phase !== 'idle' ? (
            <section className="pg-progress" aria-label="Progress">
              <h2>
                {phase === 'checking'
                  ? `Checking ${checkCount} ${checkCount === 1 ? 'question' : 'questions'}`
                  : `Running ${selected?.name ?? 'template'}`}
              </h2>
              <div className="usage">
                <div
                  className="pg-bar"
                  role="progressbar"
                  aria-label={phase === 'checking' ? 'Questions checked' : 'Running the template'}
                >
                  <span />
                </div>
                <span>{status}</span>
              </div>
            </section>
          ) : null}
          {compareResults.length === 0 && !current ? (
            <p>Pick a template, enter any URL, and run. Playground runs aren&apos;t saved.</p>
          ) : null}
          {compareResults.length === 0 && current ? (
            <RunOutput
              run={current}
              promptLines={promptLines}
              coverage={coverage}
              profile={profile}
              checked={checked}
              onTogglePrompt={togglePrompt}
              onCheck={() => void checkAio()}
              checking={phase === 'checking'}
              aio={aio}
              onSave={openSave}
              saveNote={saveNote}
            />
          ) : null}
        </section>
      </div>
      {compareResults.length > 0 ? (
        <div className="pg-compare">
          {compareResults.map((run) => (
            <CompareColumn key={run.runId} run={run} />
          ))}
        </div>
      ) : null}
      <RunHistory
        runs={history}
        currentId={currentId}
        onOpen={(run) => {
          setCurrentId(run.runId)
          setCompareResults([])
        }}
      />
      {saveDrawer ? (
        <DrawerLevel depth={saveDrawer.depth}>
          <SaveDrawer
            labels={PART_LABELS}
            found={saveRun !== null}
            parts={saveParts}
            onTogglePart={togglePart}
            projectId={saveProjectId}
            onProject={setSaveProjectId}
            targets={saveTargets}
            busy={saving}
            error={saveError}
            onClose={() => saveDrawer.close()}
            onConfirm={() => void confirmSave()}
          />
        </DrawerLevel>
      ) : null}
    </div>
  )
}
