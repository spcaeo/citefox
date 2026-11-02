import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { CompetitorsOverview } from '@shared/ipc'
import { parseSiteKinds, SITE_KINDS_SHAPE } from '../engine/competitors/site-kinds'
import type { ClaudeCompletion, ClaudeProvider } from '../providers/claude/claude-code'
import { emptyClaudeCliUsage } from '../providers/claude/parse'
import { openProgressSeed, PROGRESS_SEED, type ProgressSeed } from './progress.test-helper'

const opened: ProgressSeed[] = []
const directories: string[] = []

afterEach(() => {
  for (const seed of opened.splice(0)) seed.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const base = { projectId: PROGRESS_SEED.projectId }
/** The recorded reply the e2e `claude` stand-in also uses. */
const RECORDED: unknown = JSON.parse(
  readFileSync(join(process.cwd(), 'src/main/assist/fixtures/competitors.siteKinds.json'), 'utf8')
)

function claudeReplying(replies: unknown[]): ClaudeProvider & { prompts: string[] } {
  const prompts: string[] = []
  return {
    id: 'claude-code',
    prompts,
    async complete(input): Promise<ClaudeCompletion> {
      prompts.push(input.prompt)
      const json = replies.length > 1 ? replies.shift() : replies[0]
      return {
        provider: 'claude-code',
        text: JSON.stringify(json),
        json: json ?? null,
        inputTokens: 10,
        outputTokens: 20,
        durationMs: 1_000,
        model: input.model ?? null,
        resolvedModel: 'claude-sonnet-4-5',
        usage: { ...emptyClaudeCliUsage(), inputTokens: 10, outputTokens: 20 }
      }
    }
  }
}

/**
 * Only SimpleTexting is saved, so Twilio is an ordinary cited site that no built-in
 * list knows. US question 2 cites reddit.com, which the built-in list sorts.
 */
async function checked(claude: ClaudeProvider): Promise<ProgressSeed> {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-site-kinds-'))
  directories.push(directory)
  const seed = openProgressSeed(directory, { competitors: ['simpletexting.com'], claude })
  opened.push(seed)
  seed.bodies.set(`us|${PROGRESS_SEED.prompts[1].text}`, 'google-brand-named.json')
  await seed.check(PROGRESS_SEED.first)
  return seed
}

function kinds(overview: CompetitorsOverview): [string, string | null][] {
  return overview.rows.map((row) => [row.name, row.siteKind])
}

describe('competitors site kinds', () => {
  test('the shape example parses, and unknown kinds are left out', () => {
    expect(parseSiteKinds(SITE_KINDS_SHAPE.example)?.size).toBe(3)
    expect(parseSiteKinds(RECORDED)?.get('twilio.com')).toBe('big_tech')
    expect(
      parseSiteKinds({ sites: [{ domain: 'https://www.Example.com/x', kind: 'nope' }] })
    ).toEqual(new Map())
    expect(parseSiteKinds({ sites: [{ kind: 'other' }] })).toBeNull()
    expect(parseSiteKinds({ nope: [] })).toBeNull()
  })

  test('competitors and well-known hosts are sorted without Claude; the rest is asked once', async () => {
    const claude = claudeReplying([RECORDED])
    const seed = await checked(claude)
    seed.setClock('2026-10-06T12:00:00.000Z')
    const before = await seed.handlers['competitors:overview']({ ...base, period: 30 })
    expect(kinds(before)).toEqual([
      ['TextBolt', null],
      ['simpletexting.com', 'competitors'],
      ['reddit.com', 'video_social'],
      ['twilio.com', 'other']
    ])
    expect(before.unsortedDomains).toBe(1)

    await expect(seed.handlers['competitors:sortSites'](base)).resolves.toEqual({
      sorted: 1,
      remaining: 0
    })
    expect(claude.prompts).toHaveLength(1)
    const prompt = claude.prompts[0] ?? ''
    expect(prompt.split('\n')[0]).toBe('Assist: competitors.siteKinds')
    expect(prompt).toContain('- twilio.com')
    expect(prompt).not.toContain('- reddit.com')
    expect(prompt).not.toContain('- simpletexting.com')

    const after = await seed.handlers['competitors:overview']({ ...base, period: 30 })
    expect(after.rows.find((row) => row.name === 'twilio.com')?.siteKind).toBe('big_tech')
    expect(after.unsortedDomains).toBe(0)
    // Nothing is left to sort: no second Claude call.
    await expect(seed.handlers['competitors:sortSites'](base)).resolves.toEqual({
      sorted: 0,
      remaining: 0
    })
    expect(claude.prompts).toHaveLength(1)
  })

  test('a domain Claude leaves out is saved as other, so it is not asked again', async () => {
    const claude = claudeReplying([{ sites: [] }])
    const seed = await checked(claude)
    await expect(seed.handlers['competitors:sortSites'](base)).resolves.toEqual({
      sorted: 1,
      remaining: 0
    })
    const overview = await seed.handlers['competitors:overview']({ ...base, period: 30 })
    expect(overview.rows.find((row) => row.name === 'twilio.com')?.siteKind).toBe('other')
    expect(overview.unsortedDomains).toBe(0)
  })

  test('a reply in the wrong shape twice saves nothing', async () => {
    const claude = claudeReplying([{ nope: true }])
    const seed = await checked(claude)
    await expect(seed.handlers['competitors:sortSites'](base)).rejects.toThrow()
    expect(claude.prompts).toHaveLength(2)
    const overview = await seed.handlers['competitors:overview']({ ...base, period: 30 })
    expect(overview.unsortedDomains).toBe(1)
  })

  test('refuses a malformed request', async () => {
    const seed = await checked(claudeReplying([RECORDED]))
    await expect(
      seed.handlers['competitors:sortSites']({ ...base, extra: 1 } as unknown as typeof base)
    ).rejects.toThrow(/competitors:sortSites/)
    await expect(seed.handlers['competitors:sortSites']({ projectId: 'bad id!' })).rejects.toThrow(
      /competitors:sortSites/
    )
  })
})
