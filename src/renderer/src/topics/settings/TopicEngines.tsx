import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { normaliseEngines, type EngineId } from '@shared/domain'
import type { EngineEstimate, PageEnginesView, ProjectEnginesView } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { EngineRow } from '../../projectSettings/track/EngineRow'
import { pickedProvider, sameEngines } from '../../projectSettings/track/model'
import type { PageEnginesSource } from '../../projectSettings/track/source'
import { DrawerSection, SegmentedControl } from '../../ui'
import { formatCount } from '../../keys/serpUsage'
import { costText } from '../../engines/model'
import '../../projectSettings/track/track.css'

type Mode = 'project' | 'own'

export interface TopicEngines {
  /** False until both views load, or with no source (tests of the rest of the drawer). */
  ready: boolean
  dirty: boolean
  /** Why Save cannot run, such as no engine ticked. */
  invalid: string | null
  /** Saves the topic's choice; resolves to what Undo puts back. */
  save: () => Promise<readonly EngineId[] | null>
  /** Puts a choice back (Undo). */
  restore: (engines: readonly EngineId[] | null) => Promise<void>
  section: JSX.Element | null
}

/**
 * A topic's own engines in its settings drawer (Engines board: "a topic can override it
 * in its own settings drawer"): follow the project, or tick its own, with the price of
 * one check of this topic. Saved by the drawer's Save, with Undo.
 */
export function useTopicEngines(
  source: PageEnginesSource | null,
  projectId: string,
  topicId: string
): TopicEngines {
  const [page, setPage] = useState<PageEnginesView | null>(null)
  const [project, setProject] = useState<ProjectEnginesView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [mode, setMode] = useState<Mode>('project')
  const [picks, setPicks] = useState<readonly EngineId[]>([])
  const [estimate, setEstimate] = useState<EngineEstimate | null>(null)
  const asked = useRef(0)

  useEffect(() => {
    if (source === null) return
    let cancelled = false
    Promise.all([
      source['engines:page']({ projectId, pageId: topicId }),
      source['engines:get']({ projectId })
    ]).then(
      ([own, all]) => {
        if (cancelled) return
        setPage(own)
        setProject(all)
        setMode(own.own === null ? 'project' : 'own')
        setPicks(own.own ?? own.projectEngines)
        setError(null)
      },
      (cause: unknown) => {
        if (!cancelled) setError(errorText(cause, 'Could not load this topic’s engines.'))
      }
    )
    return () => {
      cancelled = true
    }
  }, [source, projectId, topicId, attempt])

  const chosen = useMemo(
    () => (mode === 'own' ? picks : (page?.projectEngines ?? [])),
    [mode, picks, page]
  )
  useEffect(() => {
    if (source === null || page === null || chosen.length === 0) return
    const ticket = ++asked.current
    const timer = window.setTimeout(() => {
      source['engines:estimate']({ projectId, pageIds: [topicId], engines: [...chosen] }).then(
        (next) => {
          if (ticket === asked.current) setEstimate(next)
        },
        () => {
          if (ticket === asked.current) setEstimate(null)
        }
      )
    }, 200)
    return () => window.clearTimeout(timer)
  }, [source, projectId, topicId, page, chosen])

  const ready = source !== null && page !== null && project !== null
  const saved = page?.own ?? null
  const dirty =
    ready && (mode === 'project' ? saved !== null : saved === null || !sameEngines(picks, saved))
  const invalid = mode === 'own' && picks.length === 0 ? 'Tick at least one engine.' : null

  const save = useCallback(async () => {
    if (source === null || page === null) return null
    const before = page.own
    const next = await source['engines:setPage']({
      projectId,
      pageId: topicId,
      engines: mode === 'own' ? [...picks] : null
    })
    setPage(next)
    return before
  }, [source, page, projectId, topicId, mode, picks])

  const restore = useCallback(
    async (engines: readonly EngineId[] | null) => {
      if (source === null) return
      await source['engines:setPage']({
        projectId,
        pageId: topicId,
        engines: engines === null ? null : [...engines]
      })
    },
    [source, projectId, topicId]
  )

  let section: JSX.Element | null = null
  if (source !== null) {
    const labels = (ids: readonly EngineId[]): string =>
      ids.map((id) => project?.options.find((option) => option.id === id)?.label ?? id).join(', ')
    section = (
      <DrawerSection
        title="Engines"
        description="Which AI answers this topic’s checks read."
        loading={!ready && error === null}
        error={error}
        onRetry={() => setAttempt((n) => n + 1)}
        testId="topic-engines"
      >
        {ready && page && project ? (
          <div className="et-panel">
            <SegmentedControl
              label="Engines for this topic"
              value={mode}
              onChange={(value) => {
                setMode(value)
                if (value === 'own' && saved === null) setPicks(page.projectEngines)
              }}
              options={[
                { value: 'project', label: 'Same as the project' },
                { value: 'own', label: 'Its own' }
              ]}
            />
            {mode === 'project' ? (
              <p className="hint">
                Now: {labels(page.projectEngines)}. Change them in Project settings › What to track.
              </p>
            ) : (
              <ul className="et-list" aria-label="Engines for this topic">
                {project.options.map((option) => (
                  <EngineRow
                    key={option.id}
                    option={option}
                    picked={picks.includes(option.id)}
                    provider={pickedProvider(project)}
                    onToggle={(on) =>
                      setPicks((current) =>
                        normaliseEngines(
                          on ? [...current, option.id] : current.filter((id) => id !== option.id)
                        )
                      )
                    }
                  />
                ))}
              </ul>
            )}
            <p className="hint" role="status" aria-live="polite">
              {invalid ??
                (estimate && chosen.length > 0
                  ? `One check of this topic: ${formatCount(estimate.perCheck.credits)} credits${
                      estimate.perCheck.credits === 0 && estimate.perCheck.searches > 0
                        ? ` (${formatCount(estimate.perCheck.searches)} searches)`
                        : ''
                    } · ≈ ${costText(estimate.perCheck.costMicros)}`
                  : '')}
            </p>
          </div>
        ) : null}
      </DrawerSection>
    )
  }
  return { ready, dirty, invalid, save, restore, section }
}
