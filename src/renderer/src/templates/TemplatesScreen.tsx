import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import {
  templateKindInfo,
  type GenerationTemplate,
  type GenerationTemplateKind
} from '@shared/domain'
import type { TemplateStep } from '@shared/ipc'
import type { AssistClient } from '../assist/client'
import { useAiContext } from '../assistant/context/useAiContext'
import { LoadError } from '../components/LoadError'
import { DrillHost } from '../drill'
import type { TemplatesClient } from './client'
import { AppTemplates } from './components/AppTemplates'
import { StepGrid, type StepStatusFilter } from './components/StepGrid'
import { STEP_STATUS_LABEL } from './utils/stepCopy'
import { StepWorkspace } from './components/StepWorkspace'
import { useAppLibrary } from './hooks/useAppLibrary'
import { useRouteFocus } from './hooks/useRouteFocus'
import { useStepDrills } from './hooks/useStepDrills'
import { useSteps } from './hooks/useSteps'
import { useHashQuery } from '../utils/hashQuery'
import { Confirm, Tabs, TabPanel, type TabItem } from '../ui'
import './templates.css'

type TemplatesTab = 'steps' | 'editor' | 'library'

const TEMPLATES_QUERY = ['view', 'step'] as const

function isTemplatesTab(value: string | null): value is TemplatesTab {
  return value === 'steps' || value === 'editor' || value === 'library'
}

const PANELS = 'tpl-tabs'

/**
 * Templates (FR-26.1 to FR-26.8, TPL-1 to TPL-5): every Claude step in run order,
 * the selected step's editor, and the named app templates for that step.
 * With a project open, a save makes a project version; without one, the app
 * templates every project shares are edited. `#/templates/<id>` opens that
 * app template under its step; the open tab and step are on the route
 * (`?view=editor&step=<kind>`). Versions, last runs and usage counts drill.
 */
export function TemplatesScreen(props: {
  client: TemplatesClient
  projectId: string | null
  /** Tests pass one. The screen otherwise uses the assist client for the current mode. */
  assistClient?: AssistClient
  /** App template to open. Omitted: read from `#/templates/<id>`. */
  focusId?: string | null
}): JSX.Element {
  return (
    <DrillHost>
      <TemplatesBody {...props} />
    </DrillHost>
  )
}

