import { afterEach, describe, expect, test } from 'vitest'
import type { PageBlock } from '@shared/ipc'
import { cleanupHarness, harness } from '../handlers/test-harness'
import type { ClaudeCompletionRequest, ClaudeProvider } from '../providers/claude/claude-code'
import { createProjectDatabase } from '../storage/project-files'
import { writeProjectProfile } from '../storage/project-profile'
import { insertProject, type ProjectRecord } from '../storage/records'
import { projectDatabaseRelativePath } from '../storage/slug'
import { topicFixtureReply } from './fixture-replies'
import { seedTextboltTopic } from './fixture-seed'
import { headingsOf, ownerWhyProblem, pageForPrompt, type OwnerWhyReply } from './owner-why'

afterEach(() => {
  cleanupHarness()
})

const PROJECT: ProjectRecord = {
  id: 'proj-textbolt',
  name: 'TextBolt',
  slug: 'textbolt',
  domain: 'textbolt.com',
  dbPath: projectDatabaseRelativePath('textbolt'),
  clientName: null,
  status: 'active'
}
const TARGET = 'https://textbolt.com/blog/att-email-to-text-alternative'
const CITED = 'https://textbolt.com/compare/'
const PAGES: Record<string, string> = {
  [TARGET]: [
    '# AT&T email to text alternative',
    '',
    'Many teams used carrier gateways to send texts from email.',
    '',
    '## What to use instead',
    '- An email-to-SMS service'
  ].join('\n'),
  [CITED]: [
    '# Compare email-to-SMS services',
    '',
    'A side-by-side table of the options.',
    '',
    '## Price per message',
    'Plans start at [check].'
  ].join('\n')
}

const BLOCKS: PageBlock[] = [
  { id: 'b1', kind: 'h1', text: 'Compare email-to-SMS services' },
  { id: 'b2', kind: 'p', text: 'Intro.' },
  { id: 'b3', kind: 'h2', text: 'Price per message' },
  { id: 'b4', kind: 'li', text: 'Plan A' }
]

const REPLY: OwnerWhyReply = {
  verdict: 'target',
  reason: 'The compare page lines the options up.',
  answerNeeds: ['Name the options', 'Compare cost', 'Say who each suits'],
  citedHas: [{ section: 'Price per message', point: 'Prices side by side.' }],
  toChange: [{ section: 'What to use instead', change: 'Add a comparison.', why: 'Answers it.' }],
  risk: null
}

describe('owner why checks', () => {
  test('a page reads with its headings marked, and its headings list', () => {
    expect(pageForPrompt(BLOCKS)).toBe(
      '# Compare email-to-SMS services\nIntro.\n## Price per message\n- Plan A'
    )
    expect(headingsOf(BLOCKS)).toEqual(['Compare email-to-SMS services', 'Price per message'])
  })

  test('sections must be headings of their page; new sections and the opening pass', () => {
    const pages = {
      target: ['AT&T email to text alternative', 'What to use instead'],
      cited: ['Compare email-to-SMS services', 'Price per message']
    }
    expect(ownerWhyProblem(REPLY, pages)).toBeNull()
    expect(
      ownerWhyProblem(
        {
          ...REPLY,
          citedHas: [{ section: 'opening', point: 'x' }],
          toChange: [{ section: 'New section after What to use instead', change: 'x', why: 'y' }]
        },
        pages
      )
    ).toBeNull()
    expect(
      ownerWhyProblem({ ...REPLY, citedHas: [{ section: 'Reviews', point: 'x' }] }, pages)
    ).toMatch(/"Reviews" is not a heading of the cited page/)
    // With the verdict "cited", the changes are about the cited page.
    expect(ownerWhyProblem({ ...REPLY, verdict: 'cited' }, pages)).toMatch(
      /not a heading of the cited page/
    )
    expect(
      ownerWhyProblem(
        {
          ...REPLY,
          toChange: [{ section: 'Opening', change: 'Add a 301 redirect to /compare/', why: 'y' }]
        },
        pages
      )
    ).toMatch(/changes an address/)
  })
})

/** A fake CiteFox AI that records each prompt and answers with the fixture reply. */
function fakeClaude(prompts: string[]): ClaudeProvider {
  return {
    id: 'claude-code',
    async complete(request: ClaudeCompletionRequest) {
      prompts.push(request.prompt)
      const json = topicFixtureReply(request.prompt)
      return {
        provider: 'claude-code',
        text: JSON.stringify(json),
        json,
        inputTokens: 10,
        outputTokens: 10,
        durationMs: 5,
        model: 'claude-sonnet-5-5',
        resolvedModel: 'claude-sonnet-5-5',
        usage: {
          inputTokens: 10,
          outputTokens: 10,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0
        }
      } as Awaited<ReturnType<ClaudeProvider['complete']>>
    }
  }
}

