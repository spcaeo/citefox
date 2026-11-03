import { lazy, Suspense, useEffect, useMemo, type JSX } from 'react'
import type { ImportRow } from '@shared/ipc'
import { isImportEntity } from '@shared/import-fields'
import {
  AddPageForTarget,
  AddQuestionsDialog,
  ImportQuestionsDrawer,
  isAddTab
} from '../addQuestions'
import { useBuildTools } from '../buildMenu/buildClient'
import { botParam, wayParam } from '../ui'
import { ImportDrawer } from '../importFlow/ImportDrawer'
import { isImportFilter, isImportStep } from '../importFlow/model'
import { createImportSource } from '../importFlow/source'
import { PAGES_DRAWERS } from '../structure/drawers'
import { createIpcShellClient, type ShellClient } from '../projects/client'
import { MoveDrawerFromUrl, QuestionDrawerFromUrl, setQuestionProject } from '../questionEdit'
import { ActivityDrawer } from '../start/ActivityPanel'
import { DrawerLevel } from './DrawerLevel'
import type { DrawerEntry, DrawerId } from './drawerUrl'
import {
  closeDrawer,
  closeDrawersThen,
  hasDrawerResult,
  openDrawer,
  setDrawerParams,
  useDrawerStack
} from './drawers'
import { AddKeyDrawer } from './pickerDrawers/AddKeyDrawer'
import { keyProviderOf } from './pickerDrawers/model'
import { TrackPageDrawer } from './pickerDrawers/TrackPageDrawer'
import { pageHash, topicHash, topicsHash } from './routes'
import { TRANSFER_DRAWERS } from '../transfer/drawers'

interface ShellDrawerContext {
  entry: DrawerEntry
  depth: number
  projectId: string
  /** The drawer under this one, if any. */
  below: DrawerEntry | null
  /** A page was added (Add a page): the shell refreshes its lists, then opens it. */
  onPageAdded: (pageId: string) => void
  client: ShellClient
  /** After a page is added: the sidebar and lists read the pages again. */
  onPagesChanged: () => void
  /** After a key is added: key pickers read the keys again. */
  onKeysChanged: () => void
}

const AskDrawer = lazy(() =>
  import('../assistant/drawer/AskDrawer').then((module) => ({ default: module.AskDrawer }))
)

const HelpDrawer = lazy(() =>
  import('../help/HelpDrawer').then((module) => ({ default: module.HelpDrawer }))
)

const ReportProblem = lazy(() =>
  import('../diagnostics/ReportProblemDrawer').then((module) => ({
    default: module.ReportProblemDrawer
  }))
)

const TopicSettings = lazy(() =>
  import('../topics/settings').then((module) => ({ default: module.TopicSettingsHost }))
)

const AddMarket = lazy(() =>
  import('../projectMarkets/AddMarketHost').then((module) => ({ default: module.AddMarketHost }))
)

const Competitor = lazy(() =>
  import('../competitors/drawer/CompetitorDrawer').then((module) => ({
    default: module.CompetitorDrawer
  }))
)

const Fix = lazy(() =>
  import('../fixes/drawer/FixDrawer').then((module) => ({ default: module.FixDrawer }))
)
const PageFix = lazy(() =>
  import('../fixes/todo/PageFixHost').then((module) => ({ default: module.PageFixHost }))
)
const PageChange = lazy(() =>
  import('../pageChanges/PageChangeDrawer').then((module) => ({
    default: module.PageChangeDrawer
  }))
)
const PageChanges = lazy(() =>
  import('../pageChanges/PageChangesDrawer').then((module) => ({
    default: module.PageChangesDrawer
  }))
)
const Pitch = lazy(() =>
  import('../citations/pitch/PitchDrawer').then((module) => ({ default: module.PitchDrawer }))
)
const NewTopic = lazy(() =>
  import('../topics/newTopic').then((module) => ({ default: module.NewTopicDialog }))
)
const CheckNow = lazy(() =>
  import('../checkNow').then((module) => ({ default: module.CheckNowDrawer }))
)
const SiteTypes = lazy(() =>
  import('../siteTypes/SiteTypesDrawer').then((module) => ({ default: module.SiteTypesDrawer }))
)
const AddPage = lazy(() =>
  import('../addPage').then((module) => ({ default: module.AddPageDrawer }))
)

