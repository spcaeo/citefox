import { DATA_FENCE_RULE, fence } from '../../prompts/blocks'
import type { AssistDefinition } from '../types'
import { pageMarketBlock, pageProductLines } from './context-blocks'
import {
  brandNamesOf,
  formatPageBody,
  formatPageHead,
  formatProfile,
  pageOf,
  profileOf,
  snapshotOf
} from './gather'
import { normalizeQuote, quotedFromPage } from './page-claims'
import { brandIn } from './rules'

/** Audience assists. Parts use the camelCase names of `BuyerProfileBody`. */

export const PROFILE_PART_TAGS = [
  'who',
  'environment',
  'segments',
  'triggers',
  'values',
  'poorFit'
] as const

export const AUDIENCE_ASSISTS: readonly AssistDefinition[] = [
  {
    id: 'audience.sharpen',
    title: 'Sharpen the buyer profile',
    expectedSeconds: 25,
    acceptsInstruction: true,
    needsProject: true,
    needs: ['pageId'],
    minItems: 1,
    maxItems: 6,
    task: `Propose changes that make this buyer profile more concrete for this page, this product and this market. A profile that would fit any business is wrong.
Name roles, company size (number of staff, not a plan's seat or user limit), the region (the market's country unless the page names another), the tools they already use by name, and real trigger events this page covers, named as specifically as the page names them.
Give one item per part you would change, and leave unchanged parts out.
tag is the part: who, environment, segments, triggers, values, or poorFit.
text is the full new value for that part. For triggers and values, write one entry per line. For segments and poorFit, write one entry per line as "Name: reason".
detail says in one sentence why the change is better, from the page.
Only use facts the page supports. Put anything the page does not confirm in [brackets].`,
    gather(context) {
      const opened = pageOf(context)
      const snapshot = snapshotOf(opened.db, opened.page.id)
      const profile = profileOf(opened.db, opened.page.id)
      return [
        pageMarketBlock(context, opened),
        pageProductLines(opened),
        '',
        'Current buyer profile:',
        formatProfile(profile),
        '',
        formatPageHead(opened.page, snapshot),
        `Brand names: ${brandNamesOf(opened.db).join(', ') || '(none saved)'}`,
        '',
        DATA_FENCE_RULE,
        fence('page_text', formatPageBody(snapshot))
      ].join('\n')
    },
    check(reply) {
      const parts = reply.items.map((item) => item.tag ?? '')
      if (parts.some((part) => !(PROFILE_PART_TAGS as readonly string[]).includes(part))) {
        return `Tag every item with one part: ${PROFILE_PART_TAGS.join(', ')}.`
      }
      return new Set(parts).size === parts.length ? null : 'Give one item per part.'
    }
  },
  {
    id: 'audience.triggers',
    title: 'Find more trigger events',
    expectedSeconds: 15,
    acceptsInstruction: true,
    needsProject: true,
    needs: ['pageId'],
    minItems: 1,
    maxItems: 8,
    task: `Find trigger events on this page: the named moments that send this buyer looking for a solution now.
A trigger event is something that happens, named as specifically as the page names it: a carrier announcing its email-to-text gateway shutdown, an alarm email that sat unread overnight, a schedule change that staff did not see before a shift, a registration rule that starts blocking messages. A need, a pain or a wish is not an event ("needs reliable alerts", "wants to save time").
Only events the page names or clearly sets up, for this product's buyer, and none already in the profile's "Trigger events" (no rewording of a saved one).
One event per item, 3 to 8 items; fewer when the page supports fewer.
text: the event in one sentence, naming the tool, carrier, system, rule or deadline as the page names it.
detail: in one sentence, why this event sends the buyer looking now and what they will ask next.
tag: the page element the event comes from, copied exactly as written on the page (a heading, a step title or an FAQ question).
Write in the market's language and use its carriers, laws and tools. Never name the brand.`,
    gather(context) {
      const opened = pageOf(context)
      const snapshot = snapshotOf(opened.db, opened.page.id)
      const profile = profileOf(opened.db, opened.page.id)
      return [
        pageMarketBlock(context, opened),
        pageProductLines(opened),
        `Brand names to leave out: ${brandNamesOf(opened.db).join(', ') || '(none saved)'}`,
        '',
        'Buyer profile:',
        formatProfile(profile),
        '',
        formatPageHead(opened.page, snapshot),
        '',
        DATA_FENCE_RULE,
        fence('page_text', formatPageBody(snapshot))
      ].join('\n')
    },
    check(reply, context) {
      const opened = pageOf(context)
      const snapshot = snapshotOf(opened.db, opened.page.id)
      const saved = new Set(profileOf(opened.db, opened.page.id).triggers.map(normalizeQuote))
      const brands = brandNamesOf(opened.db)
      for (const item of reply.items) {
        const brand = brandIn(item.text, brands)
        if (brand !== null) return `Leave the brand name "${brand}" out of every trigger event.`
        if (saved.has(normalizeQuote(item.text))) {
          return 'Give only trigger events that are not already in the profile.'
        }
        if (item.tag === null || !pageElement(item.tag, snapshot)) {
          return 'Tag every event with a heading, step title or FAQ question copied exactly from the page.'
        }
      }
      return null
    }
  }
]

/** A heading, FAQ question or other text copied from the page (outline entries included). */
function pageElement(
  tag: string,
  snapshot: Parameters<typeof quotedFromPage>[1] & { outline: readonly { text: string }[] }
): boolean {
  const wanted = normalizeQuote(tag)
  if (snapshot.outline.some((entry) => normalizeQuote(entry.text) === wanted)) return true
  return quotedFromPage(tag, snapshot)
}
