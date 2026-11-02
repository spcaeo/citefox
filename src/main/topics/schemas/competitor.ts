import { list, nullableText, obj, stage, text } from './shared'

/** Competitor page schemas (Docs/PROMPT-AUDIT.md, package P4). The first is retired. */

export const COMPETITOR_PAGE_QUESTIONS_SCHEMA = obj({
  questions: list(obj({ stage, text: text(500), section: nullableText(200) }), 60, 1),
  claims: list(
    obj({
      claim: text(300),
      onYourSite: { enum: ['no', 'partly', 'yes'] },
      section: nullableText(200)
    }),
    12
  )
})

/** Questions only; `section` is one of their headings (code snaps it to the exact text). */
export const COMPETITOR_PAGE_QUESTIONS_V2_SCHEMA = obj({
  questions: list(obj({ stage, text: text(500), section: text(200) }), 40, 1)
})

/** Claims only; `yourEvidence` is the path of one of the business's pages, or null. */
export const COMPETITOR_PAGE_CLAIMS_SCHEMA = obj({
  claims: list(
    obj({
      claim: text(300),
      section: nullableText(200),
      onYourSite: { enum: ['no', 'partly', 'yes'] },
      yourEvidence: nullableText(300)
    }),
    12
  )
})
