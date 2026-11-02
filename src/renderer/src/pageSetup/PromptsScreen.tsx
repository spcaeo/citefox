import { useMemo, type JSX } from 'react'
import type { BuyerPrompt } from '@shared/domain'
import type { PageDetail } from '@shared/ipc'
import type { AssistClient } from '../assist/client'
import { useAiContext } from '../assistant/context/useAiContext'
import { LoadError } from '../components/LoadError'
import { DrillHost } from '../drill'
import { currentClientMode } from '../onboarding/flags'
import { pageLabel } from '../projects/copy'
import type { ShellClient } from '../projects/client'
import { marketLabel } from '../shell/model'
import { DrawerLevel } from '../shell/DrawerLevel'
import { openDrawer, useDrawerEntry, type DrawerEntryApi } from '../shell/drawers'
import type { TemplatesClient } from '../templates/client'
import { Button, Drawer, IconButton, SegmentedControl } from '../ui'
import { useHashQuery } from '../utils/hashQuery'
import { pageScopeRefs } from '../visibility/aiContext'
import { setupScope } from './drills'
import { useLegacyPanel } from './legacyPanel'
import { variantFor } from './model'
import { FirstCheckBar, SetupGate, type PipelineSource } from './pipeline'
import { createPromptSetsClient } from './promptSets'
import { PromptSetPicker } from './PromptSetPicker'
import { PromptEditDrawer, PromptSettingsDrawer, RephraseDrawer } from './prompts/PromptDrawers'
import { PromptsGrid } from './prompts/PromptsGrid'
import { PromptsRail } from './prompts/PromptsRail'
import { usePromptSet } from './prompts/usePromptSet'
import { legacyPromptPanel } from './prompts/panelRoute'
import './prompts/prompts2.css'

const LANG_QUERY = ['lang'] as const

/**
 * The Prompts tab (owner feedback 5). While setup runs it shows the live
 * "Setting up this page" panel; once the prompts are written it is a review
 * screen: the generated prompts as one list grid (edit, rephrase, remove, add
 * your own), who they are written for, and ONE primary, "Start first check".
 * Prompt count and template live in the Prompt settings drawer. Every drawer
 * has a URL (`?drawer=pt-edit&pt.edit=<id>`, `pt-rephrase`, `pt-add`,
 * `pt-settings`); old `?filter=edit:<id>` links open them too.
 */
export function PromptsScreen({
  client,
  templatesClient,
  projectId,
  page,
  marketId,
  filter = null,
  onChanged,
  assistClient,
  pipelineSource
}: {
  client: ShellClient
  templatesClient: TemplatesClient
  projectId: string
  page: PageDetail
  marketId: string
  /** The route's `?filter=`: an old link to a panel, now opened as its drawer. */
  filter?: string | null
  onChanged: () => void
  /** Defaults to the assist client for this window. */
  assistClient?: AssistClient
  /** Tests only. Production uses the preload bridge. */
  pipelineSource?: PipelineSource | null
}): JSX.Element {
  const data = usePromptSet(client, projectId, page, onChanged)
  useAiContext({
    entities: pageScopeRefs({
      pageId: page.id,
      page: pageLabel(page),
      market: page.markets.find((item) => item.id === marketId) ?? null
    })
  })
  return (
    <DrillHost>
      <SetupGate
        page={page}
        waitingFor="prompts"
        onSettled={() => {
          data.reload()
          onChanged()
        }}
        {...(pipelineSource !== undefined ? { source: pipelineSource } : {})}
      >
        {({ pipeline, setCheckWhenReady }) => (
          <div className="pr-screen">
            <FirstCheckBar
              pipeline={pipeline}
              onCheckWhenReady={(on) => void setCheckWhenReady(on)}
            />
            {pipeline.state === 'running' ? (
              <p className="pr-inline-status" role="status">
                <span className="psu-spin" aria-hidden="true" />
                {pipeline.message}
              </p>
            ) : null}
            <PromptsReview
              data={data}
              client={client}
              templatesClient={templatesClient}
              projectId={projectId}
              page={page}
              marketId={marketId}
              filter={filter}
              assistClient={assistClient}
            />
          </div>
        )}
      </SetupGate>
    </DrillHost>
  )
}

