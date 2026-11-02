import { useCallback, useEffect, useRef, useState } from 'react'
import type { PageEditResult } from '@shared/ipc'
import type { PageFix } from '@shared/page-fixes'
import { useClaudeGate } from '../../../assistant/drawer/model'
import { errorText } from '../../../components/errorText'
import type { ProjectFixesSource } from '../../source'
import { EMPTY_STATE, parseState, storageKey, type EditState } from '@shared/page-edit'

/**
 * `loading`: the saved edits are being read. `idle`: none saved yet, the button
 * shows. `no-ai`: CiteFox AI is not connected, so no run starts.
 */
export type PageEditPhase =
  | { phase: 'loading' }
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; edit: PageEditResult }
  | { phase: 'error'; message: string }
  | { phase: 'no-ai' }

type EditSource = Pick<ProjectFixesSource, 'fixes:draftPageEdit' | 'fixes:pageEdit'>

/**
 * The page to mark up when it is not the fix's own page (an owner fix: the page the
 * comparison recommends), with the comparison's findings as advice for the edits.
 */
export interface PageEditTarget {
  pageId: string | null
  url: string
  context?: string
}

/** The searches the page should win, best first, as their question text. */
export function editSearches(fix: PageFix): string[] {
  return [...fix.searches]
    .sort((a, b) => (b.winOdds?.score ?? -1) - (a.winOdds?.score ?? -1))
    .map((search) => search.text)
}

/**
 * The fix's page edits: the saved ones at once, or a run on request (the page is
 * read, live when not stored, then CiteFox AI marks what to cut and add). The
 * person's keep/undo choices and typed text stay on this computer per result,
 * so closing the drawer loses nothing. A reply after a newer start or unmount
 * is dropped.
 */
export function usePageEdit(
  source: EditSource,
  projectId: string,
  fix: PageFix,
  target: PageEditTarget | null = null
): {
  state: PageEditPhase
  edits: EditState
  setEdits: (next: EditState) => void
  start: () => void
} {
  const gate = useClaudeGate()
  const [state, setState] = useState<PageEditPhase>({ phase: 'loading' })
  const [edits, setHeld] = useState<EditState>(EMPTY_STATE)
  const seq = useRef(0)
  const url = target?.url ?? fix.page?.url ?? null
  const pageId = target ? target.pageId : (fix.page?.pageId ?? null)
  const context = target?.context

  useEffect(() => {
    const mine = ++seq.current
    source['fixes:pageEdit']({ projectId, fixId: fix.id }).then(
      (saved) => {
        if (seq.current !== mine) return
        if (saved === null) setState({ phase: 'idle' })
        else show(saved)
      },
      () => {
        if (seq.current === mine) setState({ phase: 'idle' })
      }
    )
    return () => {
      seq.current += 1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per fix
  }, [projectId, fix.id])

  function show(edit: PageEditResult): void {
    setHeld(readStored(edit))
    setState({ phase: 'done', edit })
  }

  const start = useCallback(() => {
    if (url === null) return
    const mine = ++seq.current
    setState({ phase: 'running' })
    void gate
      .ensure()
      .then(async (ready) => {
        if (seq.current !== mine) return
        if (!ready) {
          setState({ phase: 'no-ai' })
          return
        }
        const edit = await source['fixes:draftPageEdit']({
          projectId,
          fixId: fix.id,
          pageId,
          url,
          searches: editSearches(fix),
          topicId: fix.sources.find((item) => item.kind === 'topic')?.id ?? null,
          ...(context ? { context } : {})
        })
        if (seq.current === mine) show(edit)
      })
      .catch((cause: unknown) => {
        if (seq.current === mine) {
          setState({ phase: 'error', message: errorText(cause, 'Could not write the page edits.') })
        }
      })
  }, [source, projectId, fix, url, pageId, context, gate])

  const setEdits = useCallback(
    (next: EditState) => {
      setHeld(next)
      if (state.phase === 'done') writeStored(state.edit, next)
    },
    [state]
  )

  return { state, edits, setEdits, start }
}

function readStored(edit: PageEditResult): EditState {
  try {
    return parseState(window.localStorage.getItem(storageKey(edit)))
  } catch {
    return EMPTY_STATE
  }
}

function writeStored(edit: PageEditResult, next: EditState): void {
  try {
    window.localStorage.setItem(storageKey(edit), JSON.stringify(next))
  } catch {
    // Storage full or blocked: the choices still hold while the drawer is open.
  }
}
