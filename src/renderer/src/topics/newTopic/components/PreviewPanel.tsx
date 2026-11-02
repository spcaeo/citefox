import type { JSX } from 'react'
import { TOPIC_STAGE_LABEL, type TopicDraftPrompt } from '@shared/domain'
import { ToolButton } from '../../../ui'
import type { NewTopicWay } from '../types'
import { previewLines } from '../utils/plan'

const SOURCE_NOTE: Readonly<Record<NewTopicWay, string>> = {
  problem: 'Written from your buyer profile, no searches used',
  page: 'Written from your buyer profile, no searches used',
  questions: 'From your list, no searches used',
  competitor: 'Written from their page, no searches used'
}

/** "Preview · N questions across the buyer journey": one question per stage. */
export function PreviewPanel({
  way,
  questions,
  busy,
  fromAnswer = false,
  onAgain
}: {
  way: NewTopicWay
  questions: readonly TopicDraftPrompt[]
  busy: boolean
  /** The questions came from a pasted chatbot answer: no "Write again" (paste again instead). */
  fromAnswer?: boolean
  onAgain: () => void
}): JSX.Element {
  const lines = previewLines(questions)
  const unstaged = questions.filter((prompt) => prompt.stage === null).slice(0, 3)
  return (
    <section className="nt-preview" aria-label="Preview" aria-busy={busy || undefined}>
      <header className="nt-preview-head">
        <h3 className="nt-preview-title">
          Preview · {questions.length} {questions.length === 1 ? 'question' : 'questions'} across
          the buyer journey
        </h3>
        {fromAnswer ? null : (
          <ToolButton
            kind="refresh"
            label={way === 'questions' ? 'Add again' : 'Write again'}
            onClick={onAgain}
            disabled={busy}
          />
        )}
      </header>
      <ul className="nt-preview-list">
        {lines.map((line) => (
          <li key={line.stage} className="nt-preview-row">
            <span className="nt-stage">{TOPIC_STAGE_LABEL[line.stage]}</span>
            <span className="nt-preview-text">{line.text}</span>
          </li>
        ))}
        {lines.length === 0
          ? unstaged.map((prompt) => (
              <li key={prompt.id} className="nt-preview-row">
                <span className="nt-stage">No stage</span>
                <span className="nt-preview-text">{prompt.text}</span>
              </li>
            ))
          : null}
      </ul>
      <p className="nt-hint">
        {fromAnswer ? 'From your chatbot’s answer, no searches used' : SOURCE_NOTE[way]}
      </p>
    </section>
  )
}
