import { useState } from 'react'
import type { StoredOverviewRead } from '@shared/overview-read'
import { overviewReadFromReply } from '@shared/overview-read'
import type { AssistClient } from '../../../assist/client'
import { useAssist, type AssistState } from '../../../assist/useAssist'
import { suggestionFootnote } from '../../../ui'

/** The assist behind "Analyse with Claude" (src/main/assist/definitions/overview-read.ts). */
export const OVERVIEW_READ_ASSIST = 'results.overviewRead'

/** A read on screen: saved earlier, or just answered (with its run line). */
export interface ShownRead extends StoredOverviewRead {
  /** "Claude · about 9 s · no searches" for a fresh answer; null for a saved one. */
  footnote: string | null
}

export interface OverviewReadState {
  assist: AssistState
  /** The read to show, or null when none is saved, or it was dismissed. */
  shown: ShownRead | null
  run: (instruction?: string | null) => void
  dismiss: () => void
}

/**
 * "Analyse with Claude" for one sample: runs the assist (which checks and saves the
 * read in main), shows the saved read when there is one, and hands a fresh answer to
 * the screen so switching samples and back keeps it.
 */
export function useOverviewRead({
  projectId,
  pageId,
  marketId,
  promptId,
  sampleId,
  saved,
  onFresh,
  client
}: {
  projectId: string
  pageId: string
  marketId: string
  promptId: string
  sampleId: string
  /** The saved read of this sample, from `checks:getPrompt` or an earlier answer. */
  saved: ShownRead | null
  onFresh: (read: ShownRead) => void
  client?: AssistClient
}): OverviewReadState {
  const [dismissed, setDismissed] = useState(false)
  const assist = useAssist({
    assistId: OVERVIEW_READ_ASSIST,
    projectId,
    pageId,
    marketId,
    promptId,
    inputs: { sampleId },
    ...(client ? { client } : {}),
    onResult: (result) => {
      const read = overviewReadFromReply(result)
      if (read === null) return
      onFresh({
        sampleId,
        ranAt: new Date().toISOString(),
        read,
        footnote: suggestionFootnote(result)
      })
    }
  })
  return {
    assist,
    shown: dismissed ? null : saved,
    run: (instruction) => {
      setDismissed(false)
      assist.run(instruction ?? null)
    },
    dismiss: () => {
      setDismissed(true)
      assist.close()
    }
  }
}
