import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { PageBlock } from '@shared/ipc'
import { safeHtmlFileName } from '../engine/fix-loop/page-edit-html'
import { configureExportSaveDialog, resetExportSaveDialog } from '../export/ipc'
import { cleanupHarness, harness } from '../handlers/test-harness'
import type { ClaudeCompletionRequest, ClaudeProvider } from '../providers/claude/claude-code'
import { createProjectDatabase } from '../storage/project-files'
import { writeProjectProfile } from '../storage/project-profile'
import { insertProject } from '../storage/records'
import { projectDatabaseRelativePath } from '../storage/slug'
import { topicFixtureReply } from './fixture-replies'
import { PAGE_NOT_READ, pageEditProblem, toChanges } from './page-edit'

afterEach(() => {
  cleanupHarness()
  resetExportSaveDialog()
})

const PROJECT = 'proj-textbolt'
const URL = 'https://textbolt.com/blog/att-email-to-text-alternative'
const PAGE = [
  '# AT&T email to text alternative',
  '',
  'Many teams used carrier gateways to send texts from email.',
  '',
  '## What to use instead',
  '- An email-to-SMS service'
].join('\n')

const BLOCKS: PageBlock[] = [
  { id: 'b1', kind: 'h1', text: 'Title' },
  { id: 'b2', kind: 'p', text: 'Intro.' }
]

type Change = Parameters<typeof pageEditProblem>[0]['changes'][number]
const reply = (changes: Change[]): Parameters<typeof pageEditProblem>[0] => ({
  summary: 'Answers first.',
  changes
})

