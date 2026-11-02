import { recordNotice, registerNoticeKind, type NoticeHost } from '../notices/service'

/** "Ask me" notice kind for a page whose automatic setup gave up after its retries. */
export const SETUP_FAILED_NOTICE = 'setup_failed'
export const SETUP_RETRY = 'retry'
export const SETUP_LATER = 'later'

let registered = false

function registerKind(): void {
  if (registered) return
  registered = true
  registerNoticeKind(SETUP_FAILED_NOTICE, (_notice, actionId) =>
    actionId === SETUP_RETRY
      ? 'CiteFox is setting the page up again now.'
      : 'CiteFox will wait. Choose Retry on the page when you are ready.'
  )
}

/**
 * One open notice per page: setup stopped for good. Its one primary action
 * retries the page; the runner hears it through `onNoticeResolved`.
 */
export function recordSetupFailedNotice(
  host: NoticeHost,
  input: {
    projectId: string
    pageId: string
    /** The page label, title or address. */
    pageName: string
    reason: string
    nextStep: string | null
  },
  secrets: readonly string[] = []
): boolean {
  registerKind()
  return recordNotice(
    host,
    {
      kind: SETUP_FAILED_NOTICE,
      projectId: input.projectId,
      dedupeKey: `setup-failed:${input.projectId}:${input.pageId}`,
      title: `Setup stopped for ${input.pageName}`,
      body: `${input.reason}${input.nextStep === null ? '' : ` ${input.nextStep}`}`,
      actions: [
        { id: SETUP_RETRY, label: 'Retry', primary: true },
        { id: SETUP_LATER, label: 'Later', primary: false }
      ],
      data: { pageId: input.pageId }
    },
    secrets
  )
}
