import type { TopicSummary } from '@shared/domain'
import type { ClustersSource } from '../clusters/source'
import { notifyTopicsChanged } from '../clusters/events'
import { showUndo } from '../../ui'

/**
 * Topic actions that act at once and offer Undo in the window-wide toast
 * (feat/crud): pause or resume checks, duplicate, remove, merge. Each one calls its
 * channel per topic, tells open screens the topics changed, and returns the
 * toast's words so a screen can also say them in its own status line.
 */

export type TopicActionsSource = Pick<
  ClustersSource,
  'topics:update' | 'topics:duplicate' | 'topics:merge'
>

/** Merge also moves questions back on Undo. */
export type TopicMergeSource = TopicActionsSource & Pick<ClustersSource, 'topics:moveQuestions'>

export interface TopicRef {
  id: string
  name: string
}

function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
}

function topicsWord(topics: readonly TopicRef[]): string {
  return topics.length === 1
    ? (topics[0]?.name ?? 'the topic')
    : count(topics.length, 'topic', 'topics')
}

async function setStatus(
  source: TopicActionsSource,
  projectId: string,
  topics: readonly TopicRef[],
  status: 'tracked' | 'paused' | 'removed'
): Promise<void> {
  for (const topic of topics) {
    await source['topics:update']({ projectId, topicId: topic.id, status })
  }
  notifyTopicsChanged()
}

/** Pause (`paused`) or resume (`tracked`) scheduled checks. Check now still runs. */
export async function setTopicsPaused(
  source: TopicActionsSource,
  projectId: string,
  topics: readonly TopicRef[],
  paused: boolean
): Promise<string> {
  if (topics.length === 0) return 'Nothing changed.'
  await setStatus(source, projectId, topics, paused ? 'paused' : 'tracked')
  const message = paused
    ? `Paused checks for ${topicsWord(topics)}.`
    : `Resumed checks for ${topicsWord(topics)}.`
  showUndo({
    message,
    effect: paused ? 'Check now still works while paused.' : null,
    undo: () => setStatus(source, projectId, topics, paused ? 'tracked' : 'paused'),
    testId: 'topic-undo'
  })
  return message
}

/** Removes topics from the list; their questions and history are kept, and Undo brings them back. */
export async function removeTopics(
  source: TopicActionsSource,
  projectId: string,
  topics: readonly (TopicRef & { status?: TopicSummary['status'] })[]
): Promise<string> {
  if (topics.length === 0) return 'Nothing changed.'
  await setStatus(source, projectId, topics, 'removed')
  const message = `Deleted ${topicsWord(topics)}.`
  showUndo({
    message,
    effect: 'Questions and history are kept.',
    undo: async () => {
      for (const topic of topics) {
        // A paused topic comes back paused.
        const status = topic.status === 'paused' ? 'paused' : 'tracked'
        await source['topics:update']({ projectId, topicId: topic.id, status })
      }
      notifyTopicsChanged()
    },
    undoneMessage:
      topics.length === 1 ? `${topics[0]?.name ?? 'The topic'} is back.` : 'They are back.',
    testId: 'topic-undo'
  })
  return message
}

/** Copies each topic ("<name> (copy)"); Undo deletes the copies. Returns the new ids too. */
export async function duplicateTopics(
  source: TopicActionsSource,
  projectId: string,
  topics: readonly TopicRef[],
  name?: string
): Promise<{ message: string; topicIds: string[] }> {
  const made: TopicRef[] = []
  for (const topic of topics) {
    const result = await source['topics:duplicate']({
      projectId,
      topicId: topic.id,
      ...(name && topics.length === 1 ? { name } : {})
    })
    made.push({ id: result.topicId, name: result.name })
  }
  notifyTopicsChanged()
  const message =
    made.length === 1
      ? `Made ${made[0]?.name ?? 'a copy'}.`
      : `Made ${count(made.length, 'copy', 'copies')}.`
  showUndo({
    message,
    effect: 'Nothing is checked until you press Check now.',
    undo: () => setStatus(source, projectId, made, 'removed'),
    undoneMessage: made.length === 1 ? 'The copy is gone.' : 'The copies are gone.',
    testId: 'topic-undo'
  })
  return { message, topicIds: made.map((topic) => topic.id) }
}

/**
 * Merges every topic into `into`, one at a time (questions move with their
 * history). Undo brings each merged topic back (paused ones paused) and moves
 * its questions back out of `into`.
 */
export async function mergeTopics(
  source: TopicMergeSource,
  projectId: string,
  topics: readonly (TopicRef & { status?: TopicSummary['status'] })[],
  into: TopicRef
): Promise<string> {
  let moved = 0
  const undo: { topic: (typeof topics)[number]; promptIds: string[] }[] = []
  for (const topic of topics) {
    if (topic.id === into.id) continue
    const result = await source['topics:merge']({
      projectId,
      topicId: topic.id,
      intoTopicId: into.id
    })
    moved += result.moved
    undo.push({ topic, promptIds: result.promptIds.map((item) => item.to) })
  }
  notifyTopicsChanged()
  const merged = topics.filter((topic) => topic.id !== into.id)
  const message = `Merged ${topicsWord(merged)} into ${into.name} (${count(moved, 'question', 'questions')} moved).`
  showUndo({
    message,
    effect: 'Undo brings the topics back with their questions.',
    undo: async () => {
      // Last merge first: each topic comes back, then takes its questions back.
      for (const { topic, promptIds } of [...undo].reverse()) {
        const status = topic.status === 'paused' ? 'paused' : 'tracked'
        await source['topics:update']({ projectId, topicId: topic.id, status })
        if (promptIds.length === 0) continue
        await source['topics:moveQuestions']({
          projectId,
          items: promptIds.map((promptId) => ({ sourceId: into.id, promptId })),
          to: { kind: 'topic', topicId: topic.id }
        })
      }
      notifyTopicsChanged()
    },
    undoneMessage:
      merged.length === 1 ? `${merged[0]?.name ?? 'The topic'} is back.` : 'The topics are back.',
    testId: 'topic-undo'
  })
  return message
}
