import { useCallback, useMemo, useState, type JSX } from 'react'
import type { BoardWidget, RolePreset, SummaryBoard } from '@shared/summary-board'
import { parseEngineFilter } from '../../engines/model'
import { ENGINE_SHORT_LABEL } from '@shared/domain'
import { Button, showUndo } from '../../ui'
import { Widget } from '../widgets/Widget'
import type { WidgetEnv } from '../widgets/env'
import { Board } from './Board'
import { WIDGET_INFO } from './catalog'
import { Gallery, type GalleryChoices } from './Gallery'
import {
  addWidget,
  canAdd,
  presetBoard,
  PRESET_INFO,
  removeWidget,
  restoreWidget,
  setWidgetEngine,
  type PresetContext,
  type WidgetSpec
} from './model'
import { boardInMemory } from './store'
import { useSummaryBoard } from './useSummaryBoard'
import type { BoardStore } from './store'

/**
 * Summary as widgets (owner-approved mock-up, 2026-10-30): the board, "Edit widgets"
 * (Edit mode is `?edit=1`), "+ Add widget" (the gallery is `?add=1`), role presets and
 * Remove with Undo. The layout is kept in the project.
 */
export function SummaryBoardView({
  env,
  store
}: {
  env: WidgetEnv
  /** Tests pass their own. Default: the project file over IPC. */
  store?: BoardStore | null
}): JSX.Element {
  const { projectId, query, setQuery, offered } = env
  const { board, save } = useSummaryBoard(projectId, store)
  const editing = query.edit === '1'
  const gallery = query.add === '1'
  const [focusId, setFocusId] = useState<string | null>(null)
  // A link's `?engine=` sets every widget at once (the widget's own pick stays saved).
  const override = query.engine ? parseEngineFilter(query.engine, offered) : null
  const latest = useCallback(
    (): SummaryBoard | null => boardInMemory(projectId) ?? board,
    [projectId, board]
  )

  const remove = useCallback(
    (widget: BoardWidget) => {
      const current = latest()
      if (current === null) return
      const { board: next, removed } = removeWidget(current, widget.id)
      if (removed === null) return
      save(next)
      showUndo({
        message: `Removed ${WIDGET_INFO[widget.kind].title} from Summary.`,
        undo: () => {
          const now = latest()
          if (now !== null) save(restoreWidget(now, removed))
        },
        testId: 'summary-widget-undo'
      })
    },
    [latest, save]
  )

  const context = useMemo<PresetContext>(() => presetContext(env), [env])
  const choices = useMemo<GalleryChoices>(() => galleryChoices(env), [env])

  const applyPreset = useCallback(
    (preset: RolePreset) => {
      const before = latest()
      save(presetBoard(preset, context))
      setQuery({ add: null, edit: '1' })
      showUndo({
        message: `Your Summary now uses the ${PRESET_INFO[preset].title} layout.`,
        undo: () => {
          if (before !== null) save(before)
        },
        testId: 'summary-preset-undo'
      })
    },
    [latest, save, context, setQuery]
  )

  const add = useCallback(
    (spec: WidgetSpec) => {
      const current = latest()
      if (current === null) return
      const next = addWidget(current, spec)
      save(next)
      setFocusId(next.widgets.at(-1)?.id ?? null)
      setQuery({ add: null, edit: '1' })
    },
    [latest, save, setQuery]
  )

  if (board === null) {
    return (
      <p className="ov-note" role="status">
        Loading your widgets…
      </p>
    )
  }
  return (
    <div className="wb">
      {override !== null && override !== 'all' ? (
        <p className="wb-override" role="status">
          Every widget shows {ENGINE_SHORT_LABEL[override]}.{' '}
          <button
            type="button"
            className="ov-link ov-link-button"
            onClick={() => setQuery({ engine: null })}
          >
            Show each widget’s own engine
          </button>
        </p>
      ) : editing ? (
        <p className="wb-hint" role="status">
          Drag a widget to move it, pick its size, or remove it. Press Done when it looks right.
        </p>
      ) : null}
      {board.widgets.length === 0 ? (
        <div className="wb-empty">
          <p>Your Summary has no widgets.</p>
          <Button
            size="sm"
            variant="primary"
            icon="plus"
            onClick={() => setQuery({ add: '1', edit: '1' })}
          >
            Add widget
          </Button>
        </div>
      ) : (
        <Board
          board={board}
          editing={editing}
          onChange={save}
          onRemove={remove}
          focusId={focusId}
          renderWidget={(widget) => (
            <Widget
              widget={widget}
              env={env}
              override={override}
              onEngine={(engine) => {
                const current = latest()
                if (current === null) return
                if (override !== null) setQuery({ engine: null })
                save(setWidgetEngine(current, widget.id, engine))
              }}
            />
          )}
        />
      )}
      {gallery ? (
        <Gallery
          choices={choices}
          full={!canAdd(board)}
          onAdd={add}
          onPreset={applyPreset}
          onClose={() => setQuery({ add: null })}
        />
      ) : null}
    </div>
  )
}

function presetContext(env: WidgetEnv): PresetContext {
  const rival = env.data.citedSites.find((site) => !site.own && site.domain && site.count > 0)
  const question =
    env.data.questions.find((item) => item.you === 'not_cited') ?? env.data.questions[0]
  return {
    topCompetitor: rival?.domain ? { domain: rival.domain, label: rival.name } : null,
    question: question
      ? { pageId: question.pageId, promptId: question.promptId, label: question.text }
      : null
  }
}

function galleryChoices(env: WidgetEnv): GalleryChoices {
  const seen = new Set<string>()
  const questions: GalleryChoices['questions'][number][] = []
  for (const item of env.data.questions) {
    const key = `${item.pageId}|${item.promptId}`
    if (seen.has(key)) continue
    seen.add(key)
    questions.push({ pageId: item.pageId, promptId: item.promptId, label: item.text })
    if (questions.length === 60) break
  }
  return {
    competitors: env.data.citedSites.flatMap((site) =>
      !site.own && site.domain ? [{ domain: site.domain, label: site.name }] : []
    ),
    questions
  }
}
