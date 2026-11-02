import { forwardRef, useId, type JSX } from 'react'
import { TOPIC_STAGE_LABEL } from '@shared/domain'
import { Chip } from '../../ui'
import { keptQuestions, toggleQuestion, type SetupPlan } from './model'

/**
 * The buyer questions from the answer, one topic per product (panel 4's
 * "Questions" and "Topics suggested"). Ticked ones are created as topics after
 * Create project; nothing runs a search.
 */
export const QuestionsPlan = forwardRef<
  HTMLElement,
  {
    plan: SetupPlan
    disabled: boolean
    /** When the ticked questions are saved, such as "when you create the project". */
    savedWhen: string
    onPlan: (plan: SetupPlan) => void
  }
>(function QuestionsPlan({ plan, disabled, savedWhen, onPlan }, ref): JSX.Element {
  const headId = useId()
  const kept = keptQuestions(plan)
  return (
    <section
      ref={ref}
      className="su-plan"
      aria-labelledby={headId}
      tabIndex={-1}
      data-testid="su-plan"
    >
      <div className="su-plan-head">
        <p className="hf-label" id={headId}>
          Questions to start with · tick the ones to keep
        </p>
        <span className="hf-hint num">
          {kept} ticked in {plan.topics.length} {plan.topics.length === 1 ? 'topic' : 'topics'} ·
          added {savedWhen}, no searches
        </span>
      </div>
      {plan.topics.map((topic) => (
        <div className="su-topic" key={topic.id}>
          <p className="su-topic-name">
            {topic.name}
            {topic.situation ? <span className="su-topic-why"> · {topic.situation}</span> : null}
          </p>
          <ul className="su-questions" aria-label={`Questions for ${topic.name}`}>
            {topic.questions.map((question) => (
              <li key={question.id}>
                <label className="su-check">
                  <input
                    type="checkbox"
                    className="ui-check"
                    checked={question.keep}
                    disabled={disabled}
                    onChange={() => onPlan(toggleQuestion(plan, question.id))}
                  />
                  <span className="su-question">{question.text}</span>
                </label>
                <Chip tone="neutral" size="sm">
                  {TOPIC_STAGE_LABEL[question.stage]}
                </Chip>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
})
