import { list, nullableText, obj, text } from './shared'

/** Topic insight schemas (Docs/PROMPT-AUDIT.md, package P5). */

/** Narrowed: the facts only. The next actions are their own step (`topic_next_actions`). */
export const TOPIC_SUMMARY_SCHEMA = obj({
  line: text(600),
  executive: text(2000)
})

export const TOPIC_NEXT_ACTIONS_SCHEMA = obj({
  nextActions: list(
    obj({
      text: text(300),
      promptNumbers: list({ type: 'integer', minimum: 1 }, 10, 1),
      verify: nullableText(300)
    }),
    3,
    3
  )
})

/**
 * Sources cited instead are named by their number in the stored list; code fills
 * the domain and URL, so a reply can never name a source the overview does not show.
 */
export const TOPIC_CITATION_DIAGNOSIS_SCHEMA = obj({
  summary: text(600),
  reasons: list(obj({ text: text(400), evidence: nullableText(400) }), 4, 1),
  citedInstead: list(obj({ source: { type: 'integer', minimum: 1 }, whyItWins: text(300) }), 5),
  facts: list(text(300), 4, 1)
})

export const TOPIC_FIX_DRAFT_SCHEMA = obj({
  where: { enum: ['target', 'new'] },
  steps: list(text(300), 6, 3),
  draft: text(1500)
})

/**
 * Page edits: each change names a block by its id (the block to cut or rewrite,
 * or the block a new one goes after; null puts it at the top). Code checks every
 * id against the page, so a change can never land on a block that is not there.
 */
export const TOPIC_PAGE_EDIT_SCHEMA = obj({
  summary: text(300),
  changes: list(
    obj({
      op: { enum: ['delete', 'replace', 'insert'] },
      block: nullableText(20),
      kind: { enum: ['h1', 'h2', 'h3', 'h4', 'p', 'li', 'quote', 'code', 'table'] },
      text: nullableText(2000),
      why: text(300)
    }),
    14,
    1
  )
})

/**
 * Why Google picks another page of the site: a verdict, what the answer needs,
 * what the cited page has, and content changes to the recommended owner page.
 */
export const TOPIC_OWNER_WHY_SCHEMA = obj({
  verdict: { enum: ['target', 'cited', 'either'] },
  reason: text(400),
  answerNeeds: list(text(240), 6, 3),
  citedHas: list(obj({ section: text(200), point: text(300) }), 6, 1),
  toChange: list(obj({ section: text(200), change: text(700), why: text(300) }), 8, 1),
  risk: nullableText(400)
})

/** Retired kinds (Docs/PROMPT-AUDIT.md section 3, rule 6): kept for old project versions. */
export const TOPIC_WHY_NOT_CITED_SCHEMA = obj({
  summary: text(600),
  reasons: list(obj({ text: text(400), evidence: nullableText(400) }), 6, 1),
  citedInstead: list(obj({ domain: text(200), url: text(2000), whyItWins: text(300) }), 10),
  fix: obj({
    where: { enum: ['target', 'new'] },
    steps: list(text(300), 8, 1),
    draft: text(2000)
  })
})

export const TOPIC_EXPLAIN_CITATION_SCHEMA = obj({
  text: text(1200),
  facts: list(text(300), 6, 1)
})
