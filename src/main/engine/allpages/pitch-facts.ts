import { getLatestSnapshot } from '../../storage/content-records'
import { getPage } from '../../storage/pages'
import { readProjectProfile } from '../../storage/project-profile'
import { loadCitedPages } from './cited-pages'
import type { AllPagesPass } from './pass'

/**
 * The facts of one outreach pitch (Citations → "✦ Draft a pitch"): a page on someone
 * else's site that Google's AI Overview cites for one of the user's questions, the
 * competitors cited next to it there, whether the user is cited, and the user's
 * matching page. Read from the same latest checks as `allpages:citedPages`, so the
 * pitch names what the list shows. The chatbot prompt and the `citations.pitch`
 * assist both carry these lines; nothing here is sent anywhere.
 */

/** Characters kept from what the user's page says about itself. */
const OFFER_CHARS = 400

export class PitchFactsMissing extends Error {
  readonly nextStep: string

  constructor(message: string, nextStep: string) {
    super(message)
    this.name = 'PitchFactsMissing'
    this.nextStep = nextStep
  }
}

export interface PitchFacts {
  site: string
  /** The cited page on that site. */
  url: string
  title: string | null
  question: string
  /** "Twilio (twilio.com)", in the order the list counts them. */
  competitors: string[]
  /** True when an own page is cited in the same overview. */
  youCited: boolean
  ownPage: { url: string | null; title: string | null; offer: string | null }
  lines: string[]
}

export function readPitchFacts(
  pass: AllPagesPass,
  input: { citedId: string; pageId: string; promptId: string }
): PitchFacts {
  const data = loadCitedPages(pass)
  const row = data.rows.find((item) => item.id === input.citedId && item.whose === 'other')
  const key = `${input.pageId}|${input.promptId}`
  const question = row?.questions.find((item) => item.id === key)
  if (row === undefined || question === undefined) {
    throw new PitchFactsMissing(
      'That cited page is not in the latest checks any more.',
      'Open Citations again and pick the page.'
    )
  }
  const overviews = new Set(
    row.overviews.filter((item) => item.questionId === key).map((item) => item.id)
  )
  const alongside = data.rows.filter((item) =>
    item.overviews.some((overview) => overviews.has(overview.id))
  )
  const competitors = [
    ...new Set(
      alongside
        .filter((item) => item.whose === 'competitor')
        .map((item) =>
          item.competitor !== null && item.competitor !== item.domain
            ? `${item.competitor} (${item.domain})`
            : item.domain
        )
    )
  ]
  const youCited = alongside.some((item) => item.whose === 'yours')
  const page = getPage(pass.db, input.pageId, pass.project.id)
  const snapshot = page === null ? null : getLatestSnapshot(pass.db, page.id)
  const offer = snapshot?.metaDescription?.trim() || snapshot?.h1?.trim() || null
  const ownPage = {
    url: page?.kind === 'topic' ? null : (page?.url ?? null),
    title: snapshot?.title ?? page?.title ?? null,
    offer: offer === null ? null : clip(offer, OFFER_CHARS)
  }
  const brand = readProjectProfile(pass.db)?.brandNames[0]
  const lines = [
    brand === undefined
      ? `Company: ${pass.project.domain}.`
      : `Company: ${brand} (${pass.project.domain}).`,
    `The site: ${row.domain}`,
    `Its page that Google's AI Overview cites: ${row.title ? `"${row.title}" ` : ''}(${row.url})`,
    `The question buyers type into Google: "${question.promptText}"`,
    competitors.length > 0
      ? `Google cites these competitors next to that page for it: ${competitors.join(', ')}.`
      : '',
    youCited ? 'Google cites us for it too.' : "Google doesn't cite us for it.",
    ownPage.url === null
      ? ''
      : `Our matching page: ${ownPage.title ? `"${ownPage.title}" ` : ''}(${ownPage.url})`,
    ownPage.offer === null ? '' : `What our page says it offers: ${ownPage.offer}`
  ].filter((line) => line.length > 0)
  return {
    site: row.domain,
    url: row.url,
    title: row.title,
    question: question.promptText,
    competitors,
    youCited,
    ownPage,
    lines
  }
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/gu, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`
}
