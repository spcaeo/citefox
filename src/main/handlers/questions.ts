/** The project-wide Questions screen. */

import type { IpcHandlersFor, questionsChannels } from '@shared/ipc'
import { withProject } from '../engine/project-db'
import { loadQuestions } from '../questions/list'
import { editQuestion, getQuestion, restoreQuestions } from '../questions/edit'
import {
  parseQuestionEdit,
  parseQuestionGet,
  parseQuestionsList,
  parseQuestionsRestore,
  parseQuestionsUpdate
} from '../questions/parse'
import { updateQuestions } from '../questions/update'
import { guard, type EngineContext } from './context'

export function questionsHandlers(ctx: EngineContext): IpcHandlersFor<typeof questionsChannels> {
  return {
    'questions:list': (request) =>
      guard('questions:list', ctx, () => {
        const parsed = parseQuestionsList(request)
        return withProject(ctx, parsed.projectId, 'questions:list', (opened) =>
          loadQuestions(opened.db, opened.project, parsed.marketId ?? null)
        )
      }),
    'questions:update': (request) =>
      guard('questions:update', ctx, () => updateQuestions(ctx, parseQuestionsUpdate(request))),
    'questions:get': (request) =>
      guard('questions:get', ctx, () => getQuestion(ctx, parseQuestionGet(request))),
    'questions:edit': (request) =>
      guard('questions:edit', ctx, () => editQuestion(ctx, parseQuestionEdit(request))),
    'questions:restore': (request) =>
      guard('questions:restore', ctx, () => restoreQuestions(ctx, parseQuestionsRestore(request)))
  }
}
