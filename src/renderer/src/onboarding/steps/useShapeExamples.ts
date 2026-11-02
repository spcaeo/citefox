import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { SetupDraft } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { withList } from '../sections/draftOps'
import { itemsFromRows } from '../sections/merge'
import type { SetupSectionClient } from '../sectionClient'
import { contextFromDraft, rulesOf } from '../setupDraft'

export interface ShapeExamples {
  busy: boolean
  error: string | null
  /** Writes them again (after a failure, or for other ones). */
  retry: () => void
}

/**
 * Step 8's examples (owner feedback 2026-10-25: "when they have entered the website, in
 * the background, we should start preparing"): one buying moment of this business in
 * each shape, written by Claude as soon as the site read is done, while the user goes
 * through steps 4 to 7. Once per session unless retried; nothing without Claude.
 */
export function useShapeExamples({
  sections,
  draft,
  draftRef,
  onDraft
}: {
  sections: SetupSectionClient
  draft: SetupDraft
  draftRef: RefObject<SetupDraft>
  onDraft: (update: (current: SetupDraft) => SetupDraft) => void
}): ShapeExamples {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  const run = useCallback(() => {
    started.current = true
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        const estimate = await sections.sectionEstimate({ section: 'examples' })
        if (!estimate.available) return
        const now = draftRef.current
        const result = await sections.sectionRun({
          section: 'examples',
          context: contextFromDraft(now),
          mode: 'redo',
          instruction: null,
          current: [],
          prompt: now.prompts.examples ?? null,
          ...rulesOf(now)
        })
        onDraft((was) => withList(was, 'examples', () => itemsFromRows(result.rows)))
      } catch (cause) {
        setError(errorText(cause, 'CiteFox AI could not write the examples.', { sentence: true }))
      } finally {
        setBusy(false)
      }
    })()
  }, [draftRef, onDraft, sections])

  const ready =
    draft.readDone && draft.summary.trim().length > 0 && draft.lists.examples.length === 0
  useEffect(() => {
    if (ready && !started.current) run()
  }, [ready, run])

  return { busy, error, retry: run }
}
