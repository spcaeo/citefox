import type { IpcInvokeMap, topicClustersChannels } from '@shared/ipc'
import type { CheckEngine } from '../../engine/checks/engine'
import type { EngineHost } from '../../engine/host'
import { withProject } from '../../engine/project-db'
import { emitMainEvent } from '../../ipc-events'
import { IpcRequestError } from '../../ipc-request'
import { TopicInputError } from '../drafts'
import type { OpenedProject, TopicEnv } from '../env'
import { TopicNotFoundError } from '../results'
import { sortQuestions, suggestTopicName, suggestTopics } from './ai'
import { createEmptyTopic, duplicateTopic } from './copy'
import { createFromDraft, createTopics } from './create'
import {
  createTopicFolder,
  deleteFolder,
  moveToFolder,
  parseCreateFolder,
  parseDeleteFolder,
  parseFoldersRequest,
  parseMoveToFolder,
  parseRenameFolder,
  readTopicFolders,
  renameFolder
} from './folders'
import { mergeTopic, moveQuestions, setQuestionStage, splitTopic } from './move'
import {
  parseCreateEmpty,
  parseCreateFromDraft,
  parseDuplicate,
  parseCreateTopics,
  parseMerge,
  parseMove,
  parseSetStage,
  parseSortQuestions,
  parseSplit,
  parseSuggestName,
  parseSuggestTopics
} from './parse'

export type TopicClusterChannel = keyof typeof topicClustersChannels

/** One function per topics-and-clusters invoke. Each parses its own request. */
export type TopicClustersService = {
  [C in TopicClusterChannel]: (request: unknown) => Promise<IpcInvokeMap[C]['result']>
}

/**
 * Builds the topics-and-clusters service (Docs/TOPICS-SPEC.md §8). Topic input
 * errors become plain-words IPC errors, as in the `topics:*` service.
 */
export function createTopicClustersService(
  host: EngineHost,
  checks: CheckEngine | null,
  emitProgress: TopicEnv['emitProgress'] = (event) => {
    emitMainEvent('topics:progress', event)
  }
): TopicClustersService {
  const env: TopicEnv = { host, checks, emitProgress }
  const open = <T>(
    channel: string,
    projectId: string,
    run: (opened: OpenedProject) => Promise<T> | T
  ): Promise<T> =>
    withProject(host, projectId, channel, async (opened) => {
      try {
        return await run({ project: opened.project, db: opened.db })
      } catch (error) {
        if (error instanceof TopicInputError)
          throw new IpcRequestError(channel, error.message, error.nextStep)
        if (error instanceof TopicNotFoundError) throw new IpcRequestError(channel, error.message)
        throw error
      }
    })

  return {
    'topics:moveQuestions': (request) => {
      const parsed = parseMove(request)
      return open('topics:moveQuestions', parsed.projectId, (opened) =>
        moveQuestions(env, opened, parsed)
      )
    },
    'topics:setQuestionStage': (request) => {
      const parsed = parseSetStage(request)
      return open('topics:setQuestionStage', parsed.projectId, (opened) =>
        setQuestionStage(env, opened, parsed)
      )
    },
    'topics:merge': (request) => {
      const parsed = parseMerge(request)
      return open('topics:merge', parsed.projectId, (opened) => mergeTopic(env, opened, parsed))
    },
    'topics:split': (request) => {
      const parsed = parseSplit(request)
      return open('topics:split', parsed.projectId, (opened) => splitTopic(env, opened, parsed))
    },
    'topics:createTopics': (request) => {
      const parsed = parseCreateTopics(request)
      return open('topics:createTopics', parsed.projectId, (opened) =>
        createTopics(env, opened, parsed)
      )
    },
    'topics:createFromDraft': (request) => {
      const parsed = parseCreateFromDraft(request)
      return open('topics:createFromDraft', parsed.projectId, (opened) =>
        createFromDraft(env, opened, parsed)
      )
    },
    'topics:suggestTopics': (request) => {
      const parsed = parseSuggestTopics(request)
      return open('topics:suggestTopics', parsed.projectId, (opened) =>
        suggestTopics(env, opened, parsed)
      )
    },
    'topics:sortQuestions': (request) => {
      const parsed = parseSortQuestions(request)
      return open('topics:sortQuestions', parsed.projectId, (opened) =>
        sortQuestions(env, opened, parsed)
      )
    },
    'topics:createEmpty': (request) => {
      const parsed = parseCreateEmpty(request)
      return open('topics:createEmpty', parsed.projectId, (opened) =>
        createEmptyTopic(env, opened, parsed)
      )
    },
    'topics:duplicate': (request) => {
      const parsed = parseDuplicate(request)
      return open('topics:duplicate', parsed.projectId, (opened) =>
        duplicateTopic(env, opened, parsed)
      )
    },
    'topics:suggestName': (request) => {
      const parsed = parseSuggestName(request)
      return open('topics:suggestName', parsed.projectId, (opened) =>
        suggestTopicName(env, opened, parsed)
      )
    },
    'topics:folders': (request) => {
      const { projectId } = parseFoldersRequest(request)
      return open('topics:folders', projectId, readTopicFolders)
    },
    'topics:createFolder': (request) => {
      const parsed = parseCreateFolder(request)
      return open('topics:createFolder', parsed.projectId, (opened) =>
        createTopicFolder(host, opened, parsed)
      )
    },
    'topics:renameFolder': (request) => {
      const parsed = parseRenameFolder(request)
      return open('topics:renameFolder', parsed.projectId, (opened) => renameFolder(opened, parsed))
    },
    'topics:deleteFolder': (request) => {
      const parsed = parseDeleteFolder(request)
      return open('topics:deleteFolder', parsed.projectId, (opened) => deleteFolder(opened, parsed))
    },
    'topics:moveToFolder': (request) => {
      const parsed = parseMoveToFolder(request)
      return open('topics:moveToFolder', parsed.projectId, (opened) => moveToFolder(opened, parsed))
    }
  }
}
