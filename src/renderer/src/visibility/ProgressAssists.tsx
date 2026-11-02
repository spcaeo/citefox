import type { AssistClient } from '../assist/client'
import { useAssistMenu, type AssistMenu } from '../ui'

/** What every Progress assist reads. Saved checks only, never a new search. */
export const PROGRESS_AI_FOOTER =
  'Uses the checks already saved, before and after the fix went live. No new searches.'

/**
 * Progress assists (FR-25, Mockups/Progress.dc.html) as the section's one AI
 * menu: the next fix, a draft of it, and whether a logged fix moved prompts in
 * other markets (the fix on show in the Fixes tab, else the newest one).
 */
export function useProgressAssistMenu({
  projectId,
  pageId,
  marketId,
  nextFixNumber,
  fixNumber,
  client
}: {
  projectId: string
  pageId: string
  marketId: string | null
  /** From the latest results. 1 when no fix is logged yet. */
  nextFixNumber: number
  /** The logged fix "worked in other markets" asks about. Null before any fix is logged. */
  fixNumber: number | null
  client?: AssistClient
}): AssistMenu {
  return useAssistMenu({
    scope: { projectId, pageId, marketId, ...(client ? { client } : {}) },
    footer: PROGRESS_AI_FOOTER,
    actions: [
      { assistId: 'progress.nextFix', label: 'Suggest next fix', seconds: 8 },
      {
        assistId: 'progress.draftFix',
        label: `Draft Fix ${nextFixNumber}`,
        seconds: 10,
        inputs: { fixNumber: nextFixNumber }
      },
      ...(fixNumber !== null
        ? [
            {
              assistId: 'progress.otherMarkets',
              label: `Check if Fix ${fixNumber} worked in other markets`,
              seconds: 8,
              inputs: { fixNumber }
            }
          ]
        : [])
    ]
  })
}