/** Where Add questions' rows go: `topic=`, `page=` or the older `target=`. */
function addTarget(params: DrawerEntry['params'] | undefined): string | null {
  return params?.topic ?? params?.page ?? params?.target ?? null
}

function AddQuestionsLevel({ entry, depth, projectId }: ShellDrawerContext): JSX.Element {
  const params = entry.params
  const kindHint = params.topic ? 'topic' : params.page ? 'page' : null
  return (
    <AddQuestionsDialog
      projectId={projectId}
      targetId={addTarget(params)}
      kindHint={kindHint}
      tab={isAddTab(params.tab) ? params.tab : 'type'}
      onTab={(tab) =>
        setDrawerParams(depth, { tab: tab === 'type' ? null : tab, help: null, bot: null })
      }
      help={wayParam(params.help)}
      bot={botParam(params.bot)}
      // A way is a history entry (Back returns to the other way); a bot is rewritten in place.
      onHelp={(way) => setDrawerParams(depth, { help: way }, { push: true })}
      onBot={(bot) => setDrawerParams(depth, { bot })}
      match={{
        open: params.match === '1',
        way: wayParam(params.mhelp),
        bot: botParam(params.mbot),
        // Opening and picking a way are history entries; a bot is rewritten in place.
        onOpen: (open) =>
          setDrawerParams(depth, open ? { match: '1' } : { match: null, mhelp: null, mbot: null }, {
            push: true
          }),
        onWay: (way) => setDrawerParams(depth, { mhelp: way }, { push: true }),
        onBot: (bot) => setDrawerParams(depth, { mbot: bot })
      }}
      onTarget={(id, kind) =>
        setDrawerParams(depth, {
          topic: kind === 'topic' ? id : null,
          page: kind === 'page' ? id : null,
          target: null
        })
      }
      onClose={() => closeDrawer(depth)}
      onNewTopic={(receive) =>
        openDrawer(
          'new-topic',
          {},
          {
            // The new topic comes back picked as where the questions go.
            onResult: (topicId) => {
              if (typeof topicId === 'string') receive(topicId)
            }
          }
        )
      }
      onImport={(receive) =>
        openDrawer(
          'import',
          { 'import.entity': 'questions' },
          {
            onResult: (rows) => {
              if (Array.isArray(rows)) receive(rows as ImportRow[])
            }
          }
        )
      }
      onAddPage={(receive) =>
        openDrawer(
          'add-page',
          {},
          {
            onResult: (url) => {
              if (typeof url === 'string') receive(url)
            }
          }
        )
      }
    />
  )
}

function ImportLevel({ entry, depth, projectId, below }: ShellDrawerContext): JSX.Element | null {
  const tools = useBuildTools()
  const params = entry.params
  const entity = isImportEntity(params['import.entity']) ? params['import.entity'] : 'questions'
  const step = isImportStep(params['import.step']) ? params['import.step'] : 'choose'
  const filter = isImportFilter(params['import.f']) ? params['import.f'] : 'all'
  const onStep = (next: typeof step): void =>
    setDrawerParams(depth, { 'import.step': next === 'choose' ? null : next })
  const onFilter = (next: typeof filter): void =>
    setDrawerParams(depth, { 'import.f': next === 'all' ? null : next })
  const targetId = params['import.target'] ?? addTarget(below?.params)
  const source = useMemo(() => createImportSource(), [])
  if (entity === 'questions') {
    return (
      <ImportQuestionsDrawer
        projectId={projectId}
        targetId={targetId}
        step={step}
        filter={filter}
        onStep={onStep}
        onFilter={onFilter}
        onClose={() => closeDrawer(depth)}
        onReturn={(rows) => closeDrawer(depth, rows)}
      />
    )
  }
  // Pages go back to Import pages, which reads and adds them; the rest are added here.
  return (
    <ImportDrawer
      projectId={projectId}
      entity={entity}
      targetId={targetId}
      step={step}
      filter={filter}
      onStep={onStep}
      onFilter={onFilter}
      onClose={() => closeDrawer(depth)}
      mode={entity === 'pages' ? 'return' : 'commit'}
      help={{
        open: params['import.help'] !== undefined,
        way: wayParam(params['import.help']),
        bot: botParam(params['import.bot']),
        // Opening the helper and picking a way are history entries; a bot is rewritten in place.
        onOpen: (open) =>
          setDrawerParams(
            depth,
            open ? { 'import.help': '1' } : { 'import.help': null, 'import.bot': null },
            { push: true }
          ),
        onWay: (way) => setDrawerParams(depth, { 'import.help': way }, { push: true }),
        onBot: (bot) => setDrawerParams(depth, { 'import.bot': bot })
      }}
      onReturn={(rows) => closeDrawer(depth, rows)}
      onCommitted={(result) => {
        const batchId = result.batchId
        tools.notify(
          result.message,
          'ok',
          undefined,
          batchId === null
            ? undefined
            : {
                label: 'Undo',
                onClick: () => {
                  source['import:undo']({ projectId, batchId }).then(
                    (undone) => tools.notify(undone.message, 'ok'),
                    () => tools.notify('Could not undo the import.', 'bad')
                  )
                }
              }
        )
        closeDrawer(depth, result)
      }}
      source={source}
    />
  )
}