function PromptsReview({
  data,
  client,
  templatesClient,
  projectId,
  page,
  marketId,
  filter,
  assistClient
}: {
  data: ReturnType<typeof usePromptSet>
  client: ShellClient
  templatesClient: TemplatesClient
  projectId: string
  page: PageDetail
  marketId: string
  filter: string | null
  assistClient?: AssistClient
}): JSX.Element {
  // The prompt language is part of the URL (`?lang=`), like every other state.
  const [query, setQuery] = useHashQuery(LANG_QUERY)
  const language = query.lang ?? ''
  const setLanguage = (code: string): void => setQuery({ lang: code })
  const promptSets = useMemo(() => createPromptSetsClient(currentClientMode(), client), [client])
  useLegacyPanel(legacyPromptPanel(filter))
  const adding = useDrawerEntry('pt-add')
  const editing = useDrawerEntry('pt-edit')
  const rephrasing = useDrawerEntry('pt-rephrase')
  const settings = useDrawerEntry('pt-settings')
  const { view } = data
  const prompts = view?.prompts ?? []
  const languages = [
    ...new Set(prompts.flatMap((prompt) => prompt.variants.map((variant) => variant.language)))
  ]
  const activeLanguage = languages.includes(language) ? language : (languages[0] ?? 'en')
  const market = page.markets.find((item) => item.id === marketId) ?? page.markets[0]
  const scope = setupScope(page.id, market)

  function textOf(prompt: BuyerPrompt): string {
    return variantFor(prompt, marketId, activeLanguage)?.text ?? prompt.variants[0]?.text ?? ''
  }
  function variantMarket(prompt: BuyerPrompt): string {
    return variantFor(prompt, marketId, activeLanguage)?.marketId ?? marketId
  }

  if (view === null) {
    return data.loadError ? (
      <LoadError
        title="CiteFox could not load this page's questions."
        message={data.loadError}
        onRetry={data.reload}
      />
    ) : (
      <p role="status">Loading questions…</p>
    )
  }

  const find = (id: string | undefined): BuyerPrompt | null =>
    prompts.find((prompt) => prompt.id === id) ?? null
  const editPrompt = editing ? find(editing.entry.params['pt.edit']) : null
  const rephrasePrompt = rephrasing ? find(rephrasing.entry.params['pt.rephrase']) : null

  const controls = (
    <>
      {languages.length > 1 ? (
        <SegmentedControl
          label="Question language"
          value={activeLanguage}
          onChange={setLanguage}
          size="sm"
          options={languages.map((code) => ({
            value: code,
            label: `${code.toUpperCase()} · ${page.markets
              .filter((item) => item.language.split('-')[0] === code)
              .map((item) => marketLabel(item))
              .join(', ')}`
          }))}
        />
      ) : null}
      <PromptSetPicker
        client={promptSets}
        projectId={projectId}
        pageId={page.id}
        view={view}
        onSwitched={data.setView}
      />
      <IconButton
        icon="sliders"
        label="Question settings"
        data-tip="Prompt settings"
        onClick={() => openDrawer('pt-settings')}
      />
    </>
  )

  return (
    <div className="pr-review">
      {data.error ? (
        <p className="ps-error" role="alert">
          {data.error}
        </p>
      ) : null}

      {view.dirty ? (
        <div className="pr-unsaved" role="status">
          <p>
            <strong>Unsaved changes.</strong> Save creates question set v{view.nextVersion} and
            starts a new baseline, so before/after comparisons stay fair. The check uses the saved
            set.
          </p>
          <div className="pr-unsaved-actions">
            <Button variant="ghost" onClick={() => void data.discard()}>
              Discard changes
            </Button>
            <Button onClick={() => void data.save()}>Save as v{view.nextVersion}</Button>
          </div>
        </div>
      ) : null}

      <div className="pr-layout">
        <PromptsRail
          pageId={page.id}
          view={view}
          profile={data.profile}
          prompts={prompts}
          coverage={data.coverage}
          scope={scope}
          end={controls}
        />
        <PromptsGrid
          prompts={prompts}
          textOf={textOf}
          coverage={data.coverage}
          projectId={projectId}
          pageId={page.id}
          marketId={marketId}
          {...(assistClient ? { assistClient } : {})}
          actions={{
            onEdit: (prompt) => openDrawer('pt-edit', { 'pt.edit': prompt.id }),
            onRephrase: (prompt) => openDrawer('pt-rephrase', { 'pt.rephrase': prompt.id }),
            onAddOwn: () => openDrawer('pt-add'),
            onSetEnabled: (ids, enabled) => void data.setEnabled(ids, enabled),
            onRemove: (ids) => void data.remove(ids),
            onMove: (promptId, delta) => void data.move(promptId, delta),
            onAddSuggested: data.addSuggested
          }}
        />
      </div>

      {settings ? (
        <DrawerLevel depth={settings.depth}>
          <PromptSettingsDrawer
            templatesClient={templatesClient}
            promptCount={page.promptCount}
            setHas={prompts.length}
            onSaveCount={data.saveCount}
            onRegenerate={data.regenerate}
            onClose={() => settings.close()}
          />
        </DrawerLevel>
      ) : null}
      {adding ? (
        <DrawerLevel depth={adding.depth}>
          <PromptEditDrawer
            prompt={null}
            initialText=""
            nextVersion={view.nextVersion}
            error={data.error}
            onSave={(text) => data.addOwn(text)}
            onClose={() => adding.close()}
          />
        </DrawerLevel>
      ) : null}
      {editing ? (
        <DrawerLevel depth={editing.depth}>
          {editPrompt ? (
            <PromptEditDrawer
              key={editPrompt.id}
              prompt={editPrompt}
              initialText={textOf(editPrompt)}
              nextVersion={view.nextVersion}
              error={data.error}
              onSave={(text) => data.edit(editPrompt, variantMarket(editPrompt), text)}
              onClose={() => editing.close()}
            />
          ) : (
            <PromptGoneDrawer id="pt-edit" title="Edit question" entry={editing} />
          )}
        </DrawerLevel>
      ) : null}
      {rephrasing ? (
        <DrawerLevel depth={rephrasing.depth}>
          {rephrasePrompt ? (
            <RephraseDrawer
              key={rephrasePrompt.id}
              prompt={rephrasePrompt}
              text={textOf(rephrasePrompt)}
              projectId={projectId}
              pageId={page.id}
              marketId={variantMarket(rephrasePrompt)}
              {...(assistClient ? { client: assistClient } : {})}
              onApply={(text) =>
                data.applyRephrase(rephrasePrompt, variantMarket(rephrasePrompt), text)
              }
              onClose={() => rephrasing.close()}
            />
          ) : (
            <PromptGoneDrawer id="pt-rephrase" title="Rephrase like a buyer" entry={rephrasing} />
          )}
        </DrawerLevel>
      ) : null}
    </div>
  )
}

/** A link to a prompt that is not in this set any more (removed, or the set was written again). */
function PromptGoneDrawer({
  id,
  title,
  entry
}: {
  id: string
  title: string
  entry: DrawerEntryApi
}): JSX.Element {
  return (
    <Drawer
      id={id}
      title={title}
      onClose={() => entry.close()}
      error={{ message: 'That question is not in this set any more.' }}
    />
  )
}
