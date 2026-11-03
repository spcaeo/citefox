import { describe, expect, test } from 'vitest'
import type { SiteOutline } from '../../engine/site-outline'
import { textboltContext } from '../sections/test-context.test-helper'
import { FILL_MAX_WORDS, rowFillDef } from './defs'
import {
  ROW_FILL_REPLY_RULE,
  ROW_FILL_SCHEMA,
  rowFillPrompt,
  rowFillTask,
  type RowFillPromptInput
} from './prompt'
import { readRowFill, replyJson } from './reply'
import { parseRowFill } from './request'

const PRODUCTS = rowFillDef('products')
const BUYERS = rowFillDef('buyers')

const SITE: SiteOutline = {
  pages: [
    { path: '/', title: 'TextBolt' },
    { path: '/bulk-sms/', title: 'Bulk SMS' }
  ],
  menu: [{ text: 'Mass texting', path: '/Mass-Texting/' }]
}

function promptInput(over: Partial<RowFillPromptInput> = {}): RowFillPromptInput {
  const context = textboltContext()
  return {
    name: 'Mass texting',
    domain: context.domain,
    summary: context.summary,
    brands: context.brands,
    examples: context.products,
    site: SITE,
    ...over
  }
}

describe('row fill prompt', () => {
  test('carries the brand, site, confirmed summary, the name, styled examples and known pages', () => {
    const task = rowFillTask(PRODUCTS, promptInput())
    expect(task).toContain('textbolt.com')
    expect(task).toContain('TextBolt; Text Bolt')
    expect(task).toContain('What it does (the person confirmed this): TextBolt sells')
    expect(task).toContain('- Email-to-SMS gateway: Turns emails into texts.')
    expect(task).toContain('Product or service to describe: "Mass texting"')
    expect(task).toContain('- /bulk-sms/: Bulk SMS')
    expect(task).toContain(`at most ${FILL_MAX_WORDS} words`)
  })

  test('says to leave the line empty rather than guess, and never to invent a path', () => {
    const task = rowFillTask(PRODUCTS, promptInput())
    expect(task).toMatch(
      /If you do not recognise the name or cannot tell what it is, leave line empty/u
    )
    expect(task).toMatch(/A blank is better than a guess/u)
    expect(task).toMatch(/Never write a path that is not in that list/u)
  })

  test('a list without pages never asks for one and shows no path list', () => {
    const task = rowFillTask(BUYERS, promptInput({ name: 'Clinic managers' }))
    expect(task).toContain('Buyer to describe (who they are): "Clinic managers"')
    expect(task).toContain('page = always ""')
    expect(task).not.toContain('Site paths')
  })

  test('no site read: no paths block; empty examples and summary are left out', () => {
    const task = rowFillTask(PRODUCTS, promptInput({ site: null, examples: [], summary: '' }))
    expect(task).not.toContain('Site paths')
    expect(task).not.toContain('already listed')
    expect(task).not.toContain('the person confirmed this')
  })

  test('examples without a detail are not shown; at most six are', () => {
    const many = Array.from({ length: 9 }, (_, index) => ({
      name: `Product ${index}`,
      detail: `Does thing ${index}`,
      url: null,
      tag: null
    }))
    const task = rowFillTask(
      PRODUCTS,
      promptInput({ examples: [{ name: 'Bare', detail: '', url: null, tag: null }, ...many] })
    )
    expect(task).not.toContain('- Bare')
    expect(task.match(/- Product \d/gu)).toHaveLength(6)
  })

  test('the run prompt starts with the routing line and ends with the JSON reply rule', () => {
    const prompt = rowFillPrompt(PRODUCTS, promptInput())
    expect(prompt.startsWith('Assist: setup.rowFillProducts\n')).toBe(true)
    expect(prompt.endsWith(ROW_FILL_REPLY_RULE)).toBe(true)
    expect(ROW_FILL_SCHEMA.required).toEqual(['line', 'page'])
  })

  test('keys and emails are scrubbed from the prompt', () => {
    const task = rowFillTask(PRODUCTS, promptInput({ name: 'Tool sk-secret-12345 for me@x.com' }), [
      'sk-secret-12345'
    ])
    expect(task).not.toContain('sk-secret-12345')
    expect(task).not.toContain('me@x.com')
  })
})

