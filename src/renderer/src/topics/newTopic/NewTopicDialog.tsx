import { useMemo, type JSX } from 'react'
import { useAiContext } from '../../assistant/context/useAiContext'
import { currentClientMode } from '../../onboarding/flags'
import {
  Button,
  createHelpFillSource,
  Drawer,
  LinkButton,
  Stepper,
  type HelpFillSource
} from '../../ui'
import { createClustersSource, type ClustersSource } from '../clusters/source'
import { createTopicsClient } from '../wizard/client'
import { addHash } from '../wizard/routes'
import { newTopicFooter } from './components/DialogFooter'
import { PagesStep } from './components/PagesStep'
import { ReviewStep } from './components/ReviewStep'
import { StartStep } from './components/StartStep'
import { useNewTopic } from './hooks/useNewTopic'
import { NEW_TOPIC_STEPS, type NewTopicClient, type NewTopicStep } from './types'
import './newTopic.css'

export interface NewTopicDialogProps {
  projectId: string
  onClose: () => void
  /**
   * The topic was made. Default: open it on the Topics screen and close. The
   * drawer router closes the drawers first, or hands the id back to the
   * drawer this one was opened from.
   */
  onFinish?: (topicId: string) => void
  /** Tests pass fakes; production uses the preload bridge (or the dev mock wizard). */
  client?: NewTopicClient
  source?: ClustersSource
  /** Tests pass a fake for the ✦ Help me fill channels. */
  helpSource?: HelpFillSource
}

/**
 * New topic (`?drawer=new-topic`): a lighter front door to the topic wizard, in three
 * steps (Start · Review questions · Target pages), in the shared Drawer. Its state is in
 * the URL next to `drawer` (`draft`, `step`, `way`, `questions`, `topic`), so a copied
 * link reopens it. Nothing is searched: the topic waits for Check now.
 */
export function NewTopicDialog({
  projectId,
  onClose,
  onFinish,
  client: givenClient,
  source: givenSource,
  helpSource: givenHelpSource
}: NewTopicDialogProps): JSX.Element {
  const client = useMemo(
    () => givenClient ?? createTopicsClient(currentClientMode()),
    [givenClient]
  )
  const source = useMemo(() => givenSource ?? createClustersSource(), [givenSource])
  const helpSource = useMemo(() => givenHelpSource ?? createHelpFillSource(), [givenHelpSource])
  const [state, actions] = useNewTopic({
    projectId,
    client,
    source,
    onClose,
    onFinish,
    helpSource
  })
  const { step } = state
  const at = NEW_TOPIC_STEPS.findIndex((item) => item.id === step)
  useAiContext({
    screen: 'drawer.new-topic',
    screenLabel: 'New topic',
    entities: state.topicName
      ? [{ kind: 'topic', label: state.topicName, detail: 'New topic' }]
      : [],
    filters: {
      step: NEW_TOPIC_STEPS[at]?.label ?? step,
      way: state.way,
      ...(state.way === 'problem' && state.help.way ? { help: state.help.way } : {})
    },
    capabilities: ['create-topic']
  })

  return (
    <Drawer
      id="new-topic"
      title="New topic"
      subtitle="Questions buyers ask about one problem, and the page that should be cited for each."
      step={{ current: at + 1, total: NEW_TOPIC_STEPS.length }}
      className="nt-drawer"
      testId="new-topic-drawer"
      focusKey={step}
      busy={state.busy !== null}
      onClose={actions.close}
      headerExtra={
        <div className="nt-steps">
          <Stepper
            label="New topic steps"
            steps={NEW_TOPIC_STEPS}
            current={step}
            onStep={
              state.url.topicId === null && state.busy === null
                ? (id) => actions.goStep(id as NewTopicStep)
                : undefined
            }
          />
          <LinkButton href={addHash(state.draft?.id ?? null)} variant="text" size="sm">
            Open the full wizard
          </LinkButton>
        </div>
      }
      footer={newTopicFooter(state, actions)}
    >
      <div className="nt-body">
        {state.draftMissing ? (
          <div className="nt-step">
            <p className="nt-error" role="alert">
              This draft is not available to you.
            </p>
            <Button onClick={actions.startAgain}>Start again</Button>
          </div>
        ) : state.loadingDraft ? (
          <p className="nt-hint" role="status">
            Opening the draft…
          </p>
        ) : step === 'pages' ? (
          <PagesStep state={state} actions={actions} />
        ) : step === 'questions' ? (
          <ReviewStep state={state} actions={actions} />
        ) : (
          <StartStep state={state} actions={actions} />
        )}
        {state.error ? (
          <p className="nt-error" role="alert">
            {state.error}
          </p>
        ) : null}
      </div>
    </Drawer>
  )
}