function TemplatesBody({
  client,
  projectId,
  assistClient,
  focusId: givenFocus
}: {
  client: TemplatesClient
  projectId: string | null
  assistClient?: AssistClient
  focusId?: string | null
}): JSX.Element {
  const { steps, loading, error, reload, replace } = useSteps(client, projectId)
  const [query, setQuery] = useHashQuery(TEMPLATES_QUERY)
  const pickedKind = query.step as GenerationTemplateKind | null
  const [status, setStatus] = useState<StepStatusFilter>('all')
  const [stepDirty, setStepDirty] = useState(false)
  const [pendingSwitch, setPendingSwitch] = useState<GenerationTemplateKind | null>(null)
  const [revision, setRevision] = useState(0)
  const [afterSwitch, setAfterSwitch] = useState<TemplatesTab>('editor')

  const step = steps.find((item) => item.kind === pickedKind) ?? steps[0] ?? null
  const kind = step?.kind ?? 'buyer_profile'

  const reloadSteps = useCallback(() => {
    void reload().catch(() => undefined)
  }, [reload])

  const library = useAppLibrary({ client, kind, projectId, revision, onChanged: reloadSteps })
  const drills = useStepDrills(client, projectId)
  const focusId = useRouteFocus('templates', givenFocus)
  // The open tab and step are on the route: `#/templates?view=editor&step=buyer_profile`.
  const tab: TemplatesTab = isTemplatesTab(query.view)
    ? query.view
    : focusId !== null
      ? 'library'
      : 'steps'
  const viewValue = useCallback(
    // Steps is the plain route, unless a focused template would open App templates instead.
    (next: TemplatesTab) => (next === 'steps' && focusId === null ? null : next),
    [focusId]
  )
  const setTab = useCallback(
    (next: TemplatesTab) => setQuery({ view: viewValue(next) }),
    [setQuery, viewValue]
  )
  const [pendingFocus, setPendingFocus] = useState<GenerationTemplate | null>(null)

  // `#/templates/<id>`: open that template's step, then select it under App templates.
  useEffect(() => {
    if (focusId === null) return
    let cancelled = false
    client.get({ id: focusId }).then(
      (template) => {
        if (cancelled) return
        setPendingFocus(template)
        setQuery({ step: template.kind, view: 'library' }, { replace: true })
      },
      () => undefined
    )
    return () => {
      cancelled = true
    }
  }, [client, focusId, setQuery])

  // Once that step's app templates are loaded, select the focused one (render-time, like
  // the library's own "new step opens its default").
  if (pendingFocus && !library.loading && pendingFocus.kind === kind) {
    setPendingFocus(null)
    const found = library.live.find((item) => item.id === pendingFocus.id)
    if (found) library.fill(found)
  }

  const selectedAppId = library.selected?.id ?? null
  const scrolledFor = useRef<string | null>(null)
  useEffect(() => {
    if (focusId === null || selectedAppId !== focusId || scrolledFor.current === focusId) return
    scrolledFor.current = focusId
    requestAnimationFrame(() => {
      document.getElementById('tpl-library-h')?.scrollIntoView?.({ block: 'start' })
    })
  }, [focusId, selectedAppId])

  const onAppChanged = useCallback(async () => {
    const list = await reload()
    setRevision((current) => current + 1)
    return list
  }, [reload])

  const onDirty = useCallback((dirty: boolean) => setStepDirty(dirty), [])

  useAiContext({
    entities: [
      ...(step
        ? [
            {
              kind: 'template' as const,
              id: step.kind,
              label: templateKindInfo(step.kind).label,
              detail: STEP_STATUS_LABEL[step.status]
            }
          ]
        : []),
      ...(tab === 'library' && library.selected
        ? [
            {
              kind: 'template' as const,
              id: library.selected.id,
              label: library.selected.name,
              detail: 'App template'
            }
          ]
        : [])
    ],
    filters: {
      view: tab === 'steps' ? 'Steps' : tab === 'editor' ? 'Editor' : 'App templates',
      status: status === 'all' ? '' : STEP_STATUS_LABEL[status]
    },
    numbers: [{ label: 'AI steps', value: String(steps.length) }],
    facts: [
      projectId
        ? 'Edits apply to the open project only.'
        : 'No project open: edits change the app templates.',
      ...(stepDirty || library.dirty ? ['Unsaved changes'] : [])
    ]
  })

  /** Selects a step, then shows `then` (its editor or its app templates). */
  function select(next: TemplateStep, then: TemplatesTab): void {
    if (next.kind === kind) {
      setTab(then)
      return
    }
    if (stepDirty || library.dirty) {
      setAfterSwitch(then)
      setPendingSwitch(next.kind)
      return
    }
    switchTo(next.kind, then)
  }

  function switchTo(next: GenerationTemplateKind, then: TemplatesTab): void {
    setStepDirty(false)
    setQuery({ step: next, view: viewValue(then) })
  }

  function duplicateShipped(): void {
    if (!step) return
    library.openDuplicate(step.shipped)
    setTab('library')
    requestAnimationFrame(() => {
      const region = document.getElementById('tpl-library-h')
      region?.scrollIntoView({ block: 'start' })
      document.querySelector<HTMLInputElement>('.tpl-library input.ob-input')?.focus()
    })
  }

  if (loading) return <p role="status">Loading templates…</p>
  if (error) {
    return (
      <LoadError
        title="Could not load templates."
        message={error}
        onRetry={() => void reload().catch(() => undefined)}
      />
    )
  }

  const stepLabel = step ? templateKindInfo(step.kind).label : null
  const tabs: TabItem<TemplatesTab>[] = [
    { id: 'steps', label: 'Steps', count: steps.length },
    { id: 'editor', label: stepLabel ? `Edit · ${stepLabel}` : 'Editor' },
    {
      id: 'library',
      label: 'App templates',
      count: library.loading ? undefined : library.live.length
    }
  ]

  return (
    <div className="tpl-page">
      <p className="muted tpl-lead">
        Every AI step runs from a template you can rewrite.{' '}
        {projectId
          ? 'Your edits apply to this project only; the default stays available.'
          : 'Open a project to give it its own version of a step.'}
      </p>
      <Tabs label="Template sections" tabs={tabs} value={tab} onChange={setTab} panelId={PANELS} />

      <TabPanel panelId={PANELS} id="steps" hidden={tab !== 'steps'} className="tpl-panel">
        <StepGrid
          steps={steps}
          status={status}
          selectedKind={step?.kind ?? null}
          dirtyKind={stepDirty ? kind : null}
          projectOpen={projectId !== null}
          onStatus={setStatus}
          onOpen={(item) => select(item, 'editor')}
          onLibrary={(item) => select(item, 'library')}
          onVersions={(item) => void drills.openVersions(item)}
          onCalls={(item) => void drills.openCalls(item)}
        />
      </TabPanel>

      <TabPanel panelId={PANELS} id="editor" hidden={tab !== 'editor'} className="tpl-panel">
        {step ? (
          <StepWorkspace
            key={step.kind}
            client={client}
            assistClient={assistClient}
            projectId={projectId}
            step={step}
            onStep={replace}
            onAppChanged={onAppChanged}
            onDirty={onDirty}
            onDuplicate={duplicateShipped}
            onVersions={() => void drills.openVersions(step)}
            onCalls={() => void drills.openCalls(step)}
          />
        ) : (
          <p className="muted">No AI steps to show.</p>
        )}
      </TabPanel>

      <TabPanel panelId={PANELS} id="library" hidden={tab !== 'library'} className="tpl-panel">
        {step ? (
          <AppTemplates
            kind={kind}
            library={library}
            projectOpen={projectId !== null}
            onUsage={(template) =>
              void drills.openUsage(
                template,
                library.scope === 'project' && projectId ? projectId : null
              )
            }
          />
        ) : null}
      </TabPanel>

      {drills.error ? (
        <p className="field-error" role="alert">
          {drills.error}
        </p>
      ) : null}

      {pendingSwitch ? (
        <Confirm
          title="Discard unsaved changes?"
          body="You have unsaved changes. Discard them?"
          confirmLabel="Discard"
          onCancel={() => setPendingSwitch(null)}
          onConfirm={() => {
            const next = pendingSwitch
            setPendingSwitch(null)
            switchTo(next, afterSwitch)
          }}
        />
      ) : null}
    </div>
  )
}
