import type { AssistantAction } from '@shared/ipc'
import { openDrawer } from '../shell/drawers'
import { pageHash, runningHash, topicHash } from '../shell/routes'
import { notifyTopicsChanged } from '../topics/clusters/events'
import type { AssistantClient } from './client'

/**
 * Runs an action card the user confirmed, through the channel the screen
 * itself uses. Nothing here runs before the click on Confirm: the card calls
 * this only from its confirm button.
 */

export interface ActionOutcome {
  /** One line: what changed. */
  text: string
  /** Text to copy (a drafted fix). */
  draft: string | null
  /** Where to see the result. */
  href: string | null
  hrefLabel: string | null
}

const NONE = { draft: null, href: null, hrefLabel: null } as const

/** "Add 3 questions" style cost line under the confirm button. */
export function actionCost(action: AssistantAction): string {
  switch (action.kind) {
    case 'start-check': {
      const searches = action.searches ?? 0
      return `Uses ${searches} ${searches === 1 ? 'search' : 'searches'} of your search key.`
    }
    case 'draft-fix':
      return 'CiteFox AI drafts it from your saved data · no searches.'
    case 'open-drill':
    case 'create-topic':
      return 'Opens a drawer · nothing changes yet.'
    default:
      return 'No searches · you can undo it from the screen.'
  }
}

/** The confirm button's words. */
export function actionVerb(action: AssistantAction): string {
  switch (action.kind) {
    case 'add-questions':
      return action.questions.length === 1
        ? 'Add question'
        : `Add ${action.questions.length} questions`
    case 'create-topic':
      return 'Open New topic'
    case 'draft-fix':
      return 'Draft it'
    case 'set-target':
      return 'Set target page'
    case 'open-drill':
      return 'Show the rows'
    case 'start-check':
      return 'Check now'
  }
}

export async function runAssistantAction(
  client: AssistantClient,
  projectId: string,
  action: AssistantAction
): Promise<ActionOutcome> {
  switch (action.kind) {
    case 'add-questions': {
      const target = action.topicId ?? action.pageId
      if (!target || action.questions.length === 0) throw new Error('Nothing to add.')
      const result = await client.addQuestions({
        projectId,
        pageId: target,
        questions: action.questions.map((text) => ({ text }))
      })
      const added = result.promptIds.length
      const skipped = result.skipped.length
      // The Questions, Topics and Prompts screens behind the drawer reload now.
      if (added > 0) notifyTopicsChanged()
      return {
        text: `Added ${added} ${added === 1 ? 'question' : 'questions'}${skipped > 0 ? ` · ${skipped} already tracked` : ''}. Not checked yet.`,
        draft: null,
        href: action.topicId ? topicHash(action.topicId) : pageHash(target, 'prompts'),
        hrefLabel: 'See the questions'
      }
    }
    case 'create-topic':
      openDrawer('new-topic', { questions: action.promptIds.join(',') || null })
      return { text: 'Opened New topic with these questions.', ...NONE }
    case 'draft-fix': {
      const promptId = action.promptIds[0]
      if (!promptId) throw new Error('Pick a question to draft for.')
      const marketId = action.marketIds[0] ?? null
      if (action.topicId) {
        const result = await client.draftTopicFix({
          projectId,
          topicId: action.topicId,
          promptId,
          marketId
        })
        return {
          text: 'Drafted. Review it, then paste it into the page.',
          draft: result.draft || result.text,
          href: null,
          hrefLabel: null
        }
      }
      if (!action.pageId) throw new Error('Pick a page to draft for.')
      const result = await client.runAssist({
        assistId: 'gaps.draftFix',
        projectId,
        pageId: action.pageId,
        marketId,
        promptId,
        inputs: {},
        instruction: null
      })
      return {
        text: 'Drafted. Review it, then paste it into the page.',
        draft: result.items.map((item) => item.text).join('\n\n'),
        href: null,
        hrefLabel: null
      }
    }
    case 'set-target': {
      if (!action.topicId || action.promptIds.length === 0)
        throw new Error('Pick the questions first.')
      await client.setTarget({
        projectId,
        topicId: action.topicId,
        promptIds: action.promptIds,
        target: { pageId: action.targetPageId, url: null }
      })
      const count = action.promptIds.length
      return {
        text: `Target page set for ${count} ${count === 1 ? 'question' : 'questions'}.`,
        draft: null,
        href: topicHash(action.topicId),
        hrefLabel: 'Open the topic'
      }
    }
    case 'open-drill':
      if (!action.drill) throw new Error('Nothing to show.')
      openDrawer('drill', { drill: action.drill })
      return { text: 'Opened the rows behind this number.', ...NONE }
    case 'start-check': {
      const pageId = action.pageId ?? action.topicId
      if (!pageId) throw new Error('Pick a page to check.')
      await client.startCheck({
        projectId,
        pageIds: [pageId],
        marketIds: action.marketIds.length > 0 ? action.marketIds : null,
        promptIds: action.promptIds.length > 0 ? action.promptIds : null
      })
      return {
        text: 'Check started.',
        draft: null,
        href: runningHash(pageId),
        hrefLabel: 'Watch the check'
      }
    }
  }
}
