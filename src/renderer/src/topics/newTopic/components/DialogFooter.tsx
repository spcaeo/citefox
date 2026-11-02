import type { DrawerFooterSpec } from '../../../ui'
import type { NewTopicActions, NewTopicState } from '../hooks/useNewTopic'
import { includedQuestions, pathFor } from '../utils/plan'

const NOTE = {
  start:
    'Next you edit the questions and choose which page should be cited for each. Nothing is searched until you say so.',
  questions:
    'Next you choose which page should be cited for each question. Nothing is searched until you say so.',
  pages: 'The topic is saved without a check. Nothing is searched until you say so.'
} as const

const WRITE_LABEL = {
  problem: 'Write questions',
  page: 'Write questions',
  questions: 'Add questions',
  competitor: 'Read their page'
} as const

/** True when the Start fields are enough to write (or read, or import) the questions. */
function canWrite(state: NewTopicState): boolean {
  if (state.way === 'problem') return state.situation.trim().length >= 3
  if (state.way === 'page') return state.pageUrl !== null
  if (state.way === 'competitor')
    return /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(state.competitorUrl.trim())
  return state.pasted.trim().length > 0
}

interface Primary {
  label: string
  onClick: () => void
  disabled: boolean
  next: boolean
  /** Shows "Claude · about N s" before the button. */
  claude: boolean
}

function primaryFor(state: NewTopicState, actions: NewTopicActions): Primary | null {
  const busy = state.busy !== null
  if (state.draftMissing || state.loadingDraft) return null
  if (state.step === 'pages') {
    const topicId = state.url.topicId
    if (topicId !== null)
      return {
        label: 'Done',
        onClick: () => actions.finish(topicId),
        disabled: busy,
        next: false,
        claude: false
      }
    return {
      label: 'Create topic',
      onClick: () => void actions.create(),
      disabled: busy,
      next: false,
      claude: false
    }
  }
  if (state.step === 'questions')
    return {
      label: 'Target pages',
      onClick: () => void actions.goPages(),
      disabled: busy || includedQuestions(state.draft).length === 0 || state.topicName === '',
      next: true,
      claude: false
    }
  if (state.fromQuestions)
    return {
      label: 'Create topic',
      onClick: () => void actions.createFromQuestions(),
      disabled: busy || state.topicName === '',
      next: false,
      claude: false
    }
  const ready =
    state.draft !== null &&
    state.draft.path === pathFor(state.way) &&
    includedQuestions(state.draft).length > 0
  if (ready)
    return {
      label: 'Review questions',
      onClick: () => actions.goStep('questions'),
      disabled: busy,
      next: true,
      claude: false
    }
  // Your own chatbot: the white "Read the answer" fills the preview; then Review questions.
  if (state.way === 'problem' && state.help.way === 'chatbot')
    return {
      label: 'Review questions',
      onClick: () => actions.goStep('questions'),
      disabled: true,
      next: true,
      claude: false
    }
  return {
    label: WRITE_LABEL[state.way],
    onClick: () => void actions.write(),
    disabled: busy || !canWrite(state),
    next: false,
    claude: state.way !== 'questions'
  }
}

/**
 * The drawer footer of New topic: the note on what comes next (with
 * "Claude · about N s" before a write), Cancel, and the step's one primary.
 */
export function newTopicFooter(state: NewTopicState, actions: NewTopicActions): DrawerFooterSpec {
  const primary = primaryFor(state, actions)
  const working = state.busy === 'write' || state.busy === 'create'
  return {
    summary: (
      <span className="nt-foot-note">
        {NOTE[state.step]}
        {primary?.claude && state.seconds !== null ? (
          <span className="nt-claude"> CiteFox AI · about {state.seconds} s</span>
        ) : null}
      </span>
    ),
    cancel: 'Cancel',
    ...(primary
      ? {
          primary: {
            label: primary.label,
            iconEnd: primary.next ? 'arrow-right' : undefined,
            busy: working,
            disabled: primary.disabled && !working,
            onClick: primary.onClick
          }
        }
      : {})
  }
}
