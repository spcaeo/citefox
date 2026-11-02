import { INTERVAL_DAYS, type TopicSummary } from '@shared/domain'
import type { UpdateTopicRequest } from '@shared/ipc'

/** How often a topic can be checked (`topics:update intervalDays`). */
export const INTERVALS = INTERVAL_DAYS

export interface TopicSettingsForm {
  name: string
  paused: boolean
  intervalDays: (typeof INTERVALS)[number]
}

export type TopicSettingsPatch = Pick<UpdateTopicRequest, 'name' | 'intervalDays' | 'status'>

/** Only the fields the form changed; an empty object when nothing did. */
export function settingsPatch(
  topic: Pick<TopicSummary, 'name' | 'status' | 'intervalDays'>,
  form: TopicSettingsForm
): TopicSettingsPatch {
  const name = form.name.trim().replace(/\s+/gu, ' ')
  const status = form.paused ? 'paused' : 'tracked'
  const wasPaused = topic.status === 'paused'
  return {
    ...(name !== topic.name && name.length > 0 ? { name } : {}),
    ...(form.intervalDays !== topic.intervalDays ? { intervalDays: form.intervalDays } : {}),
    ...(form.paused !== wasPaused ? { status } : {})
  }
}

/** The hash that opens the topic with Add questions aimed at it. */
export function addQuestionsToTopicHash(topicId: string): string {
  const id = encodeURIComponent(topicId)
  return `#/topics/${id}?drawer=add-questions&target=${id}`
}
