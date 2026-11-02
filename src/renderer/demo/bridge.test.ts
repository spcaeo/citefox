import { describe, expect, test, vi } from 'vitest'
import { IPC_EVENT_CHANNELS, IPC_INVOKE_CHANNELS, type IpcInvokeChannel } from '@shared/ipc'
import { createDemoApi, demoAnswer, DemoBlockedError } from './bridge'
import { DEMO_BLOCKED_MESSAGE, DEMO_QUIET, DEMO_READS, demoPolicy } from './policy'
import { findEntry, stableJson, type DemoSnapshot } from './snapshot'
import recorded from './snapshot.json'

/**
 * The browser demo's bridge (Docs/DEMO.md): every channel in the IPC contract has
 * a demo answer or a "blocked" answer, blocked actions show one message and never
 * reach anything, and the recorded data is clean.
 */

const snapshot = recorded as unknown as DemoSnapshot
const APP = { name: 'CiteFox', version: '1.2.3', build: { commit: null, number: 7, builtAt: '' } }

describe('every IPC channel is handled', () => {
  test('each invoke is a read, a quiet change or blocked; reads and quiet ones have an answer', () => {
    const missing: string[] = []
    for (const channel of IPC_INVOKE_CHANNELS) {
      const policy = demoPolicy(channel)
      const answer = demoAnswer(snapshot, APP, channel, { projectId: 'proj-1' })
      if (policy === 'blocked') expect(answer.kind, channel).toBe('blocked')
      else if (answer.kind !== 'answer') missing.push(channel)
    }
    // A read nobody recorded: run `npm run demo:record`, or move it to blocked.
    expect(missing).toEqual([])
  })

  test('the policy lists only real channels, once', () => {
    const all = new Set<string>(IPC_INVOKE_CHANNELS)
    for (const channel of [...DEMO_READS, ...DEMO_QUIET])
      expect(all.has(channel), channel).toBe(true)
    expect(new Set([...DEMO_READS, ...DEMO_QUIET]).size).toBe(DEMO_READS.length + DEMO_QUIET.length)
  })

  test('every push event can be subscribed to and never fires', () => {
    const api = createDemoApi({ snapshot, appInfo: APP })
    const listener = vi.fn()
    for (const channel of IPC_EVENT_CHANNELS) {
      const off = (api[channel] as (l: () => void) => () => void)(listener)
      expect(typeof off, channel).toBe('function')
      off()
    }
    expect(listener).not.toHaveBeenCalled()
  })

  test('every invoke on the API returns a promise that settles', async () => {
    const api = createDemoApi({ snapshot, appInfo: APP }) as unknown as Record<
      string,
      (arg?: unknown) => Promise<unknown>
    >
    for (const channel of IPC_INVOKE_CHANNELS) {
      const settled = await api[channel]!({ projectId: 'proj-1' }).then(
        () => 'answer',
        (error: unknown) => (error instanceof DemoBlockedError ? 'blocked' : String(error))
      )
      expect(['answer', 'blocked'], channel).toContain(settled)
    }
  })
})

describe('blocked actions', () => {
  const MUST_BLOCK: IpcInvokeChannel[] = [
    'checks:start',
    'keys:add',
    'keys:test',
    'email:test',
    'email:saveAccount',
    'reports:download',
    'reports:sendNow',
    'exports:start',
    'settings:exportAllData',
    'assistant:ask',
    'ask:question',
    'assist:run',
    'prompts:generate',
    'topics:generateQuestions',
    'account:save',
    'projects:create',
    'pages:add',
    'fixes:create',
    'app:resetKeepKeys'
  ]

  test.each(MUST_BLOCK)('%s is blocked', (channel) => {
    expect(demoPolicy(channel)).toBe('blocked')
  })

  test('a blocked call rejects with the demo message and tells the page', async () => {
    const onBlocked = vi.fn()
    const api = createDemoApi({ snapshot, appInfo: APP, onBlocked })
    await expect(api['checks:start']({} as never)).rejects.toThrow(DEMO_BLOCKED_MESSAGE)
    expect(onBlocked).toHaveBeenCalledWith('checks:start')
  })

  test('the message is the agreed one', () => {
    expect(DEMO_BLOCKED_MESSAGE).toBe(
      'This is a demo with sample data. Download CiteFox to run real checks.'
    )
  })
})

