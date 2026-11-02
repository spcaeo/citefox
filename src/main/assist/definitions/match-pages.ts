import { pathOf } from '../../helpfill/context'
import { nameOfPage } from '../../import/context'
import { DATA_FENCE_RULE, fence } from '../../prompts/blocks'
import { listPages } from '../../storage/pages'
import { AssistInputError, type AssistContext, type AssistDefinition } from '../types'
import { clip, pageOf } from './gather'

/**
 * Add questions → ✦ Match pages (HelpFill.dc.html panel 7, "Page to be cited"): picks
 * the tracked page that should be cited for each question a topic is getting, from
 * the questions and the tracked pages' addresses and names only (no page text, no
 * search). The reply names a tracked path or "none"; it never invents a page.
 */

export const MATCH_PAGES_ASSIST_ID = 'questions.matchPages'

/** The most questions one call matches (the shared reply schema holds 40 items). */
export const MATCH_PAGES_MAX = 40

/** Tracked pages listed; a project with more lists the first ones. */
const MAX_PAGES = 80

/** The questions sent in `inputs.questions`, trimmed, blank ones left out. */
export function matchQuestions(context: AssistContext): string[] {
  const value = context.request.inputs.questions
  const list = Array.isArray(value) ? value : []
  return list
    .map((item) => (typeof item === 'string' ? clip(item.replace(/\s+/gu, ' '), 400) : ''))
    .filter((item) => item.length > 0)
    .slice(0, MATCH_PAGES_MAX)
}

/** `/pricing/ · Pricing` for each tracked page (not topics), once per path. */
export function trackedPageLines(context: AssistContext): { path: string; line: string }[] {
  const opened = pageOf(context)
  const seen = new Set<string>()
  const lines: { path: string; line: string }[] = []
  for (const page of listPages(opened.db, opened.project.id)) {
    if (page.kind === 'topic' || page.url === null || page.status === 'removed') continue
    const path = pathOf(page.url)
    if (path.length === 0 || seen.has(path)) continue
    seen.add(path)
    const name = nameOfPage(page)
    lines.push({ path, line: name === page.url ? path : `${path} · ${clip(name, 120)}` })
    if (lines.length >= MAX_PAGES) break
  }
  return lines
}

export const MATCH_PAGES_ASSISTS: readonly AssistDefinition[] = [
  {
    id: MATCH_PAGES_ASSIST_ID,
    title: 'Match pages',
    expectedSeconds: 10,
    acceptsInstruction: true,
    needsProject: true,
    needs: ['pageId'],
    minItems: 1,
    maxItems: MATCH_PAGES_MAX,
    task: `For each question under "Questions", pick the one tracked page under "Tracked pages" a buyer asking it should land on: the page whose subject answers the question most directly.
Answer one item per question, in the same order. text is the question exactly as written. detail is the page's path exactly as listed (such as /pricing/), or "none" when no tracked page answers it. Never write a path that is not listed. tag is null.`,
    gather(context) {
      const opened = pageOf(context)
      const questions = matchQuestions(context)
      if (questions.length === 0) {
        throw new AssistInputError('Type some questions first.', 'Add rows, then try again.')
      }
      const pages = trackedPageLines(context)
      if (pages.length === 0) {
        throw new AssistInputError('No pages are tracked yet.', 'Add a page, then try again.')
      }
      return [
        `${opened.page.kind === 'topic' ? 'Topic' : 'Page'}: ${nameOfPage(opened.page)}`,
        '',
        'Tracked pages:',
        ...pages.map((page) => `- ${page.line}`),
        '',
        'Questions:',
        DATA_FENCE_RULE,
        fence('pasted', questions.map((question, index) => `${index + 1}. ${question}`).join('\n'))
      ].join('\n')
    },
    check(reply, context) {
      const paths = new Set(trackedPageLines(context).map((page) => page.path))
      for (const item of reply.items) {
        const detail = (item.detail ?? 'none').trim()
        if (detail.toLowerCase() !== 'none' && !paths.has(detail)) {
          return `"${clip(detail, 60)}" is not a tracked page. Use a listed path or "none".`
        }
      }
      return null
    }
  }
]
