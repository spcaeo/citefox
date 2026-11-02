import { useCallback, useEffect, useState } from 'react'
import type { GapRowState, GapStates, GapStatus } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import type { ShellClient } from '../../projects/client'
import { openDrawer } from '../../shell/drawers'
import { showUndo } from '../../ui'
import type { GapListRow } from '../model'
import { copyText, errorText } from '../text'
import type { GapDraftSave } from './GapDraftDrawer'
import { faqPageJsonLdText } from './jsonLd'
import { GAP_STATUS_LABEL } from './status'

export interface GapEdits {
  /** The person's edits per prompt, from `gaps:getStates`. */
  states: readonly GapRowState[]
  /** The project's brand names (for the draft's brand line). */
  brands: readonly string[]
  /** False when this client cannot store edits (an older fake). */
  editable: boolean
  error: string | null
  setStatus: (rows: readonly GapListRow[], status: GapStatus) => Promise<void>
  saveDraft: (row: GapListRow, change: GapDraftSave) => Promise<void>
  /** Opens the Fix drawer prefilled with these rows' prompts. */
  planFix: (pageId: string, rows: readonly GapListRow[]) => void
  /** Copies the rows' drafts as FAQPage JSON-LD. False when none has a draft. */
  copyJsonLd: (rows: readonly GapListRow[]) => Promise<boolean>
}

/**
 * Content gap edits for one page: FAQ drafts, open/published/verified (with
 * Undo), plan as a fix, and FAQPage JSON-LD. `reloadKey` reads the states again.
 */
export function useGapEdits(
  client: ShellClient,
  projectId: string,
  pageId: string,
  reloadKey: unknown,
  /** After a status write (or its undo): the matrix's done marks changed too. */
  onStatusWritten?: () => void
): GapEdits {
  const [states, setStates] = useState<readonly GapRowState[]>([])
  const [brands, setBrands] = useState<readonly string[]>([])
  const [error, setError] = useState<string | null>(null)
  const editable = Boolean(client.getGapStates && client.updateGapDraft && client.setGapStatus)

  useEffect(() => {
    let cancelled = false
    const read = client.getGapStates
    if (read) {
      void Promise.resolve()
        .then(() => read({ projectId, pageId }))
        .then(
          (next) => {
            if (!cancelled) setStates(next.states)
          },
          () => {
            // The matrix still shows; the edits load with the next reload.
          }
        )
    }
    void Promise.resolve()
      .then(() => client.getProject({ projectId }))
      .then(
        (project) => {
          if (!cancelled) setBrands(project.brandNames)
        },
        () => undefined
      )
    return () => {
      cancelled = true
    }
  }, [client, projectId, pageId, reloadKey])

  const apply = useCallback((next: GapStates) => setStates(next.states), [])

  const writeStatus = useCallback(
    async (promptIds: readonly string[], status: GapStatus, publishedUrl?: string | null) => {
      if (!client.setGapStatus) throw new Error('This screen cannot change the status.')
      apply(
        await client.setGapStatus({
          projectId,
          pageId,
          promptIds,
          status,
          ...(publishedUrl !== undefined ? { publishedUrl } : {})
        })
      )
      onStatusWritten?.()
    },
    [client, projectId, pageId, apply, onStatusWritten]
  )

  const setStatus = useCallback(
    async (rows: readonly GapListRow[], status: GapStatus) => {
      const changing = rows.filter((row) => row.status !== status)
      if (changing.length === 0) return
      setError(null)
      try {
        await writeStatus(
          changing.map((row) => row.promptId),
          status
        )
      } catch (cause: unknown) {
        setError(errorText(cause, 'Could not change the status.'))
        return
      }
      // Undo puts each row back where it was (rows may have come from different statuses).
      const before = new Map<GapStatus, GapListRow[]>()
      for (const row of changing) before.set(row.status, [...(before.get(row.status) ?? []), row])
      showUndo({
        message: `${GAP_STATUS_LABEL[status]}: ${pluralize(changing.length, 'question')}.`,
        effect: status === 'open' ? null : 'Marked done on the matrix too.',
        testId: 'gap-status-toast',
        undo: async () => {
          for (const [previous, group] of before) {
            await writeStatus(
              group.map((row) => row.promptId),
              previous,
              previous === 'open' ? null : (group[0]?.publishedUrl ?? null)
            )
          }
        }
      })
    },
    [writeStatus]
  )

  const saveDraft = useCallback(
    async (row: GapListRow, change: GapDraftSave) => {
      if (!client.updateGapDraft) throw new Error('This screen cannot save drafts.')
      if (change.draft !== null) {
        apply(
          await client.updateGapDraft({
            projectId,
            pageId,
            promptId: row.promptId,
            question: change.draft === 'reset' ? '' : change.draft.question,
            answer: change.draft === 'reset' ? '' : change.draft.answer,
            ...(change.draft === 'reset' ? { reset: true } : {})
          })
        )
      }
      if (change.status !== null) {
        await writeStatus([row.promptId], change.status.status, change.status.publishedUrl)
      }
      const previous = row.faqEdited && row.suggestedFaq ? row.suggestedFaq : null
      if (change.draft !== null) {
        showUndo({
          message:
            change.draft === 'reset'
              ? `Question ${row.position}: back to CiteFox AI’s draft.`
              : `Saved the FAQ draft for question ${row.position}.`,
          testId: 'gap-draft-toast',
          undo: async () => {
            if (!client.updateGapDraft) return
            apply(
              await client.updateGapDraft({
                projectId,
                pageId,
                promptId: row.promptId,
                question: previous?.question ?? '',
                answer: previous?.answer ?? '',
                ...(previous === null ? { reset: true } : {})
              })
            )
          }
        })
      }
    },
    [client, projectId, pageId, apply, writeStatus]
  )

  const planFix = useCallback((page: string, rows: readonly GapListRow[]) => {
    const first = rows[0]
    openDrawer('fix', {
      fix: 'new',
      'fix.page': page,
      'fix.prompts': rows.map((row) => row.promptId).join(','),
      ...(rows.length === 1 && first ? { 'fix.from': first.id } : {})
    })
  }, [])

  const copyJsonLd = useCallback(async (rows: readonly GapListRow[]) => {
    const text = faqPageJsonLdText(rows.map((row) => row.suggestedFaq))
    if (text === null) return false
    return copyText(text)
  }, [])

  return { states, brands, editable, error, setStatus, saveDraft, planFix, copyJsonLd }
}
