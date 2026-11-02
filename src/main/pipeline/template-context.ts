import type { BuyerProfileBody, OutlineEntry, PageFaq } from '@shared/domain'

/**
 * Readable template values built from a page snapshot and a buyer profile.
 * Templates receive these as `{{ outline }}`, `{{ faqs }}`, and `{{ last_modified }}`.
 * The buyer profile is appended by the engine after the rendered template. The
 * context blocks (`{{ market_block }}` and the rest) are built in `page-context.ts`.
 */

/**
 * Most page text a template receives. A long page is cut at a paragraph break so
 * the prompt, the claude argv or stdin, and the cost stay bounded. 60,000
 * characters is about 15,000 tokens, longer than nearly every article.
 */
export const PAGE_TEXT_TEMPLATE_MAX = 60_000

export const PAGE_TEXT_CUT_NOTE = '\n\n[Page text cut here to fit. The live page continues.]'

/**
 * Page text for any Claude call (generation templates, quick actions, assists): one
 * bound, cut at a paragraph boundary. Quick actions used to see only 8,000 characters.
 */
export function capPageText(text: string, max = PAGE_TEXT_TEMPLATE_MAX): string {
  if (text.length <= max) return text
  const head = text.slice(0, max)
  const paragraph = head.lastIndexOf('\n\n')
  const line = head.lastIndexOf('\n')
  const space = head.lastIndexOf(' ')
  const floor = Math.floor(max / 2)
  const cut = paragraph >= floor ? paragraph : line >= floor ? line : space >= floor ? space : max
  return `${head.slice(0, cut).trimEnd()}${PAGE_TEXT_CUT_NOTE}`
}

/**
 * Page text placed inside `<page_text>…</page_text>` in a template. A closing tag
 * inside the text is broken up, so a page cannot end the fence early and write
 * instructions after it (Docs/PROMPT-AUDIT.md section 3, rule 3).
 */
export function unfencePageText(text: string): string {
  return text.replace(/<\/(\s*page_text)/giu, '< /$1')
}

export function formatOutline(outline: readonly OutlineEntry[]): string {
  if (outline.length === 0) return 'No H2 or H3 headings on the page.'
  return outline
    .map((entry) => {
      const indent = entry.level === 'h3' ? '  ' : ''
      const table = entry.table ? ' (has a table)' : ''
      return `${indent}${entry.level.toUpperCase()}: ${entry.text}${table}`
    })
    .join('\n')
}

export function formatFaqs(faqs: readonly PageFaq[]): string {
  if (faqs.length === 0) return 'No FAQs on the page.'
  return faqs
    .map((faq, index) => {
      const answer = faq.answer.trim().length > 0 ? faq.answer : '(no answer on the page)'
      const typo = faq.typo === null ? '' : `\nTypo: ${faq.typo}`
      return `FAQ ${index + 1}. Q: ${faq.question}\nA: ${answer}${typo}`
    })
    .join('\n\n')
}

export function formatLastModified(modifiedAt: string | null, publishedAt: string | null): string {
  if (modifiedAt !== null && modifiedAt.trim().length > 0) return modifiedAt
  if (publishedAt !== null && publishedAt.trim().length > 0) {
    return `Not stated on the page. Published ${publishedAt}.`
  }
  return 'Not stated on the page.'
}

export function formatBuyerProfile(profile: BuyerProfileBody): string {
  return [
    `Who: ${profile.who}`,
    `Environment: ${profile.environment}`,
    `Strongest segments:\n${profile.segments.map((item) => `- ${item.name}: ${item.reason}`).join('\n')}`,
    `Trigger events:\n${profile.triggers.map((item) => `- ${item}`).join('\n')}`,
    `What they value:\n${profile.values.map((item) => `- ${item}`).join('\n')}`,
    `Poor fit:\n${profile.poorFit.map((item) => `- ${item.name}: ${item.reason}`).join('\n')}`
  ].join('\n')
}
