import { useCallback, useEffect, useRef, useState } from 'react'
import type { PageFixBriefContent, SavedPageFixBrief } from '@shared/ipc'
import type { FixSearch, PageFix } from '@shared/page-fixes'
import { useClaudeGate, type ClaudeReadiness } from '../../assistant/drawer/model'
import { errorText } from '../../components/errorText'
import type { ProjectFixesSource } from '../source'

/** A fix or page brief, in one shape for the drawer's card (and what is saved). */
export type PageFixBrief = PageFixBriefContent

/**
 * `no-ai`: CiteFox AI is not connected, so no run starts; the drawer shows one
 * notice and one button to connect it.
 */
export type BriefState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; brief: PageFixBrief }
  | { phase: 'error'; message: string }
  | { phase: 'no-ai' }

type BriefSource = Pick<
  ProjectFixesSource,
  'topics:draftFix' | 'topics:draftPageBrief' | 'assist:run' | 'fixes:saveBrief'
>

/** The search a brief is written from: the best-odds one of the fix's main topic or page. */
export function briefSearch(fix: PageFix): FixSearch | null {
  const main = fix.sources[0]
  if (!main) return null
  return fix.searches.find((search) => search.sourceId === main.id) ?? null
}

function note(durationMs: number): string {
  return `CiteFox AI · about ${Math.max(1, Math.round(durationMs / 1000))} s · no searches`
}

/**
 * Runs the brief a page fix's button asks for, with the existing brief features:
 * Get fix brief is `topics:draftFix` on a topic's best search, or the page assist
 * `progress.draftFix` on a tracked page; Get page brief is `topics:draftPageBrief`.
 * Each reads saved checks only: no search. A reply after a newer start, a reset or
 * unmount is dropped.
 *
 * The AI connection is checked first: with none, no run starts (`no-ai`). A brief
 * written is saved (`fixes:saveBrief`), so the fix's Status turns "Brief ready" and
 * `saved` shows it again the next time the drawer opens.
 */
export function usePageFixBrief(
  source: BriefSource,
  projectId: string,
  fix: PageFix | null,
  options: {
    saved?: PageFixBrief | null
    onSaved?: (saved: SavedPageFixBrief) => void
  } = {}
): {
  state: BriefState
  /** Whether CiteFox AI is connected, as far as the app knows now. */
  readiness: ClaudeReadiness
  start: () => void
  reset: () => void
} {
  const gate = useClaudeGate()
  const { saved = null, onSaved } = options
  // Each state names the fix it belongs to: another fix reads as idle, and a
  // reply for the fix that was open before is dropped by `seq`.
  const [held, setHeld] = useState<{
    fixId: string | null
    state: BriefState
    /** The saved brief was closed: show the button again. */
    dismissed?: boolean
  }>({
    fixId: null,
    state: { phase: 'idle' }
  })
  const seq = useRef(0)
  const fixId = fix?.id ?? null
  const own: BriefState = held.fixId === fixId ? held.state : { phase: 'idle' }
  const state: BriefState =
    own.phase === 'idle' && saved !== null && !held.dismissed
      ? { phase: 'done', brief: saved }
      : own
  useEffect(() => {
    seq.current += 1
  }, [fixId])
  useEffect(
    () => () => {
      seq.current += 1
    },
    []
  )

  const start = useCallback(() => {
    if (fix === null) return
    const search = briefSearch(fix)
    if (search === null) return
    const mine = ++seq.current
    const set = (next: BriefState): void => setHeld({ fixId: fix.id, state: next })
    set({ phase: 'running' })
    void gate
      .ensure()
      .then(async (ready) => {
        if (seq.current !== mine) return
        // No AI connected: say so once instead of a run that can only fail.
        if (!ready) {
          set({ phase: 'no-ai' })
          return
        }
        const brief = await run(source, projectId, fix, search)
        if (seq.current !== mine) return
        set({ phase: 'done', brief })
        source['fixes:saveBrief']({ projectId, fixId: fix.id, brief }).then(
          (record) => onSaved?.(record),
          // Not saved: the brief still shows; the Status stays New.
          () => undefined
        )
      })
      .catch((cause: unknown) => {
        if (seq.current === mine) {
          set({ phase: 'error', message: errorText(cause, 'Could not write the brief.') })
        }
      })
  }, [source, projectId, fix, onSaved, gate])

  const reset = useCallback(() => {
    seq.current += 1
    setHeld({ fixId, state: { phase: 'idle' }, dismissed: true })
  }, [fixId])

  return { state, readiness: gate.readiness, start, reset }
}

async function run(
  source: BriefSource,
  projectId: string,
  fix: PageFix,
  search: FixSearch
): Promise<PageFixBrief> {
  if (fix.kind === 'new') {
    const brief = await source['topics:draftPageBrief']({
      projectId,
      topicId: search.sourceId,
      promptId: search.promptId,
      marketId: search.marketId
    })
    return {
      title: 'Page brief',
      summary: brief.summary,
      items: [
        ...brief.outline.map((line, index) => ({
          id: `outline-${index}`,
          label: 'Section',
          text: line
        })),
        ...(brief.citedNow.length > 0
          ? [{ id: 'cited', label: 'Cited now', text: brief.citedNow.join(', ') }]
          : [])
      ],
      text: brief.text,
      writeWithUrl: brief.writeWithUrl || null,
      note: note(brief.info.durationMs)
    }
  }
  if (search.sourceKind === 'page') {
    const result = await source['assist:run']({
      assistId: 'progress.draftFix',
      projectId,
      pageId: search.sourceId,
      marketId: search.marketId,
      promptId: null,
      inputs: {},
      instruction: null
    })
    return {
      title: 'Fix brief',
      summary: result.summary,
      items: result.items.map((item) => ({
        id: item.id,
        ...(item.tag ? { label: item.tag } : {}),
        text: item.text,
        detail: item.detail
      })),
      text: result.items.map((item) => item.text).join('\n\n'),
      writeWithUrl: null,
      note: note(result.durationMs)
    }
  }
  const draft = await source['topics:draftFix']({
    projectId,
    topicId: search.sourceId,
    promptId: search.promptId,
    marketId: search.marketId
  })
  return {
    title: 'Fix brief',
    summary: draft.draft,
    items: draft.steps.map((step, index) => ({ id: `step-${index}`, label: 'Step', text: step })),
    text: [draft.draft, ...draft.steps.map((step) => `- ${step}`)].join('\n'),
    writeWithUrl: draft.writeWithUrl || null,
    note: note(draft.info.durationMs)
  }
}
