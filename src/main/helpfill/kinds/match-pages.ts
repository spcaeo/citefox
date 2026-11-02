import { ensureShippedAssists } from '../../assist/definitions'
import { MATCH_PAGES_ASSIST_ID, MATCH_PAGES_MAX } from '../../assist/definitions/match-pages'
import { runAssist } from '../../assist/run'
import { pathOf } from '../context'
import type { HelpFillContext, HelpFillKindDef, HelpFillValues } from '../types'

/**
 * Add questions → ✦ Match pages: the tracked page to be cited for each row a topic
 * is getting. The request sends the rows' questions (`items`); the prompt lists them
 * with the tracked pages (path and name), and the reply is `question,page`. A page
 * that is not tracked is never set: the row keeps no page and carries `untracked`
 * (the path the answer named), so the grid can flag it. Describe runs the
 * `questions.matchPages` assist.
 */

/** Tracked pages listed in the prompt. */
const PROMPT_PAGES = 80

/** "none", "n/a", "-": no tracked page answers the question. */
const NO_PAGE = /^(?:none|n\/?a|no page|not tracked|blank|-+|—)$/iu

export const MATCH_PAGES_KIND: HelpFillKindDef = {
  kind: 'matchPages',
  noun: ['question', 'questions'],
  scope: 'page',
  sections: [{ id: 'main', title: null, columns: ['question', 'page'], entity: 'questions' }],
  // The user's own rows: none is set aside for naming the brand.
  neutral: false,
  defaultCount: MATCH_PAGES_MAX,
  maxCount: MATCH_PAGES_MAX,
  chatbotCount: MATCH_PAGES_MAX,
  describeCost: { calls: 1, usd: 0.01 },
  trackedLine: false,
  role: () => 'You help a company pick the page Google should cite for each buyer question.',
  task(context) {
    const pages = (context.pages ?? []).slice(0, PROMPT_PAGES)
    const questions = context.items ?? []
    return [
      'For each question below, pick the one tracked page a buyer asking it should land on: the page whose subject answers it most directly.',
      'Use a path exactly as listed. Leave page blank when no tracked page answers it; never write a page that is not listed.',
      'Keep every question exactly as written, one row each, in the same order.',
      '',
      'Tracked pages:',
      ...(pages.length > 0
        ? pages.map((page) =>
            page.name === page.url ? `- ${page.path}` : `- ${page.path} · ${page.name}`
          )
        : ['- none yet']),
      '',
      'Questions:',
      ...questions.map(
        (question, index) => `${index + 1}. ${question.replace(/\s+/gu, ' ').trim()}`
      )
    ]
  },
  tracked: () => ({ listed: [], merge: {} }),
  clean: cleanMatch,
  async describe(host, context, input) {
    ensureShippedAssists()
    const questions = (context.items ?? []).slice(0, MATCH_PAGES_MAX)
    if (context.target === null || questions.length === 0) return []
    const result = await runAssist(host, {
      assistId: MATCH_PAGES_ASSIST_ID,
      projectId: context.projectId,
      pageId: context.target.id,
      marketId: null,
      promptId: null,
      inputs: { questions },
      instruction: input.sentence.trim() || null
    })
    return result.items.map((item) => ({
      section: null,
      values: { question: item.text, page: item.detail ?? '' }
    }))
  }
}

/**
 * The question as written and the page as a tracked path. A blank or "none" page
 * stays blank; a page that is not tracked stays blank too, with `untracked` naming
 * what the answer said.
 */
export function cleanMatch(
  values: HelpFillValues,
  context: HelpFillContext
): HelpFillValues | null {
  const question = (values.question ?? '')
    .replace(/^\s*(?:\d+[.)]|[-*•])\s+/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
  if (question.length === 0) return null
  const written = (values.page ?? '').replace(/^[`'"<]+|[`'">]+$/gu, '').trim()
  if (written.length === 0 || NO_PAGE.test(written)) return { question, page: '' }
  const asked = pathOf(addressOf(written))
  const tracked = (context.pages ?? []).find((page) => samePath(page.path, asked))
  if (tracked !== undefined) return { question, page: tracked.url }
  return { question, page: '', untracked: written.slice(0, 200) }
}

/** `pricing/` and `example.com/pricing/` as something `pathOf` reads. */
function addressOf(written: string): string {
  if (written.startsWith('/') || /^https?:\/\//iu.test(written)) return written
  const host = written.split('/')[0] ?? ''
  return host.includes('.') ? `https://${written}` : `/${written}`
}

/** `/pricing` and `/pricing/` are the same page. */
function samePath(left: string, right: string): boolean {
  const bare = (path: string): string => path.replace(/\/+$/u, '').toLowerCase() || '/'
  return right.length > 0 && bare(left) === bare(right)
}
