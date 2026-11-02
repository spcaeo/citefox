import { useCallback, useEffect, useRef, useState } from 'react'
import type { OwnerWhyResult, OwnerWhySearch } from '@shared/ipc'
import type { PageFix } from '@shared/page-fixes'
import { useClaudeGate } from '../../../assistant/drawer/model'
import { errorText } from '../../../components/errorText'
import type { ProjectFixesSource } from '../../source'

/**
 * `loading`: the saved comparison is being read. `idle`: none saved yet, the button
 * shows. `no-ai`: CiteFox AI is not connected, so no run starts. `off`: not an
 * owner fix (or one without both pages), so there is nothing to compare.
 */
export type OwnerWhyState =
  | { phase: 'off' }
  | { phase: 'loading' }
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; why: OwnerWhyResult }
  | { phase: 'error'; message: string }
  | { phase: 'no-ai' }

type WhySource = Pick<ProjectFixesSource, 'fixes:draftOwnerWhy' | 'fixes:ownerWhy'>

/** The fix's searches, best win odds first, as the comparison reads them. */
export function whySearches(fix: PageFix): OwnerWhySearch[] {
  return [...fix.searches]
    .sort((a, b) => (b.winOdds?.score ?? -1) - (a.winOdds?.score ?? -1))
    .slice(0, 20)
    .map((search) => ({ promptId: search.promptId, runId: search.runId, text: search.text }))
}

/** True when the fix can be compared: an owner fix with its target and the cited page. */
export function canCompare(fix: PageFix): boolean {
  return fix.kind === 'owner' && fix.page !== null && fix.citedUrl !== null
}

/**
 * "Why Google picks" for an owner fix: the saved comparison at once, or a run on
 * request (both pages are read, live when not stored, with the saved overviews).
 * A reply after a newer start or unmount is dropped.
 */
export function useOwnerWhy(
  source: WhySource,
  projectId: string,
  fix: PageFix
): { state: OwnerWhyState; start: () => void } {
  const gate = useClaudeGate()
  const able = canCompare(fix)
  const [state, setState] = useState<OwnerWhyState>(able ? { phase: 'loading' } : { phase: 'off' })
  const seq = useRef(0)

  useEffect(() => {
    if (!able) return
    const mine = ++seq.current
    source['fixes:ownerWhy']({ projectId, fixId: fix.id }).then(
      (saved) => {
        if (seq.current !== mine) return
        setState(saved === null ? { phase: 'idle' } : { phase: 'done', why: saved })
      },
      () => {
        if (seq.current === mine) setState({ phase: 'idle' })
      }
    )
    return () => {
      seq.current += 1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per fix
  }, [projectId, fix.id, able])

  const start = useCallback(() => {
    if (fix.page === null || fix.citedUrl === null) return
    const target = { pageId: fix.page.pageId, url: fix.page.url }
    const citedUrl = fix.citedUrl
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
        const why = await source['fixes:draftOwnerWhy']({
          projectId,
          fixId: fix.id,
          target,
          citedUrl,
          searches: whySearches(fix)
        })
        if (seq.current === mine) setState({ phase: 'done', why })
      })
      .catch((cause: unknown) => {
        if (seq.current === mine) {
          setState({ phase: 'error', message: errorText(cause, 'Could not compare the pages.') })
        }
      })
  }, [source, projectId, fix, gate])

  return { state, start }
}
