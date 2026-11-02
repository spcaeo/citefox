import { describe, expect, test } from 'vitest'
import { CSV_JS } from './csv'
import { STATE_JS } from './state'

/** The view state and CSV parts of the report script, run on their own. */

interface View {
  s: string
  d: string[]
  f: Record<string, string>
  g: Record<string, string>
}

interface StateApi {
  empty: () => View
  encode: (view: View) => string
  decode: (hash: string) => View
  push: (stack: string[], entry: string, inDrawer: boolean) => string[]
  pop: (stack: string[]) => string[]
  truncate: (stack: string[], n: number) => string[]
  same: (a: string[], b: string[]) => boolean
  MAX_DEPTH: number
}

interface CsvApi {
  cell: (value: unknown) => string
  text: (columns: string[], rows: unknown[][]) => string
  urls: (list: unknown[]) => string[]
  fileName: (base: string, id: string) => string
}

// The report runs these strings as its page script; the tests load them the same way.
const state = new Function(`${STATE_JS}; return CFState;`)() as StateApi
const csv = new Function(`${CSV_JS}; return CFCsv;`)() as CsvApi

describe('view address (location.hash)', () => {
  test('encodes the section, the drill stack in order, filters and chips', () => {
    const hash = state.encode({
      s: 'competition',
      d: ['dom:reddit.com', 'q:r12'],
      f: { prompts: 'twilio sms' },
      g: { topics: 'Pricing & plans' }
    })
    expect(hash).toBe(
      '#s=competition&d=dom:reddit.com&d=q:r12&f=prompts:twilio%20sms&g=topics:Pricing%20%26%20plans'
    )
  })

  test('decode reverses encode, including awkward drill tokens', () => {
    const view: View = {
      s: 'pages',
      d: ['l:dim:stage=awareness', 'p:https://textbolt.com/blog/a?x=1&y=2#top', 'find:a&b=c'],
      f: { leaderboard: 'a:b' },
      g: {}
    }
    expect(state.decode(state.encode(view))).toEqual(view)
  })

  test('an empty view has no hash, and an empty hash restores the empty view', () => {
    expect(state.encode(state.empty())).toBe('')
    expect(state.decode('')).toEqual(state.empty())
    expect(state.decode('#')).toEqual(state.empty())
  })

  test('a plain section anchor reads as that section; other anchors are ignored', () => {
    expect(state.decode('#sec-pages').s).toBe('pages')
    expect(state.decode('#main')).toEqual(state.empty())
  })

  test('junk in a hand-edited address is dropped, not trusted', () => {
    const view = state.decode('#d=q:r1&d=nope:x&d=q:&d=%E0%A4%A&x=1&f=noquery&f=:x&s=top')
    expect(view.d).toEqual(['q:r1'])
    expect(view.f).toEqual({})
    expect(view.s).toBe('top')
  })

  test('a very long stack is capped', () => {
    const hash = Array.from({ length: 30 }, (_, i) => `d=q:r${i}`).join('&')
    expect(state.decode(`#${hash}`).d).toHaveLength(state.MAX_DEPTH)
  })
})

describe('drill stack', () => {
  test('opening from the page starts a new stack; from the drawer it goes one deeper', () => {
    let stack = state.push(['l:all', 'q:r1'], 'l:aio:shown', false)
    expect(stack).toEqual(['l:aio:shown'])
    stack = state.push(stack, 'q:r3', true)
    stack = state.push(stack, 'dom:reddit.com', true)
    expect(stack).toEqual(['l:aio:shown', 'q:r3', 'dom:reddit.com'])
  })

  test('opening an entry already on the stack jumps back to it', () => {
    const stack = ['l:all', 'q:r3', 'dom:reddit.com']
    expect(state.push(stack, 'q:r3', true)).toEqual(['l:all', 'q:r3'])
    expect(state.push(stack, 'dom:reddit.com', true)).toEqual(stack)
  })

  test('Back pops one level; the trail keeps the first n levels; invalid entries are ignored', () => {
    const stack = ['l:all', 'q:r3', 'dom:reddit.com']
    expect(state.pop(stack)).toEqual(['l:all', 'q:r3'])
    expect(state.pop([])).toEqual([])
    expect(state.truncate(stack, 1)).toEqual(['l:all'])
    expect(state.push(stack, 'bad', true)).toEqual(stack)
    expect(state.same(stack, [...stack])).toBe(true)
    expect(state.same(stack, state.pop(stack))).toBe(false)
  })

  test('the stack never grows past the cap', () => {
    let stack: string[] = []
    for (let i = 0; i < 40; i += 1) stack = state.push(stack, `q:r${i}`, true)
    expect(stack).toHaveLength(state.MAX_DEPTH)
    expect(stack[stack.length - 1]).toBe('q:r39')
  })
})

describe('CSV text', () => {
  test('quotes text, doubles quotes, keeps numbers bare and ends lines in CRLF', () => {
    expect(
      csv.text(
        ['A', 'B'],
        [
          ['x "y"', 3],
          [null, 'z']
        ]
      )
    ).toBe('"A","B"\r\n"x ""y""",3\r\n,"z"\r\n')
  })

  test('neutralises formula starts and never prints an object', () => {
    expect(['=1+1', '+x', '-y', '@z', '\tq'].map(csv.cell)).toEqual([
      `"'=1+1"`,
      `"'+x"`,
      `"'-y"`,
      `"'@z"`,
      `"'\tq"`
    ])
    expect(csv.cell(-2)).toBe('-2')
    expect(csv.cell(Number.NaN)).toBe('')
    expect(csv.cell({ a: 1 })).toBe('')
    expect(csv.cell(['a'])).toBe('')
    expect(csv.cell(true)).toBe('"Yes"')
  })

  test('URL lists keep http(s) only, once each, in order', () => {
    expect(
      csv.urls([
        'https://a.com/1',
        'javascript:alert(1)',
        'http://b.com',
        'https://a.com/1',
        null,
        '/relative'
      ])
    ).toEqual(['https://a.com/1', 'http://b.com'])
  })

  test('file names are safe slugs', () => {
    expect(csv.fileName('site-report', 'Prompts citing reddit.com / "x"')).toBe(
      'site-report-prompts-citing-reddit-com-x.csv'
    )
    expect(csv.fileName('', '')).toBe('citefox-report-table.csv')
  })
})