describe('page edit checks', () => {
  test('a reply on real blocks passes', () => {
    expect(
      pageEditProblem(
        reply([
          { op: 'insert', block: null, kind: 'p', text: 'Top.', why: 'Answers first.' },
          { op: 'replace', block: 'b2', kind: 'p', text: 'New.', why: 'Clearer.' }
        ]),
        BLOCKS,
        ['TextBolt']
      )
    ).toBeNull()
  })

  test('unknown ids, missing text, a deleted H1, a block changed twice and a brand question fail', () => {
    const check = (changes: Change[]): string | null =>
      pageEditProblem(reply(changes), BLOCKS, ['TextBolt'])
    expect(check([{ op: 'delete', block: 'b9', kind: 'p', text: null, why: 'x' }])).toMatch(/b9/)
    expect(check([{ op: 'insert', block: 'b7', kind: 'p', text: 'x', why: 'Top' }])).toMatch(/b7/)
    expect(check([{ op: 'replace', block: 'b2', kind: 'p', text: ' ', why: 'x' }])).toMatch(
      /needs its text/
    )
    expect(check([{ op: 'delete', block: 'b1', kind: 'h1', text: null, why: 'x' }])).toMatch(
      /Never delete the H1/
    )
    expect(
      check([
        { op: 'replace', block: 'b2', kind: 'p', text: 'a', why: 'x' },
        { op: 'delete', block: 'b2', kind: 'p', text: null, why: 'y' }
      ])
    ).toMatch(/at most once/)
    expect(
      check([{ op: 'insert', block: 'b2', kind: 'h3', text: 'Does TextBolt work?', why: 'FAQ' }])
    ).toMatch(/TextBolt/)
  })

  test('changes get c ids in reply order, deletes lose their text', () => {
    expect(
      toChanges(
        reply([
          { op: 'delete', block: 'b2', kind: 'p', text: 'ignored', why: ' Cut. ' },
          { op: 'insert', block: null, kind: 'h2', text: ' Steps ', why: 'Steps.' }
        ])
      )
    ).toEqual([
      { id: 'c1', op: 'delete', block: 'b2', why: 'Cut.' },
      { id: 'c2', op: 'insert', after: null, kind: 'h2', text: 'Steps', why: 'Steps.' }
    ])
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

function seeded(page: string | null): {
  handlers: ReturnType<typeof harness>['handlers']
  prompts: string[]
  reads: string[]
} {
  const prompts: string[] = []
  const reads: string[] = []
  const h = harness({
    claude: fakeClaude(prompts),
    readWebsitePage: async (url) => {
      reads.push(url)
      return page === null ? null : { title: 'AT&T email to text alternative', text: page }
    }
  })
  insertProject(h.storage.db, {
    id: PROJECT,
    name: 'TextBolt',
    slug: 'textbolt',
    domain: 'textbolt.com',
    dbPath: projectDatabaseRelativePath('textbolt'),
    clientName: null,
    status: 'active'
  })
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
  db.close()
  return { handlers: h.handlers, prompts, reads }
}

const REQUEST = {
  projectId: PROJECT,
  fixId: 'pf-att',
  pageId: null,
  url: URL,
  searches: ['What can I use instead of the AT&T email-to-text gateway?'],
  topicId: null
}

describe('fixes:draftPageEdit and fixes:pageEdit', () => {
  test('reads the page live when it was never read, writes the edits and saves them', async () => {
    const { handlers, prompts, reads } = seeded(PAGE)
    expect(await handlers['fixes:pageEdit']({ projectId: PROJECT, fixId: 'pf-att' })).toBeNull()

    const result = await handlers['fixes:draftPageEdit'](REQUEST)

    expect(reads).toEqual([URL])
    expect(result.blocks.map((block) => block.kind)).toEqual(['h1', 'p', 'h2', 'li'])
    expect(result.changes.map((change) => [change.id, change.op])).toEqual([
      ['c1', 'insert'],
      ['c2', 'insert'],
      ['c3', 'replace']
    ])
    expect(result.note).toMatch(/^CiteFox AI · about \d+ s · no searches$/)
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('Template: topic_page_edit.md')
    expect(prompts[0]).toContain('b3 [h2] What to use instead')
    expect(prompts[0]).toContain('1. What can I use instead of the AT&T email-to-text gateway?')
    expect(await handlers['fixes:pageEdit']({ projectId: PROJECT, fixId: 'pf-att' })).toEqual(
      result
    )

    // A second draft reuses the saved read instead of reading the page again.
    await handlers['fixes:draftPageEdit'](REQUEST)
    expect(reads).toEqual([URL])
  })

  test('a page that cannot be read says so in plain words, with no AI call', async () => {
    const { handlers, prompts } = seeded(null)
    await expect(handlers['fixes:draftPageEdit'](REQUEST)).rejects.toThrow(PAGE_NOT_READ)
    expect(prompts).toEqual([])
  })

  test('refuses a request with an unknown key or a non-web address', async () => {
    const { handlers } = seeded(PAGE)
    const extra = { ...REQUEST, extra: 1 } as typeof REQUEST
    await expect(handlers['fixes:draftPageEdit'](extra)).rejects.toThrow()
    await expect(
      handlers['fixes:draftPageEdit']({ ...REQUEST, url: 'file:///etc/hosts' })
    ).rejects.toThrow()
  })
})

describe('fixes:savePageEditHtml', () => {
  test('saves the HTML where the dialog points, or nothing when cancelled', async () => {
    const { handlers } = seeded(PAGE)
    const folder = mkdtempSync(join(tmpdir(), 'citefox-page-edit-'))
    try {
      const asked: string[] = []
      configureExportSaveDialog(async (options) => {
        asked.push(`${options.title}|${options.defaultPath}`)
        return { canceled: false, filePath: join(folder, 'edits.html') }
      })
      const saved = await handlers['fixes:savePageEditHtml']({
        projectId: PROJECT,
        fileName: 'att/email:edits',
        html: '<p>Hello</p>',
        format: 'html'
      })
      expect(saved).toEqual({ saved: true })
      expect(asked).toEqual(['Save the page edits|att-email-edits.html'])
      expect(readFileSync(join(folder, 'edits.html'), 'utf8')).toBe('<p>Hello</p>')

      configureExportSaveDialog(async () => ({ canceled: true }))
      expect(
        await handlers['fixes:savePageEditHtml']({
          projectId: PROJECT,
          fileName: 'edits.html',
          html: '<p>Hi</p>',
          format: 'html'
        })
      ).toEqual({ saved: false })

      // Markdown: a .md name and a Markdown filter.
      configureExportSaveDialog(async (options) => {
        asked.push(`${options.defaultPath}|${options.filters?.[0]?.name}`)
        return { canceled: false, filePath: join(folder, 'edits.md') }
      })
      await handlers['fixes:savePageEditHtml']({
        projectId: PROJECT,
        fileName: 'att-edits.md',
        html: '# Hi',
        format: 'md'
      })
      expect(asked.at(-1)).toBe('att-edits.md|Markdown')
      expect(readFileSync(join(folder, 'edits.md'), 'utf8')).toBe('# Hi')
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  test('file names lose folders and reserved characters and end in .html', () => {
    expect(safeHtmlFileName('../a?b.HTML')).toBe('a-b.html')
    expect(safeHtmlFileName('...')).toBe('page-edits.html')
    expect(safeHtmlFileName('a.html', 'md')).toBe('a.md')
  })
})