/** The project with the TextBolt topic checks, and one stored search that has an overview. */
function seeded(readable: boolean): {
  handlers: ReturnType<typeof harness>['handlers']
  prompts: string[]
  reads: string[]
  search: { promptId: string; runId: string; text: string }
} {
  const prompts: string[] = []
  const reads: string[] = []
  const h = harness({
    claude: fakeClaude(prompts),
    readWebsitePage: async (url) => {
      reads.push(url)
      const text = PAGES[url]
      return readable && text !== undefined ? { title: url, text } : null
    }
  })
  insertProject(h.storage.db, PROJECT)
  const db = createProjectDatabase(h.storage.paths.projectsDirectory, 'textbolt')
  writeProjectProfile(db, {
    includeSubdomains: false,
    brandNames: ['TextBolt'],
    competitors: [],
    market: {
      id: 'mkt-us',
      country: 'US',
      language: 'en',
      location: null,
      device: 'desktop',
      localWording: false,
      serpapiLocation: null
    }
  })
  seedTextboltTopic(db, PROJECT, { now: () => new Date('2026-10-19T12:00:00.000Z') })
  const row = db
    .prepare<[], { promptId: string; runId: string }>(
      `SELECT s.prompt_id AS promptId, s.run_id AS runId
         FROM serp_results s
        WHERE s.aio_text IS NOT NULL
          AND EXISTS (SELECT 1 FROM aio_references r WHERE r.serp_result_id = s.id)
        ORDER BY s.run_id DESC, s.prompt_id LIMIT 1`
    )
    .get()
  db.close()
  if (row === undefined) throw new Error('the seed has no stored overview')
  return { handlers: h.handlers, prompts, reads, search: { ...row, text: 'email to sms gateway' } }
}

describe('fixes:draftOwnerWhy and fixes:ownerWhy', () => {
  test('reads both pages and the saved overview, writes the comparison and saves it', async () => {
    const { handlers, prompts, reads, search } = seeded(true)
    const request = {
      projectId: PROJECT.id,
      fixId: 'pf-owner',
      target: { pageId: null, url: TARGET },
      citedUrl: CITED,
      searches: [
        search,
        { promptId: 'p-none', runId: null, text: 'email to sms gateway comparison' }
      ]
    }
    expect(
      await handlers['fixes:ownerWhy']({ projectId: PROJECT.id, fixId: 'pf-owner' })
    ).toBeNull()

    const result = await handlers['fixes:draftOwnerWhy'](request)

    expect(reads).toEqual([TARGET, CITED])
    expect(result.verdict).toBe('target')
    expect(result.ownerUrl).toBe(TARGET)
    expect(result.answerNeeds.length).toBeGreaterThanOrEqual(3)
    expect(result.toChange[0]?.section).toBe('Opening')
    expect(result.overviews).toBe(1)
    expect(result.note).toMatch(/^CiteFox AI · about \d+ s · no searches$/)
    expect(prompts).toHaveLength(1)
    const prompt = prompts[0] ?? ''
    expect(prompt).toContain('Template: topic_owner_why.md')
    expect(prompt).toContain('## What to use instead')
    expect(prompt).toContain('## Price per message')
    expect(prompt).toContain(`Search: ${search.text}`)
    expect(prompt).toContain('<overview>')
    expect(prompt).toContain('2. email to sms gateway comparison')
    expect(await handlers['fixes:ownerWhy']({ projectId: PROJECT.id, fixId: 'pf-owner' })).toEqual(
      result
    )
  })

  test('a page that cannot be read is named, with no AI call', async () => {
    const { handlers, prompts } = seeded(false)
    await expect(
      handlers['fixes:draftOwnerWhy']({
        projectId: PROJECT.id,
        fixId: 'pf-owner',
        target: { pageId: null, url: TARGET },
        citedUrl: CITED,
        searches: []
      })
    ).rejects.toThrow(/Couldn't read \/blog\/att-email-to-text-alternative/)
    expect(prompts).toEqual([])
  })

  test('refuses an unknown key or a non-web address', async () => {
    const { handlers } = seeded(true)
    const base = {
      projectId: PROJECT.id,
      fixId: 'pf-owner',
      target: { pageId: null, url: TARGET },
      citedUrl: CITED,
      searches: []
    }
    await expect(
      handlers['fixes:draftOwnerWhy']({ ...base, extra: 1 } as typeof base)
    ).rejects.toThrow()
    await expect(
      handlers['fixes:draftOwnerWhy']({ ...base, citedUrl: 'file:///etc/hosts' })
    ).rejects.toThrow()
  })
})

describe('fixes:draftPageEdit with a comparison', () => {
  test('the comparison reaches the page-edit prompt as advice', async () => {
    const { handlers, prompts } = seeded(true)
    await handlers['fixes:draftPageEdit']({
      projectId: PROJECT.id,
      fixId: 'pf-owner',
      pageId: null,
      url: TARGET,
      searches: ['email to sms gateway comparison'],
      topicId: null,
      context: 'What to change on this page:\n- Opening: compare the options'
    })
    expect(prompts[0]).toContain('- Opening: compare the options')
    await handlers['fixes:draftPageEdit']({
      projectId: PROJECT.id,
      fixId: 'pf-owner',
      pageId: null,
      url: TARGET,
      searches: ['email to sms gateway comparison'],
      topicId: null
    })
    expect(prompts[1]).toContain(
      'instead found this page needs (advice for choosing the changes, not page text):\nNone.'
    )
    await expect(
      handlers['fixes:draftPageEdit']({
        projectId: PROJECT.id,
        fixId: 'pf-owner',
        pageId: null,
        url: TARGET,
        searches: [],
        topicId: null,
        context: ' '
      })
    ).rejects.toThrow()
  })
})
