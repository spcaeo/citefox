import type {
  CheckFinishedNotice,
  CheckProgress,
  SetupProgress,
  SiteStartPlan,
  StartJourney,
  StartProgress,
  TopicProgress,
  TopicResults
} from '@shared/ipc'
import type { StartClient } from './client'

/** A StartClient for tests: canned answers and pushable events. Test-only. */
export interface FakeStartClient extends StartClient {
  push: {
    changed(progress: StartProgress): void
    check(progress: CheckProgress): void
    finished(notice: CheckFinishedNotice): void
    setup(progress: SetupProgress): void
    topic(progress: TopicProgress): void
  }
  statusCalls: number
}

export function fakeStartClient(
  options: {
    plan?: SiteStartPlan | null
    results?: TopicResults
    journey?: StartJourney
    /** Replace any call (homework, begin, progress…). */
    overrides?: Partial<StartClient>
  } = {}
): FakeStartClient {
  const sets = {
    changed: new Set<(value: StartProgress) => void>(),
    check: new Set<(value: CheckProgress) => void>(),
    finished: new Set<(value: CheckFinishedNotice) => void>(),
    setup: new Set<(value: SetupProgress) => void>(),
    topic: new Set<(value: TopicProgress) => void>()
  }
  const on =
    <T>(set: Set<(value: T) => void>) =>
    (listener: (value: T) => void): (() => void) => {
      set.add(listener)
      return () => {
        set.delete(listener)
      }
    }
  const fire = <T>(set: Set<(value: T) => void>, value: T): void => {
    for (const listener of set) listener(value)
  }
  const client: FakeStartClient = {
    statusCalls: 0,
    homework: () => Promise.reject(new Error('not in this test')),
    get: () => Promise.resolve(options.plan ?? null),
    progress: () => Promise.resolve(null),
    stop: () => Promise.resolve(null),
    begin: () => Promise.reject(new Error('not in this test')),
    status: () => {
      client.statusCalls += 1
      return options.journey
        ? Promise.resolve(options.journey)
        : Promise.reject(new Error('no journey'))
    },
    topicResults: () =>
      options.results ? Promise.resolve(options.results) : Promise.reject(new Error('no results')),
    activeJobs: () => Promise.resolve([]),
    cancelJob: () => Promise.reject(new Error('not in this test')),
    edit: () => Promise.reject(new Error('not in this test')),
    undo: () => Promise.reject(new Error('not in this test')),
    edits: () => Promise.resolve({ edits: [] }),
    suggestUrls: () => Promise.resolve({ suggestions: [], total: 0 }),
    onChanged: on(sets.changed),
    onCheckProgress: on(sets.check),
    onCheckFinished: on(sets.finished),
    onSetupProgress: on(sets.setup),
    onTopicProgress: on(sets.topic),
    push: {
      changed: (value) => fire(sets.changed, value),
      check: (value) => fire(sets.check, value),
      finished: (value) => fire(sets.finished, value),
      setup: (value) => fire(sets.setup, value),
      topic: (value) => fire(sets.topic, value)
    },
    ...options.overrides
  }
  return client
}

export function journey(partial: Partial<StartJourney> = {}): StartJourney {
  return {
    projectId: 'proj-1',
    empty: false,
    running: false,
    hasPlan: false,
    topicId: null,
    checkStarted: false,
    hasResults: false,
    resultsPageId: null,
    ...partial
  }
}
