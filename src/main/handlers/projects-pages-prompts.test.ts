import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { HttpTransport } from '../providers/http'
import { createLogger } from '../logging/logger'
import { MemorySecretStore, SecretRegistry } from '../secrets/secret-store'
import { openAppStorage, type AppStorage } from '../storage/app-storage'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { getTemplate } from '../storage/records'
import { createIpcHandlers, type IpcHandlerDeps } from './index'
import { TEXTBOLT_PROFILE, TEXTBOLT_URL, textboltJinaBody } from '../pipeline/textbolt-fixture'
import { route, scriptedClaude } from './projects-pages-prompts.test-helper'
import type { FillFromWebsiteProgress, PageReadProgress } from '@shared/ipc'

const directories: string[] = []
const closers: (() => void)[] = []
const ORIGINAL_FETCH = globalThis.fetch

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  for (const close of closers.splice(0)) close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('M2 IPC handlers', () => {
  test('rejects an invalid project payload and creates, updates, and switches a project', async () => {
    const { handlers } = harness()
    await expect(
      (handlers['projects:create'] as (value: unknown) => Promise<unknown>)({ name: 'TextBolt' })
    ).rejects.toThrow('projects:create: Invalid request')
    const created = await handlers['projects:create'](projectBody())
    expect(created.domain).toBe('textbolt.com')
    expect(created.brandNames).toEqual(['TextBolt', 'Text Bolt'])
    expect(created.defaultMarket?.country).toBe('US')
    expect(created.foundPageCount).toBe(0)
    expect(created.trackedPageCount).toBe(0)
    const listed = await handlers['projects:list']()
    expect(listed.activeProjectId).toBe(created.id)
    expect(listed.projects).toHaveLength(1)

    const updated = await handlers['projects:update']({
      projectId: created.id,
      clientName: 'Northwind',
      status: 'paused',
      country: 'GB'
    })
    expect(updated.clientName).toBe('Northwind')
    expect(updated.status).toBe('paused')
    expect(updated.defaultMarket?.country).toBe('GB')
    expect(updated.defaultMarket?.id).toBe(created.defaultMarket?.id)

    const second = await handlers['projects:create']({
      ...projectBody(),
      name: 'Other',
      domain: 'other.example'
    })
    expect((await handlers['projects:list']()).activeProjectId).toBe(second.id)
    const switched = await handlers['projects:switch']({ projectId: created.id })
    expect(switched.id).toBe(created.id)
    expect((await handlers['projects:list']()).activeProjectId).toBe(created.id)
    await expect(handlers['projects:get']({ projectId: 'missing-project' })).rejects.toThrow(
      /That project was not found/
    )
  })

  test('adds, lists, updates, pins, searches, and removes pages', async () => {
    const { handlers } = harness()
    const project = await handlers['projects:create'](projectBody())
    await expect(
      handlers['pages:add']({ ...pageBody(project.id), promptCount: 1001 })
    ).rejects.toThrow('pages:add: The maximum prompt count is 1000.')
    await expect(
      handlers['pages:add']({ ...pageBody(project.id), url: 'http://127.0.0.1/local' })
    ).rejects.toThrow(/private or local address/)
    await expect(
      (handlers['pages:get'] as (value: unknown) => Promise<unknown>)({ projectId: project.id })
    ).rejects.toThrow('pages:get: Invalid request')

    const page = await handlers['pages:add'](pageBody(project.id))
    expect(page.folder).toBe('blog')
    expect(page.status).toBe('setting_up')
    expect(page.markets).toHaveLength(1)
    expect(page.snapshotId).toBeNull()
    const listed = await handlers['pages:list']({ projectId: project.id })
    expect(listed.foundPageCount).toBe(1)
    expect(listed.pages).toHaveLength(1)

    const spanish = await handlers['pages:add']({
      ...pageBody(project.id),
      url: 'https://textbolt.com/pricing',
      markets: [
        { country: 'ES', language: 'es', location: null, device: 'desktop', localWording: false }
      ]
    })
    const pinnedSecond = await handlers['pages:pin']({ projectId: project.id, pageId: spanish.id })
    const pinnedFirst = await handlers['pages:pin']({ projectId: project.id, pageId: page.id })
    expect(pinnedSecond.url).toBe('https://textbolt.com/pricing')
    expect(pinnedFirst.markets).toHaveLength(1)
    const pins = await handlers['pages:pinned']({ projectId: project.id })
    expect(pins.pages.map((item) => item.id)).toEqual([spanish.id, page.id])

    const renamed = await handlers['pages:update']({
      projectId: project.id,
      pageId: page.id,
      label: 'Alerts',
      status: 'tracked'
    })
    expect(renamed.label).toBe('Alerts')
    expect(renamed.status).toBe('tracked')

    const blank = await handlers['pages:search']({ projectId: project.id, query: '   ' })
    expect(blank).toEqual({ foundPageCount: 2, pages: [] })
    const found = await handlers['pages:search']({ projectId: project.id, query: 'ALERTS' })
    expect(found.pages.map((item) => item.id)).toEqual([page.id])

    const removed = await handlers['pages:remove']({ projectId: project.id, pageId: page.id })
    expect(removed).toEqual({ id: page.id, status: 'removed' })
    expect((await handlers['pages:get']({ projectId: project.id, pageId: page.id })).pinned).toBe(
      false
    )
    expect(
      (await handlers['pages:pinned']({ projectId: project.id })).pages.map((item) => item.id)
    ).toEqual([spanish.id])
    const after = await handlers['pages:list']({ projectId: project.id })
    expect(after.pages.map((item) => item.id)).toEqual([spanish.id])
    expect(after.foundPageCount).toBe(2)
    const searched = await handlers['pages:search']({ projectId: project.id, query: TEXTBOLT_URL })
    expect(searched.pages.map((item) => item.id)).toEqual([page.id])
    await expect(handlers['pages:pin']({ projectId: project.id, pageId: page.id })).rejects.toThrow(
      /cannot be pinned/
    )
    const unpinned = await handlers['pages:unpin']({ projectId: project.id, pageId: spanish.id })
    expect(unpinned.pinned).toBe(false)
  })

  test('resolves a failed direct read and stores a Jina read', async () => {
    const failed = harness({
      http: {
        async request() {
          return { status: 500, body: 'nope' }
        }
      },
      pageDns: {
        async lookup() {
          return ['1.1.1.1']
        }
      }
    })
    const project = await failed.handlers['projects:create'](projectBody())
    const page = await failed.handlers['pages:add'](pageBody(project.id))
    await expect(
      failed.handlers['pages:readStart']({
        projectId: project.id,
        pageId: 'missing-page',
        reader: 'direct',
        suppliedText: null
      })
    ).rejects.toThrow(/That page was not found/)
    const result = await failed.handlers['pages:readStart']({
      projectId: project.id,
      pageId: page.id,
      reader: 'direct',
      suppliedText: null
    })
    expect(result.nextStep).toMatch(/Jina Reader/)
    expect(result.message).toMatch(/direct fetch/)
    expect(result.httpStatus).toBeNull()
    expect(result.id).toBeNull()
    expect(result.contentHash).toBeNull()
    expect(result.method).toBe('direct')
    expect(result.snapshotReused).toBe(false)
    expect(
      failed.progress.some((event) => event.state === 'warning' && event.phase === 'fetch')
    ).toBe(true)
    expect(
      await failed.handlers['pages:getRead']({ projectId: project.id, pageId: page.id })
    ).toBeNull()
    expect(snapshotCount(failed.storage, project.slug, page.id)).toBe(0)

    const { handlers, progress } = harness({ http: jinaHttp() })
    const live = await handlers['projects:create'](projectBody())
    const livePage = await handlers['pages:add'](pageBody(live.id))
    const read = await handlers['pages:readStart']({
      projectId: live.id,
      pageId: livePage.id,
      reader: 'jina',
      suppliedText: null
    })
    expect(read.method).toBe('jina')
    expect(read.snapshotReused).toBe(false)
    expect(read.nextStep).toBeNull()
    expect(read.title).toContain('Text Alerts')
    expect(progress.map((event) => `${event.phase}:${event.state}`)).toEqual([
      'fetch:running',
      'fetch:ok',
      'extract:running',
      'extract:ok',
      'summary:running',
      'summary:ok'
    ])
    const again = await handlers['pages:getRead']({ projectId: live.id, pageId: livePage.id })
    expect(again?.id).toBe(read.id)
    expect(again?.snapshotReused).toBe(false)
    const reread = await handlers['pages:readStart']({
      projectId: live.id,
      pageId: livePage.id,
      reader: 'jina',
      suppliedText: null
    })
    expect(reread.snapshotReused).toBe(true)
    expect(reread.id).toBe(read.id)
    const fileRead = await handlers['pages:readStart']({
      projectId: live.id,
      pageId: livePage.id,
      reader: 'file',
      suppliedText: '# Filed title\n\nA page saved from disk.'
    })
    expect(fileRead.method).toBe('file')
    expect(fileRead.snapshotReused).toBe(false)
    expect(fileRead.title).toBe('Filed title')
  })

  test('pages:readStart fetches Jina on every call, including Read again', async () => {
    const calls: Array<{ url: string; cacheControl?: string; noCache?: string }> = []
    const same = textboltJinaBody()
    const changed = same.replace(
      'At 4 PM on a Friday',
      'At 9 PM on a Sunday the crew roster changed'
    )
    expect(changed).not.toBe(same)
    const { handlers } = harness({
      http: {
        async request(request) {
          calls.push({
            url: request.url,
            cacheControl: request.headers?.['cache-control'],
            noCache: request.headers?.['x-no-cache']
          })
          if (!request.url.startsWith('https://r.jina.ai/')) return { status: 500, body: '' }
          const jinaReads = calls.filter((call) => call.url.startsWith('https://r.jina.ai/')).length
          return { status: 200, body: jinaReads < 3 ? same : changed }
        }
      }
    })
    const project = await handlers['projects:create'](projectBody())
    const page = await handlers['pages:add'](pageBody(project.id))
    const read = async (): Promise<Awaited<ReturnType<(typeof handlers)['pages:readStart']>>> =>
      handlers['pages:readStart']({
        projectId: project.id,
        pageId: page.id,
        reader: 'jina',
        suppliedText: null
      })

    const first = await read()
    const again = await read()
    const updated = await read()
    const jina = calls.filter((call) => call.url.startsWith(`https://r.jina.ai/${TEXTBOLT_URL}`))

    expect(jina).toHaveLength(3)
    expect(jina.every((call) => call.noCache === 'true')).toBe(true)
    expect(jina.every((call) => call.cacheControl === 'no-cache')).toBe(true)
    expect(first.method).toBe('jina')
    expect(first.snapshotReused).toBe(false)
    expect(again.method).toBe('jina')
    expect(again.id).toBe(first.id)
    expect(again.contentHash).toBe(first.contentHash)
    expect(updated.snapshotReused).toBe(false)
    expect(updated.id).not.toBe(first.id)
    expect(updated.contentHash).not.toBe(first.contentHash)
    expect(updated.wordCount).not.toBe(first.wordCount)
  })

  test('a failed read stores no snapshot and returns null id and content hash', async () => {
    const failed = harness({
      http: {
        async request() {
          return { status: 500, body: 'nope' }
        }
      },
      pageDns: {
        async lookup() {
          return ['1.1.1.1']
        }
      }
    })
    const project = await failed.handlers['projects:create'](projectBody())
    const page = await failed.handlers['pages:add'](pageBody(project.id))
    const result = await failed.handlers['pages:readStart']({
      projectId: project.id,
      pageId: page.id,
      reader: 'direct',
      suppliedText: null
    })
    expect(result.id).toBeNull()
    expect(result.contentHash).toBeNull()
    expect(
      await failed.handlers['pages:getRead']({ projectId: project.id, pageId: page.id })
    ).toBeNull()
    expect(snapshotCount(failed.storage, project.slug, page.id)).toBe(0)
  })

  test('lists prompt sets newest first and switches the active set without a new version', async () => {
    const claude = scriptedClaude((prompt) => route(prompt))
    const { handlers } = harness({ http: jinaHttp(), claude })
    const project = await handlers['projects:create'](projectBody())
    const page = await handlers['pages:add']({ ...pageBody(project.id), promptCount: 10 })
    expect(await handlers['prompts:listSets']({ projectId: project.id, pageId: page.id })).toEqual({
      pageId: page.id,
      sets: []
    })
    await handlers['pages:readStart']({
      projectId: project.id,
      pageId: page.id,
      reader: 'jina',
      suppliedText: null
    })
    await handlers['buyerProfile:generate']({ projectId: project.id, pageId: page.id })
    const first = await handlers['prompts:generate']({ projectId: project.id, pageId: page.id })
    const listed = await handlers['prompts:list']({ projectId: project.id, pageId: page.id })
    expect(listed.promptSetId).toBe(first.promptSetId)
    expect(listed.version).toBe(1)
    expect(listed.dirty).toBe(false)
    const history = await handlers['prompts:listSets']({ projectId: project.id, pageId: page.id })
    expect(history.sets).toEqual([
      {
        id: first.promptSetId,
        createdAt: first.savedAt,
        templateId: 'tpl-buyer-prompts',
        templateName: 'CiteFox default',
        promptCount: 10,
        isActive: true
      }
    ])

    const added = await handlers['prompts:add']({
      projectId: project.id,
      pageId: page.id,
      label: 'Blank',
      text: 'How does a crew hear about a Saturday change?',
      source: 'written_by_user',
      intentStage: 'unset',
      mappedElement: 'New line'
    })
    const saved = await handlers['prompts:save']({ projectId: project.id, pageId: page.id })
    expect(saved.version).toBe(2)
    expect(saved.dirty).toBe(false)
    expect(saved.prompts).toHaveLength(added.prompts.length)
    const sets = await handlers['prompts:listSets']({ projectId: project.id, pageId: page.id })
    expect(sets.sets.map((set) => set.isActive)).toEqual([true, false])
    expect(sets.sets[0]).toMatchObject({
      id: saved.promptSetId,
      createdAt: saved.savedAt,
      promptCount: 11,
      isActive: true
    })
    const newest = sets.sets[0]
    const previous = sets.sets[1]
    if (newest === undefined || previous === undefined) throw new Error('missing set')
    expect(previous.id).toBe(first.promptSetId)
    expect(newest.createdAt > previous.createdAt).toBe(true)
    expect(sets.sets.filter((set) => set.isActive)).toHaveLength(1)
    expect(
      (await handlers['prompts:list']({ projectId: project.id, pageId: page.id })).version
    ).toBe(2)

    const dirty = await handlers['prompts:add']({
      projectId: project.id,
      pageId: page.id,
      label: 'Draft',
      text: 'How does the crew hear before sunrise?',
      source: 'written_by_user',
      intentStage: 'unset',
      mappedElement: 'Draft line'
    })
    expect(dirty.dirty).toBe(true)
    const olderId = sets.sets[1]?.id
    if (olderId === undefined) throw new Error('missing older set')
    const switched = await handlers['prompts:setActive']({
      projectId: project.id,
      pageId: page.id,
      promptSetId: olderId
    })
    expect(switched).toMatchObject({
      promptSetId: olderId,
      version: 1,
      dirty: false
    })
    expect(switched.prompts).toHaveLength(10)
    const after = await handlers['prompts:listSets']({ projectId: project.id, pageId: page.id })
    expect(after.sets).toHaveLength(2)
    expect(after.sets.map((set) => set.id)).toEqual(sets.sets.map((set) => set.id))
    expect(after.sets.filter((set) => set.isActive).map((set) => set.id)).toEqual([olderId])
    const active = await handlers['prompts:list']({ projectId: project.id, pageId: page.id })
    expect(active).toMatchObject({ promptSetId: olderId, version: 1, dirty: false })
    expect(
      (await handlers['pages:get']({ projectId: project.id, pageId: page.id })).promptSetVersion
    ).toBe(1)
    await expect(
      handlers['prompts:setActive']({
        projectId: project.id,
        pageId: page.id,
        promptSetId: 'missing-set'
      })
    ).rejects.toThrow(/That prompt set was not found/)
    await expect(
      (handlers['prompts:setActive'] as (value: unknown) => Promise<unknown>)({
        projectId: project.id,
        pageId: page.id,
        promptSetId: olderId,
        extra: true
      })
    ).rejects.toThrow(/Invalid request/)
  })

  test('quick actions see the whole page, not the first 8,000 characters (live run: 27,000)', async () => {
    const claude = scriptedClaude((prompt) => route(prompt))
    const { handlers } = harness({ claude })
    const project = await handlers['projects:create'](projectBody())
    const page = await handlers['pages:add']({ ...pageBody(project.id), promptCount: 10 })
    const paragraph = 'Field crews get a text when the Saturday shift moves. '.repeat(10)
    const body = Array.from({ length: 50 }, (_, index) => `${paragraph}Paragraph ${index}.`)
    const text = `# Long page\n\n${body.join('\n\n')}\n\nThe last line names the 160-character limit.`
    expect(text.length).toBeGreaterThan(27_000)
    await handlers['pages:readStart']({
      projectId: project.id,
      pageId: page.id,
      reader: 'file',
      suppliedText: text
    })
    for (const assistId of ['page.promises', 'page.checkFacts', 'page.shorterTitle']) {
      await handlers['assist:run']({
        assistId,
        projectId: project.id,
        pageId: page.id,
        marketId: null,
        promptId: null,
        inputs: {},
        instruction: null
      })
    }
    const quick = claude.calls.filter((prompt) => /^Assist: page\./.test(prompt))
    expect(quick).toHaveLength(3)
    for (const prompt of quick) expect(prompt).toContain('names the 160-character limit')
    // page.promises saves what the Page read rail shows under "What the page promises".
    const read = await handlers['pages:getRead']({ projectId: project.id, pageId: page.id })
    expect(read?.summary?.promises).toEqual([
      { title: 'The title promises Saturday shift texts.', detail: 'From the title: "Line title"' },
      {
        title: 'The meta promises Saturday shift texts.',
        detail: 'From the meta description: "Line meta"'
      },
      { title: 'The h1 promises Saturday shift texts.', detail: 'Not on the page: the H1.' }
    ])
  })

  test('runs the TextBolt profile and prompt flow offline', async () => {
    globalThis.fetch = (() => {
      throw new Error('network')
    }) as typeof fetch
    const claude = scriptedClaude((prompt) => route(prompt))
    const { handlers, logs } = harness({ http: jinaHttp(), claude })
    const project = await handlers['projects:create'](projectBody())
    const page = await handlers['pages:add']({ ...pageBody(project.id), promptCount: 10 })
    const read = await handlers['pages:readStart']({
      projectId: project.id,
      pageId: page.id,
      reader: 'jina',
      suppliedText: null
    })
    expect(read.wordCount).toBeGreaterThan(0)

    expect(
      await handlers['buyerProfile:get']({ projectId: project.id, pageId: page.id })
    ).toBeNull()
    const profile = await handlers['buyerProfile:generate']({
      projectId: project.id,
      pageId: page.id
    })
    expect(profile.who).toBe(TEXTBOLT_PROFILE.who)
    expect(profile.templateId).toBe('tpl-buyer-profile')
    expect(profile.templateName).toBe('CiteFox default')
    expect(profile.templateHash).toMatch(/^[a-f0-9]{64}$/)
    expect(profile.templateUpdatedAt).toBeNull()
    const header = await handlers['pages:get']({ projectId: project.id, pageId: page.id })
    expect(header.setupStep).toBe('prompts')
    const same = await handlers['buyerProfile:generate']({ projectId: project.id, pageId: page.id })
    expect(same.id).toBe(profile.id)
    const fresh = await handlers['buyerProfile:generate']({
      projectId: project.id,
      pageId: page.id,
      fresh: true
    })
    expect(fresh.id).not.toBe(profile.id)
    const lines = await handlers['buyerProfile:update']({
      projectId: project.id,
      pageId: page.id,
      environment: 'Slack\r\nEmail'
    })
    expect(lines.environment).toBe('Slack\nEmail')
    await expect(
      handlers['buyerProfile:update']({
        projectId: project.id,
        pageId: page.id,
        environment: 'Slack\u0007'
      })
    ).rejects.toThrow('buyerProfile:update: Invalid request')
    await expect(
      handlers['buyerProfile:generate']({
        projectId: project.id,
        pageId: page.id,
        fresh: 'yes' as unknown as boolean
      })
    ).rejects.toThrow('buyerProfile:generate: Invalid request')

    const prompts = await handlers['prompts:generate']({ projectId: project.id, pageId: page.id })
    expect(prompts.prompts).toHaveLength(10)
    expect(prompts.version).toBe(1)
    expect(prompts.dirty).toBe(false)
    expect(prompts.templateId).toBe('tpl-buyer-prompts')
    expect(prompts.brandsClear).toBe(true)
    for (const prompt of prompts.prompts) {
      for (const variant of prompt.variants) {
        expect(variant.text.toLowerCase().includes('textbolt')).toBe(false)
        expect(variant.text.toLowerCase().includes('text bolt')).toBe(false)
      }
    }
    expect(
      (await handlers['pages:get']({ projectId: project.id, pageId: page.id })).setupStep
    ).toBe('check')

    const edited = await handlers['buyerProfile:update']({
      projectId: project.id,
      pageId: page.id,
      who: 'The operator who sends the Saturday alert.'
    })
    expect(edited.who).toBe('The operator who sends the Saturday alert.')
    expect(edited.templateId).toBe(profile.templateId)
    expect(edited.templateHash).toBe(profile.templateHash)
    expect(edited.promptsStale).toBe(true)

    const before = await handlers['prompts:list']({ projectId: project.id, pageId: page.id })
    const added = await handlers['prompts:add']({
      projectId: project.id,
      pageId: page.id,
      label: 'Blank',
      text: '',
      source: 'written_by_user',
      intentStage: 'unset',
      mappedElement: 'New line'
    })
    expect(added.dirty).toBe(true)
    expect(added.version).toBe(before.version)
    expect(added.nextVersion).toBe(2)
    expect(added.prompts).toHaveLength(11)
    await expect(
      handlers['prompts:save']({ projectId: project.id, pageId: page.id })
    ).rejects.toThrow(/Write every prompt before saving/)
    const marketId = added.prompts[10]?.variants[0]?.marketId
    if (marketId === undefined) throw new Error('missing variant')
    const filled = await handlers['prompts:edit']({
      projectId: project.id,
      pageId: page.id,
      promptId: added.prompts[10]?.id ?? '',
      variant: { marketId, text: 'How does a crew hear about a Saturday change?' }
    })
    expect(filled.dirty).toBe(true)
    const saved = await handlers['prompts:save']({ projectId: project.id, pageId: page.id })
    expect(saved.dirty).toBe(false)
    expect(saved.version).toBe(2)
    expect(saved.prompts).toHaveLength(11)

    const discarded = await handlers['prompts:discard']({ projectId: project.id, pageId: page.id })
    expect(discarded.dirty).toBe(false)
    expect(discarded.version).toBe(2)
    const joined = logs.join('\n')
    expect(joined).not.toContain('sk-ant-')
  })

  test('fill from a website returns suggestions and does not save them', async () => {
    const claude = scriptedClaude((prompt) => route(prompt))
    const { handlers, fill } = harness({
      claude,
      readWebsitePage: async (url) =>
        url.endsWith('/')
          ? {
              title: 'Home',
              text: 'Email to text for a small crew. Unlike Twilio (twilio.com), no developer is needed.'
            }
          : /(?:pricing|about)$/u.test(url)
            ? { title: 'Plans', text: 'Plans for small teams. About the team.' }
            : null
    })
    const project = await handlers['projects:create'](projectBody())
    const result = await handlers['projects:fillFromWebsite']({
      projectId: project.id,
      domain: 'textbolt.com'
    })
    expect(result.pagesRead.map((page) => page.ok)).toEqual([true, true, true, false])
    expect(result.brands[0]?.name).toBe('TextBolt')
    expect(result.competitors[0]?.domain).toBe('twilio.com')
    expect(result.competitors[0]?.tier).toBe('partial')
    expect(result.suggestedMarket?.country).toBe('US')
    expect(result.summary).toBe('TextBolt sells email to text for small crews.')
    expect(result.nextStep).toBeNull()
    // Three focused prompts, each with its own reply shape (batch 2 row 5).
    const sent = (id: string): string | undefined =>
      claude.calls.find((prompt) => prompt.startsWith(`Assist: ${id}`))
    const site = sent('project.fillSiteRead')
    expect(site).toContain('Reply with JSON only, in this shape:')
    expect(site).toContain('"products"')
    expect(site).toContain('"suggestedMarket"')
    expect(site).toContain('/ (home): Home')
    const switching = sent('project.fillSwitching')
    expect(switching).toContain('"switchingFrom"')
    expect(switching).toContain('"integrations"')
    expect(switching).toContain('/ (home): Home')
    const competitors = sent('project.productCompetitors')
    expect(competitors).toContain('"direct"')
    expect(competitors).toContain('"partial"')
    expect(competitors).toContain('A competitor is another company selling a product')
    // The project's default market (US · en) is used; page text is never sent with web search.
    expect(competitors).toContain('for buyers in United States (English)')
    expect(competitors).not.toContain('/ (home): Home')
    expect((await handlers['projects:get']({ projectId: project.id })).brandNames).toEqual([
      'TextBolt',
      'Text Bolt'
    ])
    expect(fill.some((event) => event.phase === 'suggest' && event.state === 'ok')).toBe(true)
    await expect(
      (handlers['projects:fillFromWebsite'] as (value: unknown) => Promise<unknown>)({
        projectId: null,
        domain: 'not a domain'
      })
    ).rejects.toThrow('projects:fillFromWebsite: Invalid request')
  })

  test('fill from a website sorts competitors, switching-from and integrations (feedback 3)', async () => {
    const claude = scriptedClaude((prompt) => {
      if (prompt.startsWith('Assist: project.fillSwitching')) {
        return {
          switchingFrom: [
            {
              name: 'AT&T',
              domain: null,
              reason: 'Its gateway shut down.',
              evidence: { path: '/', quote: 'AT&T shut down its email-to-text gateway.' }
            }
          ],
          integrations: [
            {
              name: 'WIN-911',
              domain: null,
              reason: 'Alarms go out through TextBolt.',
              evidence: { path: '/', quote: 'Send WIN-911 alarms through TextBolt.' }
            }
          ]
        }
      }
      if (prompt.startsWith('Assist: project.productCompetitors')) {
        // What the live textbolt.com run once did: carriers and an integration as competitors.
        return {
          direct: [
            { name: 'AT&T', domain: 'att.com', why: 'An alternative page.' },
            { name: 'WIN-911', domain: 'win911.com', why: 'A page about it.' },
            { name: 'Text-Em-All', domain: 'text-em-all.com', why: 'A buyer could pick it.' }
          ],
          partial: [{ name: 'SimpleTexting', domain: 'simpletexting.com', why: 'Texting.' }]
        }
      }
      return route(prompt)
    })
    const { handlers } = harness({
      claude,
      readWebsitePage: async (url) =>
        url.endsWith('/')
          ? {
              title: 'Home',
              text: 'AT&T shut down its email-to-text gateway. Send WIN-911 alarms through TextBolt.'
            }
          : /(?:pricing|about)$/u.test(url)
            ? { title: 'Plans', text: 'Plans for small teams. About the team.' }
            : null
    })
    const result = await handlers['projects:fillFromWebsite']({
      projectId: null,
      domain: 'textbolt.com'
    })
    expect(
      result.competitors.map((item) => [item.name, item.domain, item.domainSource, item.tier])
    ).toEqual([
      ['Text-Em-All', 'text-em-all.com', 'search', 'direct'],
      ['SimpleTexting', 'simpletexting.com', 'search', 'partial']
    ])
    expect(result.switchingFrom.map((item) => [item.name, item.domain])).toEqual([['AT&T', null]])
    expect(result.integrations.map((item) => [item.name, item.domain])).toEqual([['WIN-911', null]])
    expect(result.message).toBe('Suggestions are ready. Nothing was saved.')
  })

  test('fill from a website clears a competitor domain that does not resolve', async () => {
    const claude = scriptedClaude((prompt) =>
      prompt.startsWith('Assist: project.productCompetitors')
        ? {
            direct: [{ name: 'Text-Em-All', domain: 'textemall.com', why: 'Mass text alerts.' }],
            partial: []
          }
        : route(prompt)
    )
    const { handlers } = harness({
      claude,
      readWebsitePage: async () => ({
        title: 'Home',
        text: 'Compared with Text-Em-All (textemall.com), email to text for a small crew.'
      })
    })
    const result = await handlers['projects:fillFromWebsite']({
      projectId: null,
      domain: 'textbolt.com'
    })
    expect(result.competitors.map((item) => [item.name, item.domain, item.checkDomain])).toEqual([
      ['Text-Em-All', null, true]
    ])
    expect(result.switchingFrom).toEqual([])
    expect(result.integrations).toEqual([])
  })

  test('keeps template schema and version, and treats an empty compare list as omitted', async () => {
    const { handlers, storage } = harness({
      readPlaygroundPage: async (url) => ({
        url,
        title: 'Hello',
        metaDescription: '',
        h1: 'H',
        pageText: 'Body'
      }),
      completePlayground: async () => ({
        text: 'ok',
        resolvedModel: 'claude-test',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          serpapiSearches: 0
        },
        durationMs: 1
      })
    })
    const created = await handlers['templates:create']({
      kind: 'buyer_profile',
      name: 'Desk copy',
      body: 'Hello {{ url }}'
    })
    storage.db
      .prepare(`UPDATE templates SET version = 4, "schema" = ?, settings_json = ? WHERE id = ?`)
      .run('{"type":"object"}', '{"voice":"plain"}', created.id)
    const updated = await handlers['templates:update']({ id: created.id, name: '  Kept  ' })
    expect(updated.template.name).toBe('Kept')
    expect(updated.template.version).toBe(5)
    const row = getTemplate(storage.db, created.id)
    expect(row?.version).toBe(5)
    expect(row?.schema).toBe('{"type":"object"}')
    expect(row?.settingsJson).toBe('{"voice":"plain"}')
    await expect(
      handlers['templates:update']({ id: created.id, name: '   ' })
    ).rejects.toMatchObject({
      code: 'name_length',
      message: 'templates:update: A template name must be 1 to 80 characters.'
    })
    const deleted = await handlers['templates:delete']({ id: created.id })
    expect(deleted.version).toBe(5)
    expect(getTemplate(storage.db, created.id)?.version).toBe(5)
    const restored = await handlers['templates:restore']({ id: created.id })
    expect(restored.version).toBe(5)
    expect(getTemplate(storage.db, created.id)?.version).toBe(5)
    expect(getTemplate(storage.db, created.id)?.deletedAt).toBeNull()

    const runs = await handlers['playground:run']({
      url: 'https://example.com/page',
      templateIds: [],
      kind: 'buyer_prompts',
      overrides: null
    })
    expect(runs.map((run) => run.templateId)).toEqual(['tpl-buyer-prompts'])
    const one = await handlers['playground:run']({
      url: 'https://example.com/page',
      templateId: 'tpl-buyer-profile',
      templateIds: [],
      overrides: null
    })
    expect(one.map((run) => run.templateId)).toEqual(['tpl-buyer-profile'])
    await expect(
      handlers['playground:run']({
        url: 'https://example.com/page',
        templateIds: [],
        overrides: null
      })
    ).rejects.toMatchObject({ code: 'selection_required' })

    await handlers['templates:delete']({ id: created.id })
    const project = await handlers['projects:create'](projectBody())
    const page = await handlers['pages:add'](pageBody(project.id))
    await handlers['pages:readStart']({
      projectId: project.id,
      pageId: page.id,
      reader: 'file',
      suppliedText: '# Title\n\nEnough page text to summarize.'
    })
    await expect(
      handlers['buyerProfile:generate']({
        projectId: project.id,
        pageId: page.id,
        templateId: created.id
      })
    ).rejects.toMatchObject({ code: 'deleted' })
  })
})

