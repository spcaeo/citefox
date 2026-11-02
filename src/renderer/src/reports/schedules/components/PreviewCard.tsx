import { useState, type JSX } from 'react'
import type { AssistClient } from '../../../assist/client'
import { Markdown } from '../../../components/Markdown'
import { AiMenu, SuggestionCard } from '../../../ui'
import { useAiSuggestion } from '../../../ui/useAiSuggestion'
import type { mailPreview } from '../../scheduleModel'
import type { SummaryPage } from '../utils/summaryPage'
import { OwnVoiceSummary, type OwnVoiceState } from './OwnVoiceSummary'

type SummaryStyle = 'standard' | 'client_friendly'

/** The last line of every scheduled report email (main `REPORT_EMAIL_FOOTER`). */
export const REPORT_EMAIL_FOOTER =
  'Sent by CiteFox from this computer. Change or stop this report in CiteFox › Reports.'

/** Sent with "Make it client-friendly" as the assist's instruction (FR-25.3). */
const CLIENT_FRIENDLY_INSTRUCTION =
  'Write it for a client who does not work in SEO: plain words, no jargon, every number kept.'

const STYLE_LABEL: Record<SummaryStyle, string> = {
  standard: 'Write the summary with CiteFox AI',
  client_friendly: 'Make it client-friendly'
}

/**
 * Where the summary preview comes from. `page` is undefined while it loads and
 * null when the project has no checked page yet.
 */
export interface SummarySource {
  projectId: string | null
  page: SummaryPage | null | undefined
}

/** The line under "Email preview", and whether the AI actions are off. */
function sourceLine(source: SummarySource): { text: string; off: boolean } {
  if (source.projectId === null) {
    return { text: 'Pick one project to preview CiteFox AI’s summary.', off: true }
  }
  if (source.page === undefined) return { text: 'Built from the latest check', off: true }
  if (source.page === null) {
    return {
      text: 'No checked page in this project yet, so CiteFox AI has nothing to summarise.',
      off: true
    }
  }
  return { text: `Latest check of ${source.page.name}`, off: false }
}

function instructionFor(style: SummaryStyle): string | null {
  return style === 'client_friendly' ? CLIENT_FRIENDLY_INSTRUCTION : null
}

/**
 * The email preview, with the section's one AI menu. Both actions run the
 * `report.summary` assist on the latest check of the project's page (the
 * client-friendly one with an instruction); the answer shows as one card.
 * Nothing changes until the user applies it, which sets the schedule's summary style.
 */
export function PreviewCard({
  preview,
  source,
  onApply,
  assistClient,
  ownVoice = null,
  onOwnVoice
}: {
  preview: ReturnType<typeof mailPreview>
  source: SummarySource
  onApply: (style: SummaryStyle) => void
  /** "Write it in your own voice with my ChatGPT", open (`schedule.help=chatbot`); null: closed. */
  ownVoice?: Omit<OwnVoiceState, 'projectId'> | null
  /** Opens it. Unset: the action is not offered. */
  onOwnVoice?: () => void
  /** Tests only. Production picks the client from the client mode. */
  assistClient?: AssistClient
}): JSX.Element {
  const [style, setStyle] = useState<SummaryStyle | null>(null)
  const suggestion = useAiSuggestion(
    {
      assistId: 'report.summary',
      projectId: source.projectId,
      pageId: source.page?.id ?? null,
      marketId: null,
      promptId: null,
      ...(assistClient ? { client: assistClient } : {})
    },
    'Summary by CiteFox AI'
  )
  const { run, close } = suggestion.assist
  const line = sourceLine(source)
  const start = (next: SummaryStyle): void => {
    setStyle(next)
    run(instructionFor(next))
  }
  return (
    <section className="rpt-preview" aria-labelledby="pv-h">
      <div className="rpt-preview-head">
        <div>
          <h3 id="pv-h">Email preview</h3>
          <p className="rpt-muted">{line.text}</p>
        </div>
        <AiMenu
          label="AI actions for the summary"
          footer="CiteFox AI runs on your AI plan from saved data; your own ChatGPT is free. Uses no searches."
          actions={[
            ...(['standard', 'client_friendly'] as const).map((id) => ({
              id,
              label: STYLE_LABEL[id],
              seconds: 10,
              ...(line.off ? { disabled: true } : {}),
              onSelect: () => start(id)
            })),
            ...(onOwnVoice
              ? [
                  {
                    id: 'own_voice',
                    label: 'Write it in your own voice with my ChatGPT',
                    ...(line.off ? { disabled: true } : {}),
                    onSelect: onOwnVoice
                  }
                ]
              : [])
          ]}
        />
      </div>
      {/* An email client is light: the preview stays light in the dark theme. */}
      <div className="rpt-mail" data-theme="light">
        <div className="rpt-mail-head">
          <span className="rpt-mail-subject">{preview.subject}</span>
          <span>
            <span className="rpt-k">From </span>
            <span className="mono">{preview.from}</span>
          </span>
          <span>
            <span className="rpt-k">To </span>
            <span className="mono">{preview.to}</span>
          </span>
        </div>
        <div className="rpt-mail-body">
          <p>
            <Markdown inline baseLevel={3}>
              {preview.greeting}
            </Markdown>
          </p>
          <ul>
            {preview.lines.map((line) => (
              <li key={line}>
                <Markdown inline baseLevel={3}>
                  {line}
                </Markdown>
              </li>
            ))}
          </ul>
          <p>
            {preview.attachLabel}{' '}
            {preview.attachFile ? <span className="mono">{preview.attachFile}</span> : null}
          </p>
          <p className="rpt-muted">{REPORT_EMAIL_FOOTER}</p>
        </div>
      </div>
      <p className="rpt-help">{preview.source}</p>
      {style && suggestion.open ? (
        <SuggestionCard
          {...suggestion.card}
          title={style === 'client_friendly' ? 'Client-friendly summary' : 'Summary by CiteFox AI'}
          applyLabel={
            style === 'client_friendly' ? 'Use the client-friendly summary' : 'Use this summary'
          }
          onApply={() => onApply(style)}
          onRetry={(instruction) => run(instruction ?? instructionFor(style))}
          onClose={() => {
            close()
            setStyle(null)
          }}
        />
      ) : null}
      {ownVoice && source.projectId !== null && !line.off ? (
        <OwnVoiceSummary projectId={source.projectId} {...ownVoice} />
      ) : null}
    </section>
  )
}
