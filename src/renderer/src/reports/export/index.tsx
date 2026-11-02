import { useCallback, useMemo, useState, type JSX } from 'react'
import type { Market } from '@shared/domain'
import { useAiContext } from '../../assistant/context/useAiContext'
import type { ProjectDetail } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { ScreenHeader } from '../../components/Header'
import { DrillHost } from '../../drill'
import { describeScope, useScopeOptions, type ScopeSource } from '../../scope'
import { DrawerLevel } from '../../shell/DrawerLevel'
import { drawerHref, useDrawerStack } from '../../shell/drawers'
import { landingHash, pageHash, sectionHash } from '../../shell/routes'
import { EmptyState, LinkButton, RightRail } from '../../ui'
import { useHashQuery } from '../../utils/hashQuery'
import { blockedExportPreview, type ReportsClient } from '../client'
import type { SchedulesClient } from '../schedulesClient'
import { userTimeZone } from '../scheduleModel'
import { ScheduleDrawer } from '../schedules/drawer/ScheduleDrawer'
import { useSchedulesData } from '../schedules/drawer/useSchedulesData'
import { openNewSchedule, scheduleHref, SCHEDULE_DRAWER } from '../schedules/utils/scheduleUrl'
import { FORMAT_SHORT, saveLabel } from './formats'
import { AutoExportCard } from './components/AutoExportCard'
import { FormatCard } from './components/FormatCard'
import { IncludeCard } from './components/IncludeCard'
import { SectionsCard } from './components/SectionsCard'
import { SummaryPanel } from './components/SummaryPanel'
import { useAutoExport } from './hooks/useAutoExport'
import { useExportMarkets } from './hooks/useExportMarkets'
import { useExportPreview } from './hooks/useExportPreview'
import { useExportRun } from './hooks/useExportRun'
import {
  ALL_MARKETS,
  buildExportRequest,
  countLabel,
  defaultExportForm,
  type ExportBuildSource,
  type ExportForm
} from './model'
import { resolveExportScope, scheduleSeed } from './utils/scope'
import {
  EXPORT_URL_KEYS,
  formFromUrl,
  marketFromUrl,
  pushesHistory,
  urlPatch,
  type ExportUrlFields
} from './utils/urlState'
import '../../m3/m3.css'
import '../reports.css'

const NO_PAGES: readonly ExportSubject[] = []
const NO_PROJECTS: readonly ProjectDetail[] = []

/** The form fields kept on the URL; every other field stays in the screen. */
const URL_FIELDS: readonly (keyof ExportUrlFields)[] = [
  'scope',
  'ids',
  'format',
  'sections',
  'checks',
  'from',
  'to'
]

/** A page or topic the export can be built for. Topics have no URL. */
export interface ExportSubject {
  id: string
  label: string
  /** `topic` for a topic subject (`pages.kind`). Absent is a page. */
  kind?: 'page' | 'topic'
}

const NO_PROJECT_PREVIEW = blockedExportPreview(
  'No project yet.',
  'Create a project, then open Export again.'
)

/**
 * Export a report (route `#/export`, Mockups/Export.dc.html). Builds an `ExportRequest`
 * with v2 section ids, previews it through `exports:preview`, and writes it through
 * `exports:start`. Main opens the save dialog. The scope, format, sections, market and
 * data window live on the URL, so a copied link reproduces the form; "Schedule this"
 * opens the schedule drawer with the same scope and sections.
 */
