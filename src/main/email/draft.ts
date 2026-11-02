import type { EmailAttachment } from './transport'

/**
 * FR-23.1. `mail_app` opens a draft and waits for a click. It does not send.
 * The opener is injected so tests never launch a mail app.
 */
export interface MailDraft {
  to: readonly string[]
  subject: string
  body: string
  attachments: readonly EmailAttachment[]
}

export interface MailAppDraftOpener {
  openDraft(draft: MailDraft): Promise<void>
}

export function unconfiguredDraftOpener(): MailAppDraftOpener {
  return {
    async openDraft(): Promise<void> {
      throw new Error('Mail app is not configured.')
    }
  }
}

export class MemoryDraftOpener implements MailAppDraftOpener {
  readonly drafts: MailDraft[] = []
  failure: Error | null = null

  async openDraft(draft: MailDraft): Promise<void> {
    if (this.failure) throw this.failure
    this.drafts.push({
      to: [...draft.to],
      subject: draft.subject,
      body: draft.body,
      attachments: [...draft.attachments]
    })
  }
}
