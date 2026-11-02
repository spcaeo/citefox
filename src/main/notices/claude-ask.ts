import { CLAUDE_ASK_NOTICE } from '@shared/domain'
import { recordNotice, registerNoticeKind, type NoticeHost } from './service'

export const CLAUDE_RETRY = 'retry'
export const CLAUDE_NOT_NOW = 'not_now'

/**
 * FR-11.7 "ask me". When a project's Claude connection hits a limit or fails and
 * the rule is `ask`, the call stops (searches already made are kept) and this
 * records one open notice per project. "Try again now" is applied by whoever
 * listens (`onNoticeResolved`): the setup runner retries the project's pages.
 */
export function recordClaudeAskNotice(
  host: NoticeHost,
  input: { projectId: string | null; projectName: string | null; sentence: string },
  secrets: readonly string[] = []
): boolean {
  registerClaudeAskKind()
  const who = input.projectName ?? 'CiteFox'
  return recordNotice(
    host,
    {
      kind: CLAUDE_ASK_NOTICE,
      projectId: input.projectId,
      dedupeKey: `claude-ask:${input.projectId ?? 'app'}`,
      title: `Claude stopped for ${who}`,
      body: `${input.sentence} Switch to an API key in Project settings → Claude, or try again now.`,
      actions: [
        { id: CLAUDE_RETRY, label: 'Try again now', primary: true },
        { id: CLAUDE_NOT_NOW, label: 'Not now', primary: false }
      ]
    },
    secrets
  )
}

let registered = false

export function registerClaudeAskKind(): void {
  if (registered) return
  registered = true
  registerNoticeKind(CLAUDE_ASK_NOTICE, (_notice, actionId) =>
    actionId === CLAUDE_RETRY
      ? 'CiteFox is trying Claude again now.'
      : 'CiteFox will wait. Choose Retry on the Status screen when Claude is ready.'
  )
}