function projectBody(): {
  name: string
  domain: string
  includeSubdomains: boolean
  brandNames: string[]
  competitors: string[]
  clientName: null
  country: string
  language: string
  location: null
  device: 'desktop'
} {
  return {
    name: 'TextBolt',
    domain: 'textbolt.com',
    includeSubdomains: true,
    brandNames: ['TextBolt', 'Text Bolt'],
    competitors: ['Twilio'],
    clientName: null,
    country: 'US',
    language: 'en',
    location: null,
    device: 'desktop'
  }
}

function pageBody(projectId: string): {
  projectId: string
  url: string
  markets: []
  intervalDays: 14
  samples: 1
  promptCount: number
} {
  return {
    projectId,
    url: TEXTBOLT_URL,
    markets: [],
    intervalDays: 14,
    samples: 1,
    promptCount: 10
  }
}

function snapshotCount(storage: AppStorage, slug: string, pageId: string): number {
  const db = openProjectDatabase(storage.paths.projectsDirectory, slug)
  try {
    const row = db
      .prepare<unknown[], { n: number }>(`SELECT COUNT(*) AS n FROM snapshots WHERE page_id = ?`)
      .get(pageId)
    return row?.n ?? 0
  } finally {
    closeProjectDatabase(db)
  }
}

function jinaHttp(): HttpTransport {
  return {
    async request(request) {
      if (request.url.startsWith('https://r.jina.ai/')) {
        return { status: 200, body: textboltJinaBody() }
      }
      return { status: 500, body: '' }
    }
  }
}

