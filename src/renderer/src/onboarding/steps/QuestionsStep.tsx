import type { JSX } from 'react'
import { PROMPT_SHAPES, type SetupItem } from '@shared/ipc'
import { TOPIC_STAGE_LABEL, TOPIC_STAGES, type TopicStage } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { ClaudeWait, LinkedText, useClaudePause } from '../../components/claudePause'
import { BusyLine, Button } from '../../ui'
import { SectionCard, SetupStepFrame, SitePage, useSectionEnv } from '../sections'
import { StartOverStep } from '../sections/StartOverStep'
import { keptCount } from '../sections/merge'
import { USUAL_SECONDS } from '../usualTimes'
import { SHAPE_COPY, shapeOf } from './shapeCopy'
import type { SetupStepProps } from './types'
import { MORE_COUNT, SHAPE_NOUN, type PromptWriter } from './usePromptWriter'

const STAGE_OPTIONS = [
  { value: '', label: 'No stage' },
  ...TOPIC_STAGES.map((stage) => ({ value: stage, label: TOPIC_STAGE_LABEL[stage] }))
]

const SHAPE_OPTIONS = PROMPT_SHAPES.map((shape) => ({
  value: shape,
  label: SHAPE_COPY[shape].one
}))

const QUESTION_FIELDS = [
  { key: 'name', label: 'Prompt', placeholder: 'The prompt, as a buyer would type it' },
  { key: 'detail', label: 'Shape', options: SHAPE_OPTIONS },
  { key: 'tag', label: 'Stage', options: STAGE_OPTIONS },
  { key: 'url', label: 'Page that should answer it', placeholder: '/page/', mono: true }
] as const

function stageLabel(tag: string | null): string | null {
  if (!tag) return null
  const stage = TOPIC_STAGES.find((item) => item === tag) as TopicStage | undefined
  return stage ? TOPIC_STAGE_LABEL[stage] : null
}

export interface QuestionsStepProps extends SetupStepProps {
  /** Step 8 and 9's writer: it may still be writing when the step opens. */
  writer: PromptWriter
  /** The first check needs more than the keys have left. Null when it fits or nobody knows. */
  creditWarning?: string | null
}

/**
 * Step 9, "Your first topic and what buyers ask AI": the topic (a text line with ✎)
 * and the prompts, written to step 8's mix (each row shows its shape), with ✦ 3 more
 * of any shape. The primary is "Finish and run the first check"; the footer shows
 * `footNote` (the first check's cost) and a warning when the keys have less left.
 * It needs a topic and at least one kept prompt.
 */
export function QuestionsStep({
  writer,
  creditWarning = null,
  ...props
}: QuestionsStepProps): JSX.Element {
  const env = useSectionEnv(props)
  const pause = useClaudePause(Boolean(writer.error), null)
  const { draft } = props
  const site = draft.site.domain.trim()
  const kept = keptCount(draft.lists.questions)
  const hasTopic = draft.topic.trim().length > 0
  const ready = hasTopic && kept > 0
  const writingAll = writer.writing === 'topic' || writer.writing === 'questions'
  const note = props.busy
    ? 'Saving your setup and starting the first check…'
    : writer.writing
      ? 'CiteFox AI is writing…'
      : !hasTopic
        ? 'Add a topic to finish'
        : kept === 0
          ? 'Keep at least one prompt to finish'
          : (props.footNote ?? `${pluralize(kept, 'prompt')} to check`)

  return (
    <SetupStepFrame
      step={9}
      title="Your first topic and what buyers ask AI"
      from="✦ Written from steps 4–8"
      sub="Tick the prompts to track. You can add more any time."
      alert={props.alert}
      onBack={props.onBack}
      note={note}
      primary={{
        label: 'Finish and run the first check',
        onClick: props.onContinue,
        disabled: !ready || props.busy || writingAll,
        busy: props.busy,
        icon: null
      }}
      headAction={<StartOverStep step={props} sections={['topic', 'questions']} />}
    >
      <BusyLine
        active={writer.writing === 'topic'}
        label="CiteFox AI is writing your topic from steps 4–6"
        usual={USUAL_SECONDS.firstTopic}
        announce={props.announce}
        className="osc-hint osc-running"
      />
      <BusyLine
        active={writer.writing === 'questions'}
        label={`CiteFox AI is writing prompts for “${draft.topic.trim()}”`}
        usual={USUAL_SECONDS.firstQuestions}
        announce={props.announce}
        className="osc-hint osc-running"
      />
      {writer.error ? (
        <p className="osc-hint osc-bad" role="alert">
          <LinkedText text={writer.error} />
          {pause ? (
            <>
              {' '}
              <ClaudeWait pause={pause} look="link" className="osc-link" />
            </>
          ) : null}
        </p>
      ) : null}
      {creditWarning ? (
        <div className="panel-warn osc-credit" role="status">
          <p>{creditWarning}</p>
        </div>
      ) : null}
      <SectionCard
        variant="text"
        look="field"
        env={env}
        working={writer.writing === 'topic'}
        section="topic"
        title="Topic"
        placeholder="The situation your buyers are in"
        redoLabel="Rewrite the topic"
      />
      <SectionCard
        variant="list"
        env={env}
        working={writer.writing === 'questions'}
        list="questions"
        title="Prompts"
        noun={{ one: 'prompt', many: 'prompts' }}
        findMoreLabel="Write more"
        findMoreMenuLabel="Write more prompts"
        findMoreHint="from steps 4–8"
        addPlaceholder="+ Type a prompt a buyer would use"
        fields={QUESTION_FIELDS}
        aiLabel={null}
        redoLabel="Redo prompts"
        renderSub={(item: SetupItem) => {
          const shape = SHAPE_COPY[shapeOf(item)].one
          const stage = stageLabel(item.tag)
          return (
            <>
              <span className="osc-shape-tag">{shape}</span>
              {stage ? ` · ${stage}` : null}
              {item.url ? (
                <>
                  {' · page '}
                  <SitePage value={item.url} site={site} />
                </>
              ) : null}
              {item.origin === 'user' && !item.edited ? ' · added by you' : null}
            </>
          )
        }}
      />
      <div className="osc-more-shapes" role="group" aria-label="Write more of one kind">
        {PROMPT_SHAPES.map((shape) => (
          <Button
            key={shape}
            size="sm"
            variant="secondary"
            icon="sparkle"
            busy={writer.writing === shape}
            busyLabel="Writing…"
            disabled={writer.writing !== null && writer.writing !== shape}
            onClick={() => writer.more(shape)}
          >
            {MORE_COUNT} more {SHAPE_NOUN[shape][1]}
          </Button>
        ))}
      </div>
    </SetupStepFrame>
  )
}