describe('fixed answers', () => {
  test('no Join step, no update banner, the demo release in the footer', async () => {
    const api = createDemoApi({ snapshot, appInfo: APP })
    expect(await api['account:get']()).toMatchObject({ enabled: false })
    expect(await api['updates:get']()).toMatchObject({ available: false })
    expect(await api['updates:check']()).toMatchObject({ available: false })
    expect(await api['app:getInfo']()).toEqual(APP)
  })

  test('the theme and the guide change in memory', async () => {
    const api = createDemoApi({ snapshot, appInfo: APP })
    const before = await api['settings:get']()
    const after = await api['settings:update']({ theme: 'dark' } as never)
    expect((after.settings as { theme?: string }).theme).toBe('dark')
    expect(((await api['settings:get']()).settings as { theme?: string }).theme).toBe('dark')
    expect(before.dataDirectory).toBe(after.dataDirectory)
    const guide = await api['guide:update']({ projectId: 'proj-1', hidden: true })
    expect(guide.hidden).toBe(true)
  })

  test('answers are copies: changing one never changes the next', async () => {
    const api = createDemoApi({ snapshot, appInfo: APP })
    const first = (await api['projects:list']()) as unknown as Record<string, unknown>
    first.changed = true
    expect((await api['projects:list']()) as unknown as Record<string, unknown>).not.toHaveProperty(
      'changed'
    )
  })
})

describe('matching recorded calls', () => {
  const sample: DemoSnapshot = {
    version: 1,
    recordedAt: '',
    entries: {
      'reports:review': [
        { args: { projectId: 'p', engine: 'all', timeZone: 'America/Toronto' }, result: 'all' },
        { args: { projectId: 'p', engine: 'chatgpt', timeZone: 'America/Toronto' }, result: 'gpt' }
      ]
    }
  }

  test('exact arguments win, in any key order', () => {
    expect(
      findEntry(sample, 'reports:review', {
        timeZone: 'America/Toronto',
        engine: 'chatgpt',
        projectId: 'p'
      })?.result
    ).toBe('gpt')
    expect(stableJson({ b: 1, a: 2 })).toBe(stableJson({ a: 2, b: 1 }))
  })

  test('otherwise the closest call: same ids beat the same time zone', () => {
    expect(
      findEntry(sample, 'reports:review', {
        projectId: 'p',
        engine: 'chatgpt',
        timeZone: 'Asia/Tokyo'
      })?.result
    ).toBe('gpt')
  })

  test('nothing recorded: null', () => {
    expect(findEntry(sample, 'reports:metrics', {})).toBeNull()
  })
})

describe('the recorded data is clean', () => {
  const text = JSON.stringify(snapshot)

  test('no folder paths, emails or keys', () => {
    expect(text).not.toMatch(/\/tmp\/|\/home\/|\/Users\/|citefox-demo-/)
    expect(text).not.toMatch(/[\w.+-]+@(gmail|yahoo|outlook|hotmail)\.com/i)
    expect(text).not.toMatch(/fixture-serpapi-secret|sk-[a-z0-9]{8,}/i)
  })

  test('no provider names in any text a screen can show', () => {
    const shown: string[] = []
    const walk = (value: unknown): void => {
      if (typeof value === 'string') {
        // Ids the code switches on (`serpapi`) stay, like in the app's own code.
        if (
          !/^[a-z0-9_.:-]+$/.test(value) &&
          /cloro|serp ?api|jina|claude|anthropic|codex/i.test(value)
        )
          shown.push(value)
      } else if (Array.isArray(value)) value.forEach(walk)
      else if (value !== null && typeof value === 'object') Object.values(value).forEach(walk)
    }
    for (const list of Object.values(snapshot.entries)) for (const entry of list) walk(entry.result)
    expect(shown).toEqual([])
  })
})
