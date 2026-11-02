import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  HELP_TOPIC_IDS,
  HELP_TOPIC_TITLES,
  helpIdFromPath,
  isHelpTopicId,
  parseHelpFiles,
  parseHelpTopic,
  slugOf,
  splitSections
} from './index'

const HELP_DIR = resolve(__dirname, '../../../Docs/help')

const SAMPLE = `---
id: sample
title: A sample
screen: reports
keywords: [One, two words, three]
summary: What it is for.
---

Intro text before any section.

## What it shows

A list.

- one
- two

## Common questions

### Why is it empty?

It needs a check.

### How do I add my agency logo?

Open settings.
`

describe('parseHelpTopic', () => {
  it('reads the front matter, the sections and the questions', () => {
    const topic = parseHelpTopic(SAMPLE)
    expect(topic).not.toBeNull()
    expect(topic?.id).toBe('sample')
    expect(topic?.title).toBe('A sample')
    expect(topic?.screen).toBe('reports')
    expect(topic?.keywords).toEqual(['one', 'two words', 'three'])
    expect(topic?.summary).toBe('What it is for.')
    expect(topic?.sections.map((section) => section.heading)).toEqual([
      'What it shows',
      'Common questions'
    ])
    expect(topic?.sections[0]?.body).toBe('A list.\n\n- one\n- two')
    expect(topic?.questions).toEqual(['Why is it empty?', 'How do I add my agency logo?'])
  })

  it('refuses a file with no or incomplete front matter', () => {
    expect(parseHelpTopic('# Just markdown')).toBeNull()
    expect(parseHelpTopic('---\nid: x\ntitle: X\n---\nbody')).toBeNull()
    expect(parseHelpTopic(SAMPLE.replace('screen: reports', 'screen: nowhere'))).toBeNull()
  })

  it('refuses an id that is not the file name', () => {
    expect(parseHelpTopic(SAMPLE, 'other')).toBeNull()
    expect(parseHelpTopic(SAMPLE, 'sample')?.id).toBe('sample')
  })

  it('reads Windows line ends', () => {
    expect(parseHelpTopic(SAMPLE.replace(/\n/g, '\r\n'))?.sections).toHaveLength(2)
  })
})

describe('splitSections', () => {
  it('splits on ## only, keeping ### inside the section', () => {
    const sections = splitSections('lead\n## One\na\n### Sub\nb\n## Two\nc')
    expect(sections).toEqual([
      { heading: 'One', slug: 'one', body: 'a\n### Sub\nb' },
      { heading: 'Two', slug: 'two', body: 'c' }
    ])
  })

  it('slugs headings', () => {
    expect(slugOf('Common questions')).toBe('common-questions')
    expect(slugOf('How to open, download or send a report')).toBe(
      'how-to-open-download-or-send-a-report'
    )
  })
})

describe('parseHelpFiles', () => {
  it('orders topics by the id list and skips broken files', () => {
    const topics = parseHelpFiles({
      '/x/Docs/help/glossary.md': SAMPLE.replace('id: sample', 'id: glossary'),
      '/x/Docs/help/summary.md': SAMPLE.replace('id: sample', 'id: summary'),
      '/x/Docs/help/broken.md': 'no front matter'
    })
    expect(topics.map((topic) => topic.id)).toEqual(['summary', 'glossary'])
    expect(helpIdFromPath('C:\\a\\help\\reports-impact.md')).toBe('reports-impact')
    expect(isHelpTopicId('glossary')).toBe(true)
    expect(isHelpTopicId('nope')).toBe(false)
  })

  it('uses the one id list shared with Ask CiteFox', () => {
    expect([...HELP_TOPIC_IDS].sort()).toEqual(Object.keys(HELP_TOPIC_TITLES).sort())
  })
})

describe('Docs/help', () => {
  const files = Object.fromEntries(
    readdirSync(HELP_DIR)
      .filter((name) => name.endsWith('.md'))
      .map((name) => [join(HELP_DIR, name), readFileSync(join(HELP_DIR, name), 'utf8')])
  )
  const topics = parseHelpFiles(files)

  it.each(HELP_TOPIC_IDS.map((id) => [id]))('%s exists with front matter', (id) => {
    const raw = files[join(HELP_DIR, `${id}.md`)]
    expect(raw, `Docs/help/${id}.md is missing`).toBeDefined()
    const topic = parseHelpTopic(raw ?? '', id)
    expect(topic, `Docs/help/${id}.md has no valid front matter`).not.toBeNull()
    expect(topic?.keywords.length).toBeGreaterThan(0)
    expect(topic?.sections.length).toBeGreaterThan(0)
  })

  it('has no file outside the id list, and every file parses', () => {
    expect(Object.keys(files).map(helpIdFromPath).sort()).toEqual([...HELP_TOPIC_IDS].sort())
    expect(topics).toHaveLength(HELP_TOPIC_IDS.length)
  })

  it('asks common questions the way people ask them', () => {
    for (const topic of topics) {
      expect(topic.questions.length, `${topic.id} has no common questions`).toBeGreaterThan(0)
      for (const question of topic.questions) expect(question).toMatch(/\?$/)
    }
  })

  it('never names a provider, and stays short', () => {
    for (const [path, raw] of Object.entries(files)) {
      expect(raw, path).not.toMatch(/\b(cloro|serpapi|claude|jina|anthropic)\b/i)
      expect(raw.split('\n').length, path).toBeLessThan(90)
    }
  })

  it('has no raw HTML', () => {
    for (const [path, raw] of Object.entries(files)) expect(raw, path).not.toMatch(/<[a-z/][^>]*>/i)
  })
})
