import { describe, expect, test } from 'vitest'
import { claimsCause, gapSchemaError, summarySchemaError } from './report-templates'

/**
 * FR-25.5 forbids one thing: saying that an edit, fix or change to the page caused a
 * citation or visibility change. Explaining why the overview chose a source is not that.
 *
 * The live check on 2026-10-21 failed its gap report with "The reply claims a cause."
 * The raw reply was not logged, so this fixture rebuilds it from that run: a gap list
 * whose facts and sources explain why the overview leans on another page.
 */
const LIVE_GAP_REPLY = {
  facts: [
    {
      fact: 'The overview says two-way SMS keeps reminder replies in one thread, because the reply lands back in the same inbox.',
      likelySource:
        'https://www.twilio.com/docs/messaging — the overview cites it because it answers how replies are routed.'
    },
    {
      fact: 'The overview lists carrier registration (10DLC) as required before sending, due to US carrier rules.',
      likelySource: 'https://www.textmagic.com/blog/10dlc-registration'
    },
    {
      fact: 'The overview gives a typical setup time of one business day.',
      likelySource:
        'https://simpletexting.com/pricing — likely chosen since it states setup times as a result of listing each plan step by step.'
    }
  ]
}

describe('the no-causation rule (FR-25.5)', () => {
  test('the live gap reply that explains why a source was chosen is accepted', () => {
    expect(gapSchemaError(LIVE_GAP_REPLY)).toBeNull()
  })

  test.each([
    'The overview cites X because X answers the pricing question directly.',
    'Google probably picked this page because it has a comparison table.',
    'The overview mentions G2 due to its review counts.',
    'This source is cited as a result of its clear step-by-step list.',
    'The check states the citation rate and the content fingerprint together.',
    'The overview names the 2026 carrier rule changes because the references cover them.'
  ])('explaining a source is not a cause claim: %s', (text) => {
    expect(claimsCause(text)).toBe(false)
  })

  test.each([
    'After you updated the FAQ, Google started citing you because of the change.',
    'The citation was caused by the edit.',
    'This video caused a citation.',
    'The page is now cited because you rewrote the opening section.',
    'Visibility went up after the page was updated.',
    'Your content edit led to the new citation.',
    'The fix to the title produced a citation in the overview.',
    'Thanks to the changes to your page, the overview now mentions the brand.',
    'Updating the FAQ resulted in more citations.'
  ])('an edit that caused a citation change is rejected: %s', (text) => {
    expect(claimsCause(text)).toBe(true)
  })

  test('a gap fact that credits an edit for a citation is still rejected', () => {
    expect(
      gapSchemaError({
        facts: [
          {
            fact: 'After you updated the FAQ, Google started citing you because of the change.',
            likelySource: null
          }
        ]
      })
    ).toBe('The reply claims a cause.')
  })

  test('a summary that credits an edit is rejected and one that explains a source is not', () => {
    expect(
      summarySchemaError({
        headline: 'The page was cited in 4 of 9 overviews.',
        body: 'The overview cites competitors because they answer the setup question directly.'
      })
    ).toBeNull()
    expect(
      summarySchemaError({
        headline: 'Citations rose after the content change.',
        body: 'The new FAQ caused the rise.'
      })
    ).toBe('The reply claims a cause.')
  })

  test('a sentence about an edit and a separate sentence about a source are judged apart', () => {
    expect(
      claimsCause(
        'You updated the FAQ last week. The overview cites G2 because G2 lists every price.'
      )
    ).toBe(false)
  })
})
