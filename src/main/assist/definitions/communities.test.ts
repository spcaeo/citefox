import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { AssistRunRequest } from '@shared/ipc'
import {
  COMMUNITY_SEED,
  fixtureResponse,
  seedCommunitiesProject,
  type SeededHarness
} from '../../communities/seed.test-helper'
import type { HttpRequest, HttpResponse } from '../../providers/http'
import { readFixture, scriptedClaude, type ScriptedClaude } from '../assist.test-helper'
import { getAssist } from '../registry'
import { ensureShippedAssists } from './index'

ensureShippedAssists()

const opened: Array<{ harness: SeededHarness; dir: string }> = []

afterEach(() => {
  for (const { harness, dir } of opened.splice(0)) {
    harness.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

function redditFake(request: HttpRequest): HttpResponse | null {
  const url = new URL(request.url)
  if (url.hostname !== 'www.reddit.com') return null
  if (url.pathname.includes('1abc23x')) return fixtureResponse('reddit-thread-open.json')
  if (url.pathname.includes('1def45y')) return fixtureResponse('reddit-thread-archived.json')
  return { status: 404, body: '{}' }
}

async function seeded(): Promise<{ harness: SeededHarness; claude: ScriptedClaude }> {
  const dir = mkdtempSync(join(tmpdir(), 'citefox-reply-'))
  const claude = scriptedClaude()
  const harness = await seedCommunitiesProject(dir, { claude, http: redditFake })
  opened.push({ harness, dir })
  return { harness, claude }
}

function replyRequest(
  threadUrl: string | null,
  extra: Partial<AssistRunRequest> = {}
): AssistRunRequest {
  return {
    assistId: 'communities.reply',
    projectId: COMMUNITY_SEED.projectId,
    pageId: COMMUNITY_SEED.pageId,
    marketId: null,
    promptId: null,
    inputs: threadUrl === null ? {} : { threadUrl },
    instruction: null,
    ...extra
  }
}

async function checkThreads(harness: SeededHarness): Promise<void> {
  await harness.handlers['communities:checkThreads']({
    projectId: COMMUNITY_SEED.projectId,
    urls: null,
    force: true
  })
}

describe('communities.reply (FR-17.6)', () => {
  test('is registered with the shared reply rules and two items', () => {
    const definition = getAssist('communities.reply')
    expect(definition).toMatchObject({ minItems: 2, maxItems: 2, needsProject: true })
    expect(definition?.task).toMatch(/answer the thread's question first/i)
    expect(definition?.task).toMatch(/CiteFox never posts/)
  })

  test('drafts from the thread excerpt, the buyer prompts citing it and the page', async () => {
    const { harness, claude } = await seeded()
    await checkThreads(harness)
    const result = await harness.handlers['assist:run'](replyRequest(COMMUNITY_SEED.redditOpen))
    const prompt = claude.requests.at(-1)?.prompt ?? ''
    expect(prompt.startsWith('Assist: communities.reply\n')).toBe(true)
    expect(prompt).toContain('Subreddit: r/sysadmin')
    expect(prompt).toContain('Our alarm panels send to @vtext.com. What now?')
    expect(prompt).toContain(COMMUNITY_SEED.prompts[0])
    expect(prompt).toContain(`Page to point to: ${COMMUNITY_SEED.pageUrl}`)
    expect(prompt).toContain('Can the user reply: yes, the thread is open')
    expect(claude.requests.at(-1)?.trace).toMatchObject({
      source: 'assist',
      assistId: 'communities.reply'
    })
    expect(result.items.map((item) => item.tag)).toEqual(['answer', 'disclosure'])
    expect(result.savedDataOnly).toBe(true)
    expect(result.searchesUsed).toBe(0)
  })

  test('works before Check threads, saying the post is not read yet', async () => {
    const { harness, claude } = await seeded()
    await harness.handlers['assist:run'](replyRequest(COMMUNITY_SEED.redditOpen))
    const prompt = claude.requests.at(-1)?.prompt ?? ''
    expect(prompt).toContain('(not read yet: Check threads reads the post text)')
    expect(prompt).toContain('Can the user reply: not checked yet')
  })

  test('refuses an archived thread, an uncited thread and a missing thread', async () => {
    const { harness, claude } = await seeded()
    await checkThreads(harness)
    const before = claude.requests.length
    await expect(
      harness.handlers['assist:run'](replyRequest(COMMUNITY_SEED.redditArchived))
    ).rejects.toThrow('This thread is archived, so Reddit takes no new replies.')
    await expect(
      harness.handlers['assist:run'](
        replyRequest('https://www.reddit.com/r/other/comments/zzz999/x')
      )
    ).rejects.toThrow('That thread is not cited in the latest checks.')
    await expect(harness.handlers['assist:run'](replyRequest(null))).rejects.toThrow(
      'Pick a thread first.'
    )
    expect(claude.requests.length).toBe(before)
  })

  const good = readFixture('communities.reply') as {
    items: Array<{ text: string; tag: string }>
  }
  const withItems = (
    answer: string,
    disclosure: string,
    tags = ['answer', 'disclosure']
  ): { summary: string; items: Array<{ text: string; tag?: string }>; caution: null } => ({
    summary: 'Draft reply for r/sysadmin',
    items: [
      { text: answer, tag: tags[0] },
      { text: disclosure, tag: tags[1] }
    ],
    caution: null
  })
  const answer = good.items[0]?.text ?? ''
  const disclosure = good.items[1]?.text ?? ''

  test.each([
    [
      'the brand in the first sentence',
      withItems(`TextBolt fixes this. ${answer}`, disclosure),
      'Answer the question first: leave the brand out of the first sentence.'
    ],
    [
      'a disclosure that does not say who the user is',
      withItems(answer, 'Hope that helps.'),
      'Say who the user is in the disclosure'
    ],
    [
      'the disclosure first',
      withItems(disclosure, answer, ['disclosure', 'answer']),
      'Give the answer first and the disclosure second.'
    ],
    [
      'a link to another site',
      withItems(answer, 'Full disclosure: I work at TextBolt. See https://twilio.com/pricing'),
      'Link at most once, and only to a page on textbolt.com.'
    ],
    [
      'two links',
      withItems(
        `${answer} https://textbolt.com/a`,
        'Full disclosure: I work at TextBolt. https://textbolt.com/b'
      ),
      'Link at most once'
    ]
  ])('rejects %s and retries with the problem named', async (_name, bad, problem) => {
    const { harness, claude } = await seeded()
    claude.queue.push(bad, readFixture('communities.reply'))
    const before = claude.requests.length
    const result = await harness.handlers['assist:run'](replyRequest(COMMUNITY_SEED.redditOpen))
    expect(claude.requests.length).toBe(before + 2)
    expect(claude.requests.at(-1)?.prompt).toContain(`The previous reply was rejected: ${problem}`)
    expect(result.items).toHaveLength(2)
  })
})