function harness(overrides: Partial<IpcHandlerDeps> = {}): {
  handlers: ReturnType<typeof createIpcHandlers>
  storage: AppStorage
  logs: string[]
  progress: PageReadProgress[]
  fill: FillFromWebsiteProgress[]
} {
  globalThis.fetch = (() => {
    throw new Error('network')
  }) as typeof fetch
  const directory = mkdtempSync(join(tmpdir(), 'citefox-m2-'))
  directories.push(directory)
  const storage = openAppStorage(directory)
  closers.push(() => storage.close())
  const registry = new SecretRegistry()
  const secrets = new MemorySecretStore(registry)
  const logs: string[] = []
  const logger = createLogger({
    write: (_level, line) => {
      logs.push(line)
    },
    secrets: () => registry.list()
  })
  const progress: PageReadProgress[] = []
  const fill: FillFromWebsiteProgress[] = []
  let clock = Date.parse('2026-10-19T12:00:00.000Z')
  let sequence = 0
  const handlers = createIpcHandlers({
    appInfo: () => ({ name: 'CiteFox', version: '9.9.9' }),
    storage,
    secrets,
    logger,
    http: {
      async request() {
        return { status: 500, body: '' }
      }
    },
    claudeCommand: {
      async run() {
        throw new Error('claude cli')
      }
    },
    claudeProbe: { exists: () => false, searchPath: () => null },
    emitCheckupProgress: () => undefined,
    emit: () => undefined,
    emitPageReadProgress: (event) => {
      progress.push(event)
    },
    emitFillProgress: (event) => {
      fill.push(event)
    },
    knownSecrets: () => ['sk-ant-api03-abcdefghij', ...registry.list()],
    now: () => {
      const current = new Date(clock)
      clock += 1000
      return current
    },
    createId: () => {
      sequence += 1
      return `id-${sequence}`
    },
    // Fake DNS for competitor checks: every name resolves except the live run's typo.
    pageDns: {
      async lookup(hostname) {
        if (hostname === 'textemall.com') throw new Error('ENOTFOUND')
        return ['93.184.216.34']
      }
    },
    ...overrides
  })
  return { handlers, storage, logs, progress, fill }
}
