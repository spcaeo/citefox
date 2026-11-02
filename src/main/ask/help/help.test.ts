import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkFactsText } from './facts'
import { loadHelpTopics, resolveHelpDirectory, setHelpDirectory } from './library'
import { parseHelpFile } from './parse'
import { rankSections } from './rank'
import {
  findHelp,
  helpLinksFor,
  helpPromptText,
  isHowQuestion,
  nextStepFor,
  STRONG_HELP_SCORE
} from './retrieve'

const FIXTURES = join(process.cwd(), 'src/main/ask/fixtures/help')

afterEach(() => setHelpDirectory(undefined))

describe('parseHelpFile', () => {
  it('reads front matter and splits the body into sections', () => {
    const topic = parseHelpFile(
      'glossary',
      '---\nid: glossary\ntitle: "Glossary"\nscreen: summary\nkeywords: [Words, terms]\nsummary: The words.\n---\n# Glossary\n\nLead text.\n\n## Right page\n\nThe **target** page is [cited](https://x).\n\n### Also OK\n\nA second page.\n'
    )
    expect(topic).toMatchObject({
      id: 'glossary',
      title: 'Glossary',
      screen: 'summary',
      keywords: ['words', 'terms']
    })
    expect(topic?.sections.map((section) => section.heading)).toEqual([
      'Glossary',
      'Right page',
      'Also OK'
    ])
    expect(topic?.sections[0]?.text).toBe('The words. Lead text.')
    expect(topic?.sections[1]?.text).toBe('The target page is cited.')
  })

  it('reads a YAML list of keywords, and a file with no front matter', () => {
    const listed = parseHelpFile(
      'q',
      '---\ntitle: Q\nkeywords:\n  - one\n  - two words\n---\nBody.'
    )
    expect(listed?.keywords).toEqual(['one', 'two words'])
    const bare = parseHelpFile('bare', '# Bare title\n\nJust text.')
    expect(bare).toMatchObject({ title: 'Bare title', screen: null })
    expect(bare?.sections[0]?.text).toBe('Just text.')
  })

  it('refuses ids that are not file-name ids', () => {
    expect(parseHelpFile('Not A Topic', 'x')).toBeNull()
    expect(parseHelpFile('../etc', 'x')).toBeNull()
  })
})

