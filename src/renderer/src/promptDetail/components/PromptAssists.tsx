import type { AssistClient } from '../../assist/client'
import { useAssistMenu, type AssistMenu } from '../../ui'

/**
 * Claude assists for one prompt (FR-25, Mockups/PromptDetail.dc.html) as the
 * screen's one AI menu: a draft fix to paste into the page, and why another
 * source is listed first. Both read the saved check only.
 */
export function usePromptAssists({
  projectId,
  pageId,
  marketId,
  promptId,
  first,
  client
}: {
  projectId: string
  pageId: string
  marketId: string
  promptId: string
  /** True when the page is already first, or there was no overview: hides "Why isn't my page first?". */
  first: boolean
  client?: AssistClient
}): AssistMenu {
  return useAssistMenu({
    label: 'AI actions for this question',
    scope: { projectId, pageId, marketId, promptId, ...(client ? { client } : {}) },
    actions: [
      { assistId: 'gaps.draftFix', label: 'Draft the fix', seconds: 15 },
      ...(first
        ? []
        : [{ assistId: 'results.whyNotFirst', label: "Why isn't my page first?", seconds: 8 }])
    ]
  })
}
