import type { TopicsClient } from '../wizard/client'
import type { ClustersSource } from '../clusters/source'

/** The dialog's three steps (NewTopic.dc.html stepper). */
export const NEW_TOPIC_STEPS = [
  { id: 'start', label: 'Start' },
  { id: 'questions', label: 'Review questions' },
  { id: 'pages', label: 'Target pages' }
] as const

export type NewTopicStep = (typeof NEW_TOPIC_STEPS)[number]['id']

/** Where the questions come from: the four cards on Start. */
export const NEW_TOPIC_WAYS = ['problem', 'page', 'questions', 'competitor'] as const

export type NewTopicWay = (typeof NEW_TOPIC_WAYS)[number]

/** The wizard channels the dialog calls (its engine is the topic wizard's). */
export type NewTopicClient = Pick<
  TopicsClient,
  | 'topics:createDraft'
  | 'topics:getDraft'
  | 'topics:updateDraft'
  | 'topics:generateQuestions'
  | 'topics:importQuestions'
  | 'topics:readCompetitorPage'
  | 'topics:competitorQuestions'
  | 'topics:matchPages'
  | 'topics:setTarget'
  | 'topics:describeStep'
>

/** What the dialog reads and writes: the wizard client plus the clusters channels. */
export interface NewTopicSources {
  client: NewTopicClient
  source: ClustersSource
}