describe('the help library', () => {
  it('loads the fixture topics, skipping drafts and bad names', () => {
    const ids = loadHelpTopics(FIXTURES).map((topic) => topic.id)
    expect(ids).toEqual(['glossary', 'history', 'questions', 'reports-branding'])
  })

  it('copes with a missing or empty folder', () => {
    setHelpDirectory(null)
    expect(resolveHelpDirectory()).toBeNull()
    expect(loadHelpTopics()).toEqual([])
    expect(findHelp('How do I set a target page?', { screen: 'questions' })).toEqual([])
    expect(loadHelpTopics(join(FIXTURES, 'nope'))).toEqual([])
    const empty = mkdtempSync(join(tmpdir(), 'citefox-help-'))
    try {
      expect(loadHelpTopics(empty)).toEqual([])
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it('reads a file again when it changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'citefox-help-'))
    try {
      writeFileSync(join(dir, 'alerts.md'), '---\ntitle: Alerts\n---\nOne.')
      expect(loadHelpTopics(dir)[0]?.title).toBe('Alerts')
      writeFileSync(join(dir, 'alerts.md'), '---\ntitle: Alerts and schedules\n---\nOne more.')
      expect(loadHelpTopics(dir)[0]?.title).toBe('Alerts and schedules')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('ranking', () => {
  const topics = loadHelpTopics(FIXTURES)
  const sections = topics.flatMap((topic) => topic.sections)

  it.each([
    ['What does Right page mean?', 'glossary', 'Right page'],
    ['Why is What changed empty?', 'history', 'Why is What changed empty?'],
    ['How do I set a target page?', 'questions', 'How do I set a target page?'],
    ['Where do I put my agency logo on reports?', 'reports-branding', 'Report branding'],
    ['Where is report branding?', 'reports-branding', 'Where is report branding?'],
    ['what should i fix first', 'questions', 'What should I fix first?']
  ])('%s → %s', (question, topicId, heading) => {
    const best = rankSections(question, sections)[0]
    expect(best?.section.topicId).toBe(topicId)
    expect(best?.section.heading).toBe(heading)
  })

  it('finds nothing for words no section has', () => {
    expect(rankSections('zebra quantum', sections)).toEqual([])
    expect(rankSections('the and of', sections)).toEqual([])
  })

  it('prefers the screen’s own topic on a tie', () => {
    const hits = findHelp('cited', { screen: 'questions', topics })
    expect(hits[0]?.section.topicId).toBeDefined()
    const plain = rankSections('page', sections)
    const preferred = rankSections('page', sections, { preferTopic: 'questions' })
    expect(preferred[0]?.section.topicId).toBe('questions')
    expect(plain.length).toBe(preferred.length)
  })
})

describe('retrieval for an answer', () => {
  const topics = loadHelpTopics(FIXTURES)

  it('numbers hits, writes prompt text and maps cited refs back to topics', () => {
    const hits = findHelp('Why is What changed empty?', { screen: 'overview', topics })
    expect(hits[0]).toMatchObject({ ref: 'H1', section: { topicId: 'history' } })
    expect(hits[0]?.score).toBeGreaterThanOrEqual(STRONG_HELP_SCORE)
    const text = helpPromptText(hits)
    expect(text).toContain('H1 · Check history › Why is What changed empty? (topic id history)')
    expect(text).toContain('only one check there is nothing to compare')
    expect(helpLinksFor(hits, ['N3', 'H1', 'H1'], false)).toEqual([
      { id: 'history', title: 'Check history' }
    ])
    expect(helpLinksFor(hits, [], false)).toEqual([])
    expect(helpLinksFor(hits, [], true)).toEqual([{ id: 'history', title: 'Check history' }])
    expect(helpPromptText([])).toBe('none')
  })

  it('offers the topic’s screen as the next step, unless the user is on it', () => {
    const hits = findHelp('How do I set a target page?', { screen: 'overview', topics })
    const links = helpLinksFor(hits, ['H1'], false)
    expect(nextStepFor(links, hits, 'overview')).toEqual({
      section: 'questions',
      label: 'Open Questions'
    })
    expect(nextStepFor(links, hits, 'questions')).toBeNull()
    expect(nextStepFor([], hits, 'overview')).toBeNull()
  })

  it('tells how / why / where questions from data questions', () => {
    for (const question of [
      'How do I set a target page?',
      'Why is What changed empty?',
      'What should I fix first?',
      'Where is report branding?',
      'What does Right page mean?'
    ]) {
      expect(isHowQuestion(question)).toBe(true)
    }
    for (const question of ['Summarise this for my client', 'List questions not cited']) {
      expect(isHowQuestion(question)).toBe(false)
    }
  })
})

describe('check facts', () => {
  const day = (iso: string | null): string => (iso === null ? 'unknown' : iso.slice(0, 10))

  it('says that one check means What changed waits, and when the next one is', () => {
    const text = checkFactsText(
      {
        checks: 1,
        firstCheckAt: '2026-11-01T10:00:00Z',
        latestCheckAt: '2026-11-01T10:00:00Z',
        nextCheckAt: '2026-11-08T10:00:00Z',
        paused: false,
        intervalDays: 7,
        fixes: 0
      },
      day
    )
    expect(text).toContain('Checks finished: 1')
    expect(text).toContain('What changed')
    expect(text).toContain('Next scheduled check: 2026-11-08.')
    expect(text).toContain('Fixes logged: 0.')
  })

  it('says when no check has finished and when checks are paused', () => {
    const text = checkFactsText(
      {
        checks: 0,
        firstCheckAt: null,
        latestCheckAt: null,
        nextCheckAt: null,
        paused: true,
        intervalDays: 7,
        fixes: 0
      },
      day
    )
    expect(text).toContain('no check has finished yet')
    expect(text).toContain('paused')
    expect(text).not.toContain('repeat')
  })
})
