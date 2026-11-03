import type { RowFillList } from '@shared/ipc'

/**
 * The lists CiteFox AI fills in after a person adds a row by name only: what each
 * list's second part is, and the words of its prompt. One short, single-purpose
 * prompt per list. The style matches the AI-found rows on that screen
 * (`onboarding/sections/business.ts`, `buyers.ts`).
 */

export interface RowFillDef {
  list: RowFillList
  /** "product", for messages. */
  noun: string
  /** The routing tag after `Assist: ` (letters only, as the e2e stand-in reads it). */
  assistId: string
  /** True: the best-matching page of the site is asked for too. */
  withPage: boolean
  /** What a name stands for, in the "<noun> to describe" line. */
  subject: string
  /** The list's own rules for the line it writes. */
  lineRules(domain: string): readonly string[]
  /** A plain example of a good line. */
  example: string
}

/** Most words kept in the line. */
export const FILL_MAX_WORDS = 14
/** Most characters kept in the line (a safety cap for very long words). */
export const FILL_MAX_CHARS = 120

export const ROW_FILL_DEFS: Readonly<Record<RowFillList, RowFillDef>> = {
  products: {
    list: 'products',
    noun: 'product',
    assistId: 'setup.rowFillProducts',
    withPage: true,
    subject: 'Product or service to describe',
    lineRules: (domain) => [
      `line = what it does and for whom, at most ${FILL_MAX_WORDS} words, in plain words a buyer would use. Start with a verb.`,
      `Do not repeat the product name or the brand name, and never use marketing words such as leading, powerful, seamless, all-in-one or platform. It is something ${domain} sells, so describe the offering, not the company.`
    ],
    example: 'Sends one text to a whole contact list, for small teams'
  },
  buyers: {
    list: 'buyers',
    noun: 'buyer',
    assistId: 'setup.rowFillBuyers',
    withPage: false,
    subject: 'Buyer to describe (who they are)',
    lineRules: () => [
      `line = their situation: what happened to them or what they need, at most ${FILL_MAX_WORDS} words, in plain words.`,
      'Do not repeat the buyer name, and never use marketing words.'
    ],
    example: 'Their carrier shut down email-to-text and alerts stopped'
  }
}

export function rowFillDef(list: RowFillList): RowFillDef {
  return ROW_FILL_DEFS[list]
}
