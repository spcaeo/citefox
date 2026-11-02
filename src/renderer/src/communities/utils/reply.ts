import type { CommunityThread } from '@shared/domain'
import type { AssistResult } from '@shared/ipc'

/** FR-17.6 "Draft a helpful reply": the shared assist id. */
export const REPLY_ASSIST_ID = 'communities.reply'

/** What "Copy reply" puts on the clipboard: the answer, then the disclosure. */
export function replyCopyText(result: AssistResult): string {
  return result.items.map((item) => item.text.trim()).join('\n\n')
}

/** True when Reddit takes no new replies in this thread. */
export function replyClosed(thread: CommunityThread): boolean {
  return thread.replyState === 'archived' || thread.replyState === 'locked'
}
