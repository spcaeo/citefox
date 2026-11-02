/** The top bar search's question lookup. */

import type { IpcHandlersFor, searchChannels } from '@shared/ipc'
import { withProject } from '../engine/project-db'
import { parseSearchQuestions, searchQuestions } from '../search/questions'
import { guard, type EngineContext } from './context'

export function searchHandlers(ctx: EngineContext): IpcHandlersFor<typeof searchChannels> {
  return {
    'search:questions': (request) =>
      guard('search:questions', ctx, () => {
        const parsed = parseSearchQuestions(request)
        return withProject(ctx, parsed.projectId, 'search:questions', (opened) =>
          searchQuestions(opened.db, parsed.query)
        )
      })
  }
}
