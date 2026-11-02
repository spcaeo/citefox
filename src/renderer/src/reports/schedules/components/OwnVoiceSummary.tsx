import { useMemo, useState, type JSX } from 'react'
import type { HelpFillBot } from '@shared/helpfill'
import { CopyDraft } from '../../../assistant/drawer/CopyDraft'
import { Button, createHelpFillSource, HelpFill, type HelpFillSource } from '../../../ui'
import '../../../assistant/drawer/ask-drawer.css'

const NOOP = (): void => undefined

/** Where the own-voice summary is on the URL and what it is about. */
export interface OwnVoiceState {
  projectId: string
  /** The saved schedule whose report numbers the prompt carries; null for a new one. */
  scheduleId: string | null
  bot: HelpFillBot | null
  onBot: (bot: HelpFillBot) => void
  onClose: () => void
  /** Tests only. */
  helpSource?: HelpFillSource
  openLink?: (url: string) => void
}

/**
 * Email preview → "Write it in your own voice with my ChatGPT" (HelpFill.dc.html
 * panel 7, Reports summary): the chatbot way only, since Claude already has its own
 * actions in this section's AI menu. The prompt carries the report's own numbers and
 * tells the chatbot to use only those; main's number check takes out any sentence with
 * a number the report does not hold, and says so. The summary shows with Copy. A
 * schedule keeps only a summary style, so this text is not saved with it.
 */
export function OwnVoiceSummary({
  projectId,
  scheduleId,
  bot,
  onBot,
  onClose,
  helpSource,
  openLink
}: OwnVoiceState): JSX.Element {
  const source = useMemo(() => helpSource ?? createHelpFillSource(), [helpSource])
  const [text, setText] = useState<string | null>(null)
  return (
    <section className="rpt-own" aria-labelledby="rpt-own-h" data-testid="rpt-own">
      <div className="rpt-own-head">
        <h4 id="rpt-own-h">Write it in your own voice</h4>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <HelpFill
        kind="reportSummary"
        projectId={projectId}
        scope={{ pageId: null, subject: scheduleId }}
        source={source}
        way={null}
        onWay={NOOP}
        bot={bot}
        onBot={onBot}
        only="chatbot"
        describe={{ label: '', buttonLabel: () => '' }}
        chatbot={{
          pastePlaceholder: (name) => `Paste the summary ${name} wrote…`,
          tip: 'The question holds this report’s numbers. A sentence with any other number is taken out.'
        }}
        onRows={(result) => setText(result.text ?? null)}
        {...(openLink ? { openLink } : {})}
        testId="rpt-own-hf"
      />
      {text ? (
        <div className="rpt-own-result" data-testid="rpt-own-result">
          <CopyDraft text={text} label="Your summary" />
          <p className="rpt-help">
            Copy it into your email or client update. A schedule keeps only the summary style, so
            this text is not saved with it.
          </p>
        </div>
      ) : null}
    </section>
  )
}