export function ExportScreen({
  client,
  project = null,
  pages = NO_PAGES,
  initialPageId = null,
  initialMarketId = null,
  readPage,
  schedulesClient = null,
  projects = NO_PROJECTS,
  scopeSource = null
}: {
  client: ReportsClient
  /** Current project from `projects:list` / `projects:get`. Null shows the empty state. */
  project?: { id: string; name: string; defaultMarket: Market | null } | null
  /** Working pages from `pages:list`. */
  pages?: readonly ExportSubject[]
  /** The page the user came from (old links). The URL's `page` wins. */
  initialPageId?: string | null
  /** The market that page was showing (old links). The URL's `mk` wins. */
  initialMarketId?: string | null
  /** `pages:get`, used for that page's markets. */
  readPage?: (pageId: string) => Promise<{ markets: readonly Market[] }>
  /** Saves "Schedule this" in place. Null: it opens the drawer over Reports instead. */
  schedulesClient?: SchedulesClient | null
  /** Every project, for the schedule drawer's Project choice. */
  projects?: readonly ProjectDetail[]
  /** Tests only: where the scope pickers read pages, groups and topics. */
  scopeSource?: ScopeSource | null
}): JSX.Element {
  const [url, setUrl] = useHashQuery(EXPORT_URL_KEYS)
  const [local, setLocal] = useState<ExportForm>(() => defaultExportForm())
  const defaults = useMemo(() => defaultExportForm(), [])
  const [savedSchedule, setSavedSchedule] = useState<{ id: string; name: string } | null>(null)
  const form = useMemo<ExportForm>(
    () => ({ ...local, ...formFromUrl(url, defaults) }),
    [local, url, defaults]
  )

  const pageChoice = url.page ?? initialPageId
  const pageId =
    pageChoice && pages.some((page) => page.id === pageChoice) ? pageChoice : (pages[0]?.id ?? null)
  const currentPage = pages.find((page) => page.id === pageId) ?? null
  const setPage = useCallback((id: string) => setUrl({ page: id }, { replace: true }), [setUrl])

  const projectId = project?.id ?? ''
  const scope = useScopeOptions(project?.id ?? null, scopeSource)
  const scopeOptions = scope.options?.projectId === project?.id ? scope.options : null
  const resolved = useMemo(() => resolveExportScope(form, scopeOptions), [form, scopeOptions])
  const hasTopic =
    form.scope === 'page'
      ? currentPage?.kind === 'topic'
      : form.scope === 'topic'
        ? resolved.length > 0
        : form.scope === 'project'
          ? pages.some((page) => page.kind === 'topic') || (scopeOptions?.topics.length ?? 0) > 0
          : false

  const marketControl = useMemo(
    () => ({
      choice: url.mk ?? url.market ?? initialMarketId ?? ALL_MARKETS,
      onChoice: (choice: string) =>
        setUrl({ mk: choice === ALL_MARKETS ? null : choice, market: null }, { replace: true })
    }),
    [url.mk, url.market, initialMarketId, setUrl]
  )
  const markets = useExportMarkets(
    project,
    form.scope === 'page' ? pageId : null,
    readPage,
    null,
    marketControl,
    scopeOptions?.markets ?? null
  )

  const source = useMemo<ExportBuildSource>(
    () => ({ projectId, pageId, marketIds: markets.marketIds, hasTopic, pageIds: resolved }),
    [projectId, pageId, markets.marketIds, hasTopic, resolved]
  )
  const request = useMemo(
    () => (project ? buildExportRequest(form, source) : null),
    [project, form, source]
  )

  const patch = useCallback(
    (partial: Partial<ExportForm>) => {
      const toUrl: Partial<ExportUrlFields> = {}
      const toLocal: Partial<ExportForm> = {}
      for (const [key, value] of Object.entries(partial) as [keyof ExportForm, never][]) {
        if ((URL_FIELDS as readonly string[]).includes(key)) {
          ;(toUrl as Record<string, unknown>)[key] = value
        } else {
          ;(toLocal as Record<string, unknown>)[key] = value
        }
      }
      if (Object.keys(toLocal).length > 0) setLocal((current) => ({ ...current, ...toLocal }))
      if (Object.keys(toUrl).length > 0) {
        setUrl(urlPatch(toUrl), { replace: !pushesHistory(toUrl) })
      }
    },
    [setUrl]
  )

  const livePreview = useExportPreview(client, request)
  const preview = project ? livePreview : NO_PROJECT_PREVIEW
  const run = useExportRun(client, request)
  const auto = useAutoExport(
    client,
    project,
    form.scope === 'page' ? pageId : null,
    form,
    source,
    patch
  )
  const ready = preview !== null && !preview.blocked

  const { stack } = useDrawerStack()
  const scheduleOpen = stack.some((entry) => entry.id === SCHEDULE_DRAWER)
  const schedules = useSchedulesData(schedulesClient, scheduleOpen && schedulesClient !== null)

  const marketText =
    markets.markets.length === 0
      ? 'No markets yet'
      : markets.choice === ALL_MARKETS
        ? markets.markets.length === 1
          ? (markets.markets[0]?.label ?? '')
          : `All markets (${markets.markets.length})`
        : (markets.markets.find((market) => market.id === markets.choice)?.label ?? '')

  useAiContext({
    entities:
      form.scope === 'page' && currentPage
        ? [
            {
              kind: currentPage.kind === 'topic' ? 'topic' : 'page',
              id: currentPage.id,
              label: currentPage.label
            }
          ]
        : [],
    filters: {
      scope: scopeText(form, currentPage, pages.length, resolved.length, scopeOptions),
      markets: marketText,
      checks: windowText(form),
      format: FORMAT_SHORT[form.format]
    },
    numbers: [
      {
        label: 'Sections included',
        value: String(Object.values(form.sections).filter(Boolean).length)
      },
      { label: 'Tracked pages', value: String(pages.length) }
    ],
    facts: [
      ...(preview?.blocked ? ['The export cannot be built yet.'] : []),
      ...(form.auto ? ['Automatic export is on.'] : [])
    ]
  })

  function scheduleThis(): void {
    if (!project) return
    const seed = scheduleSeed(form, {
      projectId: project.id,
      pageId,
      pageIsTopic: currentPage?.kind === 'topic',
      resolved,
      hasTopic,
      market: marketFromUrl(url) === ALL_MARKETS ? null : markets.choice
    })
    setSavedSchedule(null)
    if (schedulesClient) openNewSchedule(seed)
    else window.location.hash = drawerHref(SCHEDULE_DRAWER, seed, sectionHash('reports'))
  }

  return (
    <DrillHost>
      <div className="xpt">
        <ScreenHeader
          nav={{
            back: currentPage
              ? { href: pageHash(currentPage.id), label: currentPage.label }
              : { href: landingHash(), label: project ? project.name : 'Back' }
          }}
          title="Export a report"
          subtitle={
            <p className="section-subtitle">
              Choose what goes in and pick a format. The file is saved on this computer.
            </p>
          }
          primary={{
            label: saveLabel(form.format),
            icon: 'download',
            disabled: !project || !ready || run.busy,
            busy: run.busy,
            onClick: () => void run.start()
          }}
          more={[
            {
              id: 'schedule-this',
              label: 'Schedule this',
              icon: 'refresh',
              disabled: !project || !ready,
              onSelect: scheduleThis
            }
          ]}
        />

        {savedSchedule ? (
          <p className="xpt-saved-schedule" role="status">
            Saved “{savedSchedule.name}”. It sends from now on;{' '}
            <a href={scheduleHref(savedSchedule.id)}>see it in Reports</a>.
          </p>
        ) : null}

        {project ? null : (
          <div className="ui-panel xpt-empty">
            <EmptyState
              title="No project yet"
              body="Exports are built from a project's checks."
              level={2}
              action={
                <LinkButton size="sm" href={sectionHash('new-project')}>
                  New project
                </LinkButton>
              }
            />
          </div>
        )}

        <div className="xpt-cols">
          <SummaryPanel
            hasTopic={hasTopic}
            form={form}
            preview={preview}
            scopeText={scopeText(form, currentPage, pages.length, resolved.length, scopeOptions)}
            marketText={marketText}
            windowText={windowText(form)}
            run={run}
            onCancel={() => {
              setLocal(defaultExportForm())
              setUrl(
                Object.fromEntries(
                  EXPORT_URL_KEYS.filter((key) => key !== 'page').map((key) => [key, null])
                )
              )
            }}
            onReveal={(filePath) => client.revealExport(filePath)}
          />
          <RightRail label="Export options">
            <IncludeCard
              form={form}
              onPatch={patch}
              pages={pages}
              pageId={pageId}
              onPage={setPage}
              markets={markets}
              hasProject={project !== null}
              scope={{
                options: scopeOptions,
                error: scope.error,
                onRetry: scope.reload,
                resolved,
                query: url.pq ?? '',
                onQuery: (query) => setUrl({ pq: query || null }, { replace: true })
              }}
            />
            <SectionsCard form={form} onPatch={patch} hasTopic={hasTopic} />
            <FormatCard form={form} onPatch={patch} />
            {/* Hidden only in a build that cannot store automatic exports (`unavailable`). */}
            {auto.unavailable === null ? (
              <AutoExportCard form={form} onPatch={patch} auto={auto} />
            ) : null}
          </RightRail>
        </div>
      </div>
      {schedulesClient
        ? stack.map((entry, depth) =>
            entry.id === SCHEDULE_DRAWER ? (
              <DrawerLevel key={`${depth}:${entry.id}`} depth={depth}>
                <ScheduleDrawer
                  depth={depth}
                  params={entry.params}
                  client={schedulesClient}
                  data={{
                    items: schedules.items,
                    deliveries: schedules.deliveries,
                    accounts: schedules.accounts,
                    projects,
                    timeZone: userTimeZone(),
                    loaded: schedules.loaded
                  }}
                  currentProjectId={project?.id ?? null}
                  reload={schedules.reload}
                  onSaved={(row) => setSavedSchedule({ id: row.id, name: row.name })}
                  scopeSource={scopeSource}
                />
              </DrawerLevel>
            ) : null
          )
        : null}
    </DrillHost>
  )
}

function scopeText(
  form: ExportForm,
  currentPage: ExportSubject | null,
  pageCount: number,
  resolvedCount: number,
  options: Parameters<typeof describeScope>[1]
): string {
  if (form.scope === 'page') return `This page${currentPage ? ` · ${currentPage.label}` : ''}`
  if (form.scope === 'project') return `Whole project · ${countLabel(pageCount, 'tracked page')}`
  const named = describeScope({ kind: form.scope, ids: form.ids }, options)
  // "Pages I pick" already says "2 pages": no second count.
  if (form.scope === 'pages') return `Pages I pick · ${named}`
  return `${named} · ${pluralize(resolvedCount, form.scope === 'topic' ? 'topic' : 'page')}`
}

function windowText(form: ExportForm): string {
  if (form.checks === 'latest') return 'Latest check'
  if (form.checks === 'all') return 'Every check'
  return `${form.from || '…'} to ${form.to || '…'}`
}
