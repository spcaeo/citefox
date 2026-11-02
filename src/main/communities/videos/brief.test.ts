import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import type { VideoBrief } from '@shared/domain'
import { templateNames } from '@shared/template-syntax'
import { recordedBrief } from '../seed.test-helper'
import {
  finalizeVideoBrief,
  renderVideoBriefPrompt,
  VIDEO_BRIEF_KIND,
  VIDEO_BRIEF_TEMPLATE,
  videoBriefProblem,
  type VideoBriefContext
} from './brief'
import { captionsSrt, scriptMarkdown, seconds, shotListCsv, videoSlug } from './files'

const PAGE = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'

const CONTEXT: VideoBriefContext = {
  question: 'How do I alert the crew?',
  related_prompts: 'None',
  markets: 'mkt-us',
  brand_names: 'TextBolt',
  videos_cited: '- A video',
  page_url: PAGE,
  page_title: 'Text alerts',
  page_h1: 'Text alerts',
  page_sections: '- Text alerts',
  page_text: '<page_text>\nBody\n</page_text>',
  product_block: 'Product: Email to SMS. Job: Send texts from email.',
  buyer_block: 'Buyer: Office managers.\nEnvironment: not known.\nTriggers: not known.'
}

const SECTIONS = ['Text alerts for business', 'Step 3: Connect your tools']

describe('video_brief template (FR-18.4)', () => {
  test('ships as a kind with a body hash, and uses only context variables', () => {
    expect(VIDEO_BRIEF_KIND).toBe('video_brief')
    expect(VIDEO_BRIEF_TEMPLATE.hash).toBe(
      createHash('sha256').update(VIDEO_BRIEF_TEMPLATE.body, 'utf8').digest('hex')
    )
    expect(templateNames(VIDEO_BRIEF_TEMPLATE.body).sort()).toEqual(Object.keys(CONTEXT).sort())
    const prompt = renderVideoBriefPrompt(VIDEO_BRIEF_TEMPLATE.body, CONTEXT)
    expect(prompt).not.toContain('{{')
    expect(prompt).toContain('Buyer question: How do I alert the crew?')
    expect(prompt).toMatch(/Do not promise that the video will be cited/)
    expect(prompt).toContain(
      'Product: Email to SMS. Job: Send texts from email.\nBuyer: Office managers.'
    )
    expect(prompt).toContain('<page_text>\nBody\n</page_text>')
  })

  test('the recorded reply passes the schema and the domain checks', () => {
    expect(videoBriefProblem(recordedBrief(), PAGE)).toBeNull()
    expect(videoBriefProblem(recordedBrief(), PAGE, SECTIONS)).toBeNull()
  })

  test.each([
    ['a price', 'Plans start at $29 a month.'],
    ['a percentage', 'Open rates run near 98% for texts.'],
    ['a limit', 'Each message holds 160 characters.'],
    ['a rate', 'You pay 2 cents per message, 1,000 texts a month.'],
    [
      'a long line',
      'TextBolt turns every email you send to a phone number at its gateway address into a text message that lands on the phone of each person on your crew list, and their replies come back to you.'
    ]
  ])('a line with %s and no source is refused', (_name, text) => {
    const brief = structuredClone(recordedBrief()) as Brief
    brief.script[0] = { at: '00:00', text, source: null }
    expect(videoBriefProblem(brief, PAGE)?.message).toMatch(/00:00 makes a claim with no source/)
  })

  test('framing lines need no source', () => {
    const brief = structuredClone(recordedBrief()) as Brief
    brief.script[0] = { at: '00:00', text: 'In the next 2 minutes, here is the fix.', source: null }
    brief.script.push({ at: '01:50', text: 'Try it free from the link below.', source: null })
    expect(videoBriefProblem(brief, PAGE, SECTIONS)).toBeNull()
  })

  test('a source on the page must name one of the page sections', () => {
    const brief = structuredClone(recordedBrief()) as Brief
    brief.sources[0]!.section = 'Text alerts for small business'
    expect(videoBriefProblem(brief, PAGE, SECTIONS)?.message).toMatch(
      /Source 1 is marked on the page, but "Text alerts for small business" is not one of the page's sections/
    )
    brief.sources[0]!.section = 'Step 3 · step 3: connect your tools'
    expect(videoBriefProblem(brief, PAGE, SECTIONS)).toBeNull()
    brief.sources[0]!.section = 'TEXT ALERTS FOR BUSINESS'
    expect(videoBriefProblem(brief, PAGE, SECTIONS)).toBeNull()
  })

  test.each([
    ['a script line points to an unlisted source', (b: Brief) => setSource(b, 7), /source 7/],
    ['two sources share a number', (b: Brief) => dupSource(b), /share a number/],
    [
      'the description does not link the page',
      (b: Brief) => (b.description = 'x'),
      /link the page/
    ],
    ['the hook claims a cause', (b: Brief) => (b.hook = 'This video caused a citation.'), /cause/],
    ['a scene kind is unknown', (b: Brief) => (b.scenes[0]!.kind = 'gif'), /schema/]
  ])('%s is refused', (_name, change, message) => {
    const brief = structuredClone(recordedBrief()) as Brief
    change(brief)
    expect(videoBriefProblem(brief, PAGE)?.message).toMatch(message)
  })

  test('a source marked on the page whose section is not there is flagged', () => {
    const reply = structuredClone(recordedBrief()) as Brief
    reply.sources[2] = { n: 3, section: 'Replies come back to email', onPage: true }
    const brief = finalizeVideoBrief(
      reply,
      { sections: ['Text alerts for business'], text: 'No developer required.' },
      '2026-10-20T00:00:00.000Z',
      'a'.repeat(64)
    )
    expect(brief.sources).toEqual([
      { n: 1, section: 'Text alerts for business', onPage: true },
      {
        n: 2,
        section: 'Not on the page yet. Add a test step before you publish, or cut the line.',
        onPage: false
      },
      { n: 3, section: 'Replies come back to email', onPage: false }
    ])
  })
})