/**
 * The drawers the shell owns: they open over any route, so no screen draws
 * them. Screens draw their own drawers (a drill list, Compare content) from
 * `useDrawerStack()` inside a `DrawerLevel`. Add a row here for a new
 * window-wide drawer (Docs/DRAWER.md).
 */
const SHELL_DRAWERS: Partial<
  Record<DrawerId, (context: ShellDrawerContext) => JSX.Element | null>
> = {
  // All pages and Site structure: cluster, group, pick-pages, move-pages, rename-page.
  ...PAGES_DRAWERS,
  'add-questions': (context) => <AddQuestionsLevel {...context} />,
  import: (context) => <ImportLevel {...context} />,
  // Over Add questions, Add a page hands its URL back to the questions underneath;
  // anywhere else it is the full Add a page (tracking), which saves and opens the page.
  'add-page': ({ entry, depth, projectId, below, onPageAdded }) =>
    below?.id === 'add-questions' ? (
      <AddPageForTarget
        projectId={projectId}
        targetId={addTarget(below.params)}
        url={entry.params['addpage.url'] ?? ''}
        label={entry.params['addpage.label'] ?? ''}
        onChange={(patch) =>
          setDrawerParams(depth, {
            ...(patch.url !== undefined ? { 'addpage.url': patch.url || null } : {}),
            ...(patch.label !== undefined ? { 'addpage.label': patch.label || null } : {})
          })
        }
        onClose={() => closeDrawer(depth)}
        onAdded={(url) => closeDrawer(depth, url)}
      />
    ) : (
      <Suspense fallback={null}>
        <AddPage
          projectId={projectId}
          params={entry.params}
          onParams={(patch) => setDrawerParams(depth, patch)}
          onClose={() => closeDrawer(depth)}
          onAdded={onPageAdded}
        />
      </Suspense>
    ),
  'add-market': ({ entry, depth, projectId }) => (
    <Suspense fallback={null}>
      <AddMarket
        projectId={projectId}
        pageId={entry.params['am.page'] ?? null}
        help={wayParam(entry.params['am.help'])}
        bot={botParam(entry.params['am.bot'])}
        // A way is a history entry (Back returns to the other way); a bot is rewritten in place.
        onHelp={(way) => setDrawerParams(depth, { 'am.help': way }, { push: true })}
        onBot={(bot) => setDrawerParams(depth, { 'am.bot': bot })}
        onClose={(marketId) => closeDrawer(depth, marketId)}
      />
    </Suspense>
  ),
  competitor: ({ entry, depth, projectId }) => (
    <Suspense fallback={null}>
      <Competitor projectId={projectId} entry={entry} depth={depth} />
    </Suspense>
  ),
  fix: ({ entry, depth, projectId }) => (
    <Suspense fallback={null}>
      <Fix projectId={projectId} entry={entry} depth={depth} />
    </Suspense>
  ),
  'page-fix': ({ entry, depth, projectId }) => (
    <Suspense fallback={null}>
      <PageFix projectId={projectId} entry={entry} depth={depth} />
    </Suspense>
  ),
  'page-change': ({ entry, depth, projectId }) => (
    <Suspense fallback={null}>
      <PageChange projectId={projectId} entry={entry} depth={depth} />
    </Suspense>
  ),
  'page-changes': ({ depth, projectId }) => (
    <Suspense fallback={null}>
      <PageChanges projectId={projectId} depth={depth} />
    </Suspense>
  ),
  pitch: ({ entry, depth, projectId }) => (
    <Suspense fallback={null}>
      <Pitch projectId={projectId} entry={entry} depth={depth} />
    </Suspense>
  ),
  'new-topic': ({ depth, projectId }) => (
    <Suspense fallback={null}>
      <NewTopic
        projectId={projectId}
        onClose={() => closeDrawer(depth)}
        onFinish={(topicId) =>
          // A picker that opened it gets the new topic back; else it opens.
          depth > 0 || hasDrawerResult(depth)
            ? closeDrawer(depth, topicId)
            : closeDrawersThen(topicsHash({ row: topicId }))
        }
      />
    </Suspense>
  ),
  'topic-settings': ({ entry, depth, projectId }) => (
    <Suspense fallback={null}>
      <TopicSettings
        projectId={projectId}
        topicId={entry.params['ts.topic'] ?? ''}
        onClose={() => closeDrawer(depth)}
        onDeleted={(topicId) =>
          // Leave the topic's own page: it is gone from the list.
          window.location.hash.startsWith(`#/topics/${encodeURIComponent(topicId)}`)
            ? closeDrawersThen(topicsHash())
            : closeDrawer(depth)
        }
        onDuplicated={(topicId) => closeDrawersThen(topicHash(topicId))}
      />
    </Suspense>
  ),
  ask: ({ entry, depth, projectId }) => (
    <Suspense fallback={null}>
      <AskDrawer
        projectId={projectId}
        question={entry.params['ask.q'] ?? null}
        about={entry.params['ask.about'] ?? null}
        depth={depth}
        onClose={() => closeDrawer(depth)}
      />
    </Suspense>
  ),
  'check-now': ({ entry, depth, projectId }) => (
    <Suspense fallback={null}>
      <CheckNow
        projectId={projectId}
        params={entry.params}
        onParams={(patch, push) => setDrawerParams(depth, patch, { push })}
        onClose={() => closeDrawer(depth)}
      />
    </Suspense>
  ),
  question: (context) => <QuestionDrawerFromUrl {...context} />,
  'move-questions': (context) => <MoveDrawerFromUrl {...context} />,
  // Pickers' "+ Track a new page…" and "+ Add a … key…": each closes with the new id
  // (`openDrawer(id, {}, { onResult })` picks it where the drawer was opened from).
  'track-page': ({ depth, projectId, client, onPagesChanged }) => (
    <TrackPageDrawer
      client={client}
      projectId={projectId}
      onClose={() => closeDrawer(depth)}
      onTracked={(pageId) => {
        onPagesChanged()
        closeDrawer(depth, pageId)
      }}
    />
  ),
  'add-key': ({ entry, depth, projectId, client, onKeysChanged }) => (
    <AddKeyDrawer
      key={entry.params['key.provider'] ?? 'serpapi'}
      client={client}
      provider={keyProviderOf(entry.params['key.provider'])}
      projectId={projectId}
      onClose={() => closeDrawer(depth)}
      onAdded={(keyId) => {
        onKeysChanged()
        closeDrawer(depth, keyId)
      }}
    />
  ),
  // Sources' "Manage types…" and "+ New type…": a new type for a site closes with its id.
  'site-types': ({ entry, depth, projectId }) => (
    <Suspense fallback={null}>
      <SiteTypes
        projectId={projectId}
        create={entry.params['st.new'] === '1'}
        onClose={() => closeDrawer(depth)}
        onCreated={(typeId) => closeDrawer(depth, typeId)}
      />
    </Suspense>
  ),
  // The top bar's Activity list (and the work console's "All activity"), over any route.
  activity: ({ depth }) => <ActivityDrawer onClose={() => closeDrawer(depth)} />
}