describe('row fill reply', () => {
  test('a good answer becomes the detail, with a known page spelled as the site lists it', () => {
    expect(
      readRowFill(
        PRODUCTS,
        'Mass texting',
        { line: 'Sends one text to a whole list.', page: '/mass-texting' },
        SITE
      )
    ).toEqual({ detail: 'Sends one text to a whole list', url: '/Mass-Texting/' })
  })

  test.each(['unknown', 'Unknown.', 'N/A', 'none', 'not sure', "I don't know", '—', ''])(
    '%j means blank, and the page goes with it',
    (line) => {
      expect(readRowFill(PRODUCTS, 'Mass texting', { line, page: '/bulk-sms/' }, SITE)).toEqual({
        detail: '',
        url: null
      })
    }
  )

  test('a URL that is not a known page is dropped, the line stays', () => {
    expect(
      readRowFill(PRODUCTS, 'X', { line: 'Sends texts to lists', page: '/made-up-page/' }, SITE)
    ).toEqual({ detail: 'Sends texts to lists', url: null })
  })

  test('a full URL on the site that is known is reduced to its path', () => {
    expect(
      readRowFill(
        PRODUCTS,
        'X',
        { line: 'Sends texts', page: 'https://textbolt.com/bulk-sms/' },
        SITE
      )
    ).toEqual({ detail: 'Sends texts', url: '/bulk-sms/' })
  })

  test('no known pages at all: never a URL', () => {
    expect(
      readRowFill(PRODUCTS, 'X', { line: 'Sends texts', page: '/bulk-sms/' }, null).url
    ).toBeNull()
    expect(
      readRowFill(
        PRODUCTS,
        'X',
        { line: 'Sends texts', page: '/bulk-sms/' },
        { pages: [], menu: [] }
      ).url
    ).toBeNull()
  })

  test('buyers never get a page', () => {
    expect(
      readRowFill(
        BUYERS,
        'Clinic managers',
        { line: 'Their reminders stopped', page: '/bulk-sms/' },
        SITE
      )
    ).toEqual({ detail: 'Their reminders stopped', url: null })
  })

  test('an over-long line is cut to the word cap and does not end on a loose word', () => {
    const long =
      'Sends one text message to a whole contact list at once so small teams can reach customers and'
    const out = readRowFill(PRODUCTS, 'X', { line: long, page: '' }, SITE).detail
    expect(out.split(' ').length).toBeLessThanOrEqual(FILL_MAX_WORDS)
    expect(out).toBe('Sends one text message to a whole contact list at once so small teams')
    const huge = 'a'.repeat(400)
    expect(
      readRowFill(PRODUCTS, 'X', { line: huge, page: '' }, SITE).detail.length
    ).toBeLessThanOrEqual(120)
  })

  test('the AI talking about itself, or the name said again, is blank', () => {
    expect(
      readRowFill(PRODUCTS, 'X', { line: "I don't recognise this product", page: '' }, SITE).detail
    ).toBe('')
    expect(
      readRowFill(PRODUCTS, 'Mass texting', { line: 'Mass Texting', page: '' }, SITE).detail
    ).toBe('')
  })

  test('quotes and spaces are tidied; junk shapes are blank', () => {
    expect(
      readRowFill(PRODUCTS, 'X', { line: '  "Sends   texts."  ', page: '' }, SITE).detail
    ).toBe('Sends texts')
    expect(readRowFill(PRODUCTS, 'X', null, SITE).detail).toBe('')
    expect(readRowFill(PRODUCTS, 'X', ['a'], SITE).detail).toBe('')
    expect(readRowFill(PRODUCTS, 'X', { line: 5, page: '' }, SITE).detail).toBe('')
  })

  test('replyJson takes the provider JSON, else the first object in the text', () => {
    expect(replyJson({ line: 'a' }, 'ignored')).toEqual({ line: 'a' })
    expect(replyJson(null, '{"line":"a","page":""}')).toEqual({ line: 'a', page: '' })
    expect(replyJson(null, 'Sure! {"line":"a","page":""} Done.')).toEqual({ line: 'a', page: '' })
    expect(replyJson(null, 'no json here')).toBeNull()
  })
})

describe('row fill request', () => {
  const valid = (): Record<string, unknown> => ({
    list: 'products',
    context: textboltContext(),
    name: '  Mass   texting ',
    examples: [{ name: 'A', detail: 'b', url: null, tag: null }]
  })

  test('accepts a full request and tidies the name', () => {
    const parsed = parseRowFill(valid())
    expect(parsed.name).toBe('Mass texting')
    expect(parsed.list).toBe('products')
  })

  test('refuses other lists, extra keys, an empty name and too many examples', () => {
    expect(() => parseRowFill({ ...valid(), list: 'competitors' })).toThrow()
    expect(() => parseRowFill({ ...valid(), extra: 1 })).toThrow()
    expect(() => parseRowFill({ ...valid(), name: '   ' })).toThrow()
    expect(() =>
      parseRowFill({
        ...valid(),
        examples: Array.from({ length: 13 }, () => ({
          name: 'A',
          detail: '',
          url: null,
          tag: null
        }))
      })
    ).toThrow()
    expect(() => parseRowFill(null)).toThrow()
  })
})