interface Brief {
  description: string
  hook: string
  script: { at: string; text: string; source: number | null }[]
  sources: { n: number; section: string; onPage: boolean }[]
  scenes: { kind: string }[]
}

function setSource(brief: Brief, n: number): void {
  const line = brief.script[1]
  if (line) line.source = n
}

function dupSource(brief: Brief): void {
  const second = brief.sources[1]
  if (second) second.n = 1
}

describe('Export for your editor (FR-18.5)', () => {
  const brief: VideoBrief = finalizeVideoBrief(
    recordedBrief(),
    { sections: ['Text alerts for business'], text: '' },
    '2026-10-20T00:00:00.000Z',
    'a'.repeat(64)
  )

  test('captions run from each line to the next, the last for five seconds', () => {
    const srt = captionsSrt(brief)
    const blocks = srt.trim().split('\n\n')
    expect(blocks).toHaveLength(brief.script.length)
    expect(blocks[1]).toBe(
      '2\n00:00:20,000 --> 00:00:45,000\nTextBolt sends text alerts from email, so the tools you already use can text your crew.'
    )
    expect(blocks.at(-1)?.split('\n')[1]).toBe('00:01:40,000 --> 00:01:45,000')
  })

  test('the shot list neutralises formula text and names the chapter', () => {
    const tricky = { ...brief, scenes: [{ ...brief.scenes[0]!, note: '=HYPERLINK("x")' }] }
    const rows = shotListCsv(tricky).replace('﻿', '').trim().split('\r\n')
    expect(rows[1]).toBe('1,00:00,The problem,card,Hook,"\'=HYPERLINK(""x"")"')
  })

  test('the script lists sources and flags the ones not on the page', () => {
    const md = scriptMarkdown(brief, { question: 'Q?', pageUrl: PAGE })
    expect(md).toContain('**00:20** TextBolt sends text alerts from email')
    expect(md).toContain('[1]')
    expect(md).toContain('3. Not on the page yet. Say that replies come back to the sending inbox')
  })

  test('slugs and times', () => {
    expect(videoSlug('Émail → SMS: the 10-minute fix!')).toBe('email-sms-the-10-minute-fix')
    expect(videoSlug('???')).toBe('video')
    expect(seconds('2:05')).toBe(125)
  })
})
