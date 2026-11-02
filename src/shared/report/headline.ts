/**
 * The report's one-sentence headline (Docs/REPORT-SPEC.md "Headline"): the sentence a
 * founder would repeat. Built by a fixed template from counts the report already holds,
 * so it never says a number that is not in the data. The HTML report, the PDF and the
 * scheduled email open with it; Claude may polish it, but the number check still applies.
 */

export interface HeadlineInput {
  /** Questions in scope, failed searches included. */
  tracked: number
  /** Questions whose search did not fail. */
  measured: number
  aio: number
  cited: number
  /** "buyer prompts", or "buyer prompt checks" across several markets. */
  noun: string
  /** The most cited other site and the questions citing it. Null when none is cited. */
  topSite: { name: string; count: number } | null
  /**
   * Citation changes of the questions measured in both checks, and how the earlier check
   * reads ("the 5 Oct 2026 check"). Null without an earlier full check.
   */
  change: { gained: number; lost: number; label: string } | null
}

export function oneLineHeadline(input: HeadlineInput): string {
  const { noun } = input
  if (input.measured === 0) return `None of your ${noun} have been measured yet.`
  if (input.aio === 0) {
    return `Google shows no AI Overview for any of your ${input.measured} ${noun} yet.`
  }
  const site = input.topSite !== null && input.topSite.count > 0 ? input.topSite : null
  if (input.cited === 0) {
    const rival = site === null ? '' : `; ${site.name} is cited in ${site.count}`
    return `Google shows an AI Overview for ${input.aio} of your ${input.tracked} ${noun} and cites you in none of them${changeTail(input.change)}${rival}.`
  }
  return `Google's AI Overviews cite you in ${input.cited} of ${input.aio} answers to your ${noun}${changeTail(input.change)}${siteTail(site, input.cited)}.`
}

function changeTail(change: HeadlineInput['change']): string {
  if (change === null) return ''
  const net = change.gained - change.lost
  if (net > 0) return `, up ${net} since ${change.label}`
  if (net < 0) return `, down ${-net} since ${change.label}`
  if (change.gained === 0) return `, unchanged since ${change.label}`
  return `, with ${change.gained} gained and ${change.lost} lost since ${change.label}`
}

function siteTail(site: HeadlineInput['topSite'], cited: number): string {
  if (site === null) return ''
  if (site.count > cited) return `; ${site.name} is cited in ${site.count}`
  if (site.count === cited) return `, level with ${site.name}`
  return ', more than any other site'
}
