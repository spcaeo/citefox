import { brandNamed } from '@shared/brand-mentions'
import { groundBuyer, guessesNumbers } from './ground'
import { brandWords, cell, clip, withDetail } from './rows'
import type { ListSectionDef } from './types'

/**
 * Step 5: who buys and what sends them looking. The wording comes from the `buyers`
 * help-fill kind (`helpfill/kinds/buyers.ts`) and the `audience.triggers` assist
 * (`assist/definitions/audience.ts`). Both are held to the site (prompt bench report):
 * buyers come from the industries, roles and use cases the pages name, with the words
 * that show it, and neither invents a size, revenue or dollar figure (checked in code).
 */

const ROLE = 'You help a company describe the buyers who search for what it sells.'

const NO_GUESSED_NUMBERS =
  'Never add a company size, headcount, revenue, price or dollar figure the pages do not show.'

export const BUYERS_SECTION: ListSectionDef = {
  kind: 'list',
  id: 'buyers',
  noun: ['buyer', 'buyers'],
  context: ['website', 'market', 'summary', 'products', 'triggers'],
  site: ['audiences', 'quotes', 'paths'],
  webSearch: false,
  usd: 0.01,
  columns: ['who', 'situation', 'evidence'],
  entity: null,
  count: 5,
  maxRows: 5,
  neutral: false,
  role: () => ROLE,
  task: (context, count) => [
    `List ${count} buyer types who would search for what ${context.domain} sells.`,
    'Build each from an industry, role, team or use case the pages name (see above), as a buyer would describe themselves. A buyer type the pages do not support is wrong, and so is one that would fit any business.',
    NO_GUESSED_NUMBERS,
    'who = the buyer type in a few words, such as "Recruiting teams at staffing agencies"',
    'situation = what happened to them and what they need now, in one sentence',
    'evidence = a few words copied exactly from the pages above that name this industry, role or use case'
  ],
  toRow(values, _context, ground) {
    const who = clip(cell(values, 'who').replace(/[.;:]+$/u, ''), 160)
    const held = groundBuyer(who, cell(values, 'situation'), cell(values, 'evidence'), ground)
    if (held === null) return null
    return { name: held.name, detail: clip(held.detail, 400), url: null, tag: null }
  },
  keys: (row) => [row.name],
  line: (row) => withDetail(row.name, row.detail)
}

export const TRIGGERS_SECTION: ListSectionDef = {
  kind: 'list',
  id: 'triggers',
  noun: ['trigger event', 'trigger events'],
  context: ['website', 'market', 'summary', 'products', 'buyers'],
  site: ['quotes', 'audiences'],
  webSearch: false,
  usd: 0.01,
  columns: ['trigger'],
  entity: null,
  count: 6,
  maxRows: 6,
  neutral: false,
  role: () => ROLE,
  task: (context, count) => [
    `List ${count} trigger events: the moments that send these buyers looking for what ${context.domain} sells now.`,
    'A trigger event is something that happens, such as a tool they rely on announcing its end of life, a price rise at renewal, a failed audit, a new rule taking effect or a team growing past what its current setup handles. A need, a pain or a wish is not an event ("needs better reporting", "wants to save time").',
    'Base each on the buyers above and on what the pages say the product solves.',
    NO_GUESSED_NUMBERS,
    `trigger = the event in one sentence, naming the tool, rule or deadline when you can. Write in the market's language and use its laws and tools. Never name ${brandWords(context)}.`
  ],
  toRow(values, context, ground) {
    const name = clip(cell(values, 'trigger').replace(/[;:]+$/u, ''), 200)
    if (name.length < 4 || brandNamed(name, context.brands)) return null
    if (guessesNumbers(name, ground)) return null
    return { name, detail: '', url: null, tag: null }
  },
  keys: (row) => [row.name],
  line: (row) => row.name
}
