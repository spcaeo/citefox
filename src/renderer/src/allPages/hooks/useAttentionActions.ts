import { useState } from 'react'
import type { PageStatus } from '@shared/domain'
import type { PointPromptUndo, UntrackedCitation, WrongPageCase } from '@shared/ipc'
import { messageOf } from '../../grid/hooks/useSavedViews'
import type { AllPagesSource } from '../source'

/** What happened to a "Wrong page cited" case: Point it here or Merge (both undoable), or why not. */
export type WrongDone =
  | { kind: 'pointed'; message: string; undo: PointPromptUndo }
  | { kind: 'merged'; message: string; fixId: string }
  | { kind: 'blocked'; message: string }

/** What happened to an own page cited but not tracked: tracked (undoable), or why not. */
export type UntrackedDone =
  | { kind: 'tracked'; message: string; pageId: string; previous: PageStatus | null }
  | { kind: 'error'; message: string }

export interface AttentionActions {
  wrongDone: (item: WrongPageCase) => WrongDone | undefined
  untrackedDone: (item: UntrackedCitation) => UntrackedDone | undefined
  isIgnored: (item: UntrackedCitation) => boolean
  isBusy: (key: string) => boolean
  /** The last outcome, for the polite live region. */
  announcement: string
  pointHere: (item: WrongPageCase) => void
  merge: (item: WrongPageCase) => void
  undoWrong: (item: WrongPageCase) => void
  track: (item: UntrackedCitation) => void
  undoTrack: (item: UntrackedCitation) => void
  ignore: (item: UntrackedCitation, value: boolean) => void
}

/**
 * FR-20.4 and FR-20.5 row actions for the "Needs attention" list. Each row
 * keeps its outcome (with its Undo) in place; `onChanged` reloads the grid
 * after a change that moves pages or prompts.
 */
export function useAttentionActions(
  source: AllPagesSource,
  projectId: string,
  onChanged: () => void
): AttentionActions {
  const [wrong, setWrong] = useState<Readonly<Record<string, WrongDone>>>({})
  const [untracked, setUntracked] = useState<Readonly<Record<string, UntrackedDone>>>({})
  const [ignored, setIgnored] = useState<Readonly<Record<string, boolean>>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')

  async function busyWith(key: string, work: () => Promise<void>): Promise<void> {
    setBusy(key)
    try {
      await work()
    } finally {
      setBusy(null)
    }
  }

  function actOnWrong(item: WrongPageCase, work: () => Promise<WrongDone>): void {
    void busyWith(item.id, async () => {
      let result: WrongDone
      try {
        result = await work()
      } catch (cause) {
        result = { kind: 'blocked', message: messageOf(cause, 'That did not work. Try again.') }
      }
      setWrong((current) => ({ ...current, [item.id]: result }))
      setAnnouncement(result.message)
      if (result.kind !== 'blocked') onChanged()
    })
  }

  return {
    wrongDone: (item) => wrong[item.id],
    untrackedDone: (item) => untracked[item.normalizedUrl],
    isIgnored: (item) => ignored[item.normalizedUrl] ?? item.ignored,
    isBusy: (key) => busy === key,
    announcement,
    pointHere: (item) =>
      actOnWrong(item, async () => {
        if (item.citedPageId === null) {
          return { kind: 'blocked', message: 'Track the cited page first.' }
        }
        const result = await source.pointHere({
          projectId,
          fromPageId: item.pageId,
          promptId: item.promptId,
          toPageId: item.citedPageId
        })
        return result.ok
          ? { kind: 'pointed', message: result.message, undo: result.undo }
          : { kind: 'blocked', message: `${result.message} ${result.nextStep}` }
      }),
    merge: (item) =>
      actOnWrong(item, async () => {
        const result = await source.merge({
          projectId,
          pageId: item.pageId,
          marketId: item.marketId,
          promptId: item.promptId,
          citedUrl: item.citedUrl
        })
        return { kind: 'merged', message: result.message, fixId: result.fixId }
      }),
    undoWrong: (item) => {
      const state = wrong[item.id]
      if (!state || state.kind === 'blocked') return
      void busyWith(item.id, async () => {
        if (state.kind === 'pointed') await source.undoPoint({ projectId, ...state.undo })
        if (state.kind === 'merged') await source.undoMerge({ projectId, fixId: state.fixId })
        setWrong((current) => {
          const next = { ...current }
          delete next[item.id]
          return next
        })
        setAnnouncement('Undone.')
        onChanged()
      })
    },
    track: (item) =>
      void busyWith(item.normalizedUrl, async () => {
        let result: UntrackedDone
        try {
          const tracked = await source.trackUrl({ projectId, url: item.url })
          result = {
            kind: 'tracked',
            message: 'Tracked · its first check runs after setup',
            pageId: tracked.pageId,
            previous: tracked.previousStatus
          }
        } catch (cause) {
          result = { kind: 'error', message: messageOf(cause, 'Could not track it.') }
        }
        setUntracked((current) => ({ ...current, [item.normalizedUrl]: result }))
        setAnnouncement(result.message)
        if (result.kind === 'tracked') onChanged()
      }),
    undoTrack: (item) => {
      const state = untracked[item.normalizedUrl]
      if (state?.kind !== 'tracked') return
      void busyWith(item.normalizedUrl, async () => {
        await source.undoTrack({ projectId, pageId: state.pageId, previousStatus: state.previous })
        setUntracked((current) => {
          const next = { ...current }
          delete next[item.normalizedUrl]
          return next
        })
        setAnnouncement('Undone.')
        onChanged()
      })
    },
    ignore: (item, value) =>
      void busyWith(item.normalizedUrl, async () => {
        await source.ignoreUrl({ projectId, url: item.url, ignored: value })
        setIgnored((current) => ({ ...current, [item.normalizedUrl]: value }))
        setAnnouncement(value ? 'Ignored.' : 'No longer ignored.')
      })
  }
}
