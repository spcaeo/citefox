import { resolve } from 'node:path'
import type { FillFromWebsiteResult } from '@shared/ipc'
import { describe, expect, test } from 'vitest'
import { APP_ORDER, EvalArgsError, parseEvalArgs, parseSections, parseSiteList } from './args'
import { applyFill, applySection, contextFor, emptyDraft } from './draft'
import { recordCalls } from './recorder'
import { pageTextOf } from './run'
import { ASSIST_OUTPUT_RULES } from '../assist/preamble'

describe('prompt bench args', () => {
  const noFile = (): string | null => null

  test('defaults: every section in app order, US/en, out resolved from cwd', () => {
    const args = parseEvalArgs(
      ['--sites', 'https://www.TextBolt.com/,linear.app', '--out', 'o'],
      '/w',
      noFile
    )
    expect(args).toEqual({
      sites: ['textbolt.com', 'linear.app'],
      sections: [...APP_ORDER],
      out: resolve('/w', 'o'), // a drive path on Windows
      label: 'run',
      country: 'US',
      language: 'en'
    })
  })

  test('a sites file: one per line, comments and repeats dropped', () => {
    const file = '# list\ntextbolt.com\n\nlinear.app # tracker\ntextbolt.com\n'
    const args = parseEvalArgs(
      ['--sites', 'sites.txt', '--out', '/o', '--label', 'baseline'],
      '/w',
      (path) => (path === resolve('/w', 'sites.txt') ? file : null)
    )
    expect(args.sites).toEqual(['textbolt.com', 'linear.app'])
    expect(args.label).toBe('baseline')
  })

  test('sections keep app order whatever order they are typed in', () => {
    expect(parseSections('questions,buyers,summary')).toEqual(['buyers', 'questions', 'summary'])
    expect(() => parseSections('buyers,nope')).toThrow(EvalArgsError)
  })

  test('bad input is refused', () => {
    expect(() => parseEvalArgs(['--out', '/o'], '/w', noFile)).toThrow('--sites is required')
    expect(() => parseEvalArgs(['--sites', 'a.com'], '/w', noFile)).toThrow('--out is required')
    expect(() =>
      parseEvalArgs(['--sites', 'a.com', '--out', '/o', '--country', 'XX1'], '/w', noFile)
    ).toThrow(EvalArgsError)
    expect(() => parseEvalArgs(['--sites', 'a.com', '--bogus', 'x'], '/w', noFile)).toThrow(
      'Unknown flag'
    )
    expect(() => parseSiteList('not a domain', false)).toThrow(EvalArgsError)
  })
})

describe('prompt bench context chaining', () => {
  const fill: FillFromWebsiteResult = {
    domain: 'textbolt.com',
    pagesRead: [],
    summary: ' TextBolt sends texts. ',
    products: [
      {
        id: 'p1',
        name: 'Email to text',
        job: 'Send texts from email',
        buyer: 'Teams',
        evidence: { path: '/email', quote: 'q' },
        searchNote: null
      }
    ],
    brands: [{ id: 'b1', name: 'TextBolt', reason: 'r' }],
    competitors: [
      {
        id: 'c1',
        name: 'SimpleTexting',
        domain: 'simpletexting.com',
        reason: 'texting',
        product: 'p1',
        tier: 'direct'
      },
      { id: 'c2', name: 'Simple-Texting', domain: null, reason: 'dupe', product: 'p1' }
    ] as unknown as FillFromWebsiteResult['competitors'],
    switchingFrom: [
      { id: 's1', name: 'Shared phone', domain: null, reason: 'r' }
    ] as unknown as FillFromWebsiteResult['switchingFrom'],
    integrations: [
      { id: 'i1', name: 'Gmail', domain: 'gmail.com', reason: 'r' }
    ] as unknown as FillFromWebsiteResult['integrations'],
    suggestedMarket: null,
    message: '',
    nextStep: null
  }

  test('the site read fills the context the way setup step 3 does', () => {
    const context = contextFor(applyFill(emptyDraft('textbolt.com', 'US', 'en'), fill))
    expect(context.summary).toBe('TextBolt sends texts.')
    expect(context.brands).toEqual(['TextBolt'])
    expect(context.products).toEqual([
      { name: 'Email to text', detail: 'Send texts from email', url: '/email', tag: null }
    ])
    expect(context.competitors).toEqual([
      {
        name: 'SimpleTexting',
        detail: 'texting',
        url: 'simpletexting.com',
        tag: 'Email to text',
        tier: 'direct'
      }
    ])
    expect(context.switchingFrom).toEqual(['Shared phone'])
    expect(context.integrations).toEqual(['Gmail'])
    expect(context.mix).toEqual({ search: 4, question: 4, situation: 4 })
  })

  test('each section result feeds the next section', () => {
    let draft = applyFill(emptyDraft('textbolt.com', 'US', 'en'), fill)
    draft = applySection(draft, 'buyers', {
      section: 'buyers',
      rows: [{ name: 'Clinic manager', detail: 'Missed calls', url: null, tag: null }],
      text: null,
      warnings: []
    })
    draft = applySection(draft, 'topic', {
      section: 'topic',
      rows: [],
      text: 'business texting',
      warnings: []
    })
    const context = contextFor(draft)
    expect(context.buyers.map((row) => row.name)).toEqual(['Clinic manager'])
    expect(context.topic).toBe('business texting')
    // An empty text keeps what was there.
    draft = applySection(draft, 'summary', {
      section: 'summary',
      rows: [],
      text: '  ',
      warnings: []
    })
    expect(contextFor(draft).summary).toBe('TextBolt sends texts.')
  })
})

describe('prompt bench recorder', () => {
  test('keeps the prompt, the reply and the routing id', async () => {
    const recorder = recordCalls({
      id: 'claude-code',
      complete: (request) =>
        Promise.resolve({
          provider: 'claude-code',
          text: `echo ${request.prompt}`,
          json: null,
          inputTokens: 1,
          outputTokens: 2,
          durationMs: 5,
          model: 'm',
          resolvedModel: null,
          usage: {} as never
        })
    })
    await recorder.provider.complete({
      prompt: 'hi',
      trace: {
        source: 'assist',
        projectId: null,
        assistId: 'setup.buyers',
        templateKind: null,
        templateId: null,
        templateHash: null
      }
    })
    expect(recorder.since(0, 'setup.buyers')).toMatchObject([
      { n: 1, prompt: 'hi', reply: 'echo hi', callMs: 5 }
    ])
    expect(recorder.since(1)).toEqual([])
  })

  test('the page text is cut out of the site-read prompt', () => {
    const prompt = `Assist: x\nRead.\n\nThe pages read, each starting with its path:\n\n/ (home): T\nbody\n\n${ASSIST_OUTPUT_RULES}\n\nshape`
    expect(pageTextOf(prompt)).toBe('/ (home): T\nbody')
  })
})