/** Draws the shell's drawers the URL asks for, each in its place in the stack. */
export function DrawerHost({
  projectId,
  client,
  onPagesChanged,
  onKeysChanged,
  onProjectsChanged,
  onSettingsChanged,
  onPageAdded = (pageId) => closeDrawersThen(pageHash(pageId, 'prompts'))
}: {
  projectId: string | null
  /** The shell's client. Unset uses the preload bridge. */
  client?: ShellClient
  onPagesChanged?: () => void
  onKeysChanged?: () => void
  /** A project was imported, or an import undone (Import project). */
  onProjectsChanged?: () => void
  /** App settings were applied from a file (Import app settings). */
  onSettingsChanged?: () => void
  /** Add a page saved a page. Default: close the drawers and open its Questions tab. */
  onPageAdded?: (pageId: string) => void
}): JSX.Element | null {
  const { stack } = useDrawerStack()
  // Row menus drawn outside a screen (drill drawers) act on the open project.
  useEffect(() => setQuestionProject(projectId), [projectId])
  const shell = useMemo(() => client ?? createIpcShellClient(), [client])
  return (
    <>
      {stack.map((entry, depth) => {
        // Moving to a new Mac needs no open project (a fresh install imports its first).
        const transfer = TRANSFER_DRAWERS[entry.id]
        if (transfer) {
          return (
            <DrawerLevel key={`${depth}:${entry.id}`} depth={depth}>
              {transfer({
                entry,
                depth,
                onProjectsChanged: onProjectsChanged ?? (() => undefined),
                onSettingsChanged: onSettingsChanged ?? (() => undefined)
              })}
            </DrawerLevel>
          )
        }
        if (entry.id === 'help') {
          // Help needs no project: it reads the bundled help topics only.
          return (
            <DrawerLevel key={`${depth}:${entry.id}`} depth={depth}>
              <Suspense fallback={null}>
                <HelpDrawer
                  id={entry.params['help.id'] ?? null}
                  depth={depth}
                  onClose={() => closeDrawer(depth)}
                />
              </Suspense>
            </DrawerLevel>
          )
        }
        if (entry.id === 'report-problem') {
          // Report a problem needs no project; it reads the one named in the link, else the open one.
          return (
            <DrawerLevel key={`${depth}:${entry.id}`} depth={depth}>
              <Suspense fallback={null}>
                <ReportProblem
                  includeQuestions={entry.params['rp.q'] === '1'}
                  onIncludeQuestions={(value) =>
                    setDrawerParams(depth, { 'rp.q': value ? '1' : null })
                  }
                  projectId={entry.params['rp.project'] ?? projectId}
                  onClose={() => closeDrawer(depth)}
                />
              </Suspense>
            </DrawerLevel>
          )
        }
        if (projectId === null && entry.id === 'ask') {
          // With no project open Ask CiteFox still opens (app-level questions and setup help).
          return (
            <DrawerLevel key={`${depth}:${entry.id}`} depth={depth}>
              <Suspense fallback={null}>
                <AskDrawer
                  projectId={null}
                  question={entry.params['ask.q'] ?? null}
                  about={entry.params['ask.about'] ?? null}
                  depth={depth}
                  onClose={() => closeDrawer(depth)}
                />
              </Suspense>
            </DrawerLevel>
          )
        }
        const render = projectId === null ? undefined : SHELL_DRAWERS[entry.id]
        return render && projectId !== null ? (
          <DrawerLevel key={`${depth}:${entry.id}`} depth={depth}>
            {render({
              entry,
              depth,
              projectId,
              below: stack[depth - 1] ?? null,
              onPageAdded,
              client: shell,
              onPagesChanged: onPagesChanged ?? (() => undefined),
              onKeysChanged: onKeysChanged ?? (() => undefined)
            })}
          </DrawerLevel>
        ) : null
      })}
    </>
  )
}
