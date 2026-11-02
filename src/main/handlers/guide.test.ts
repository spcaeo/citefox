import { afterEach, describe, expect, test } from 'vitest'
import type { GuideProgress } from '@shared/guide'
import type { IpcEventChannel } from '@shared/ipc'
import { cleanupHarness, harness, profile } from './test-harness'

afterEach(cleanupHarness)

async function setup(): Promise<{
  handlers: ReturnType<typeof harness>['handlers']
  projectId: string
  pushed: { channel: IpcEventChannel; payload: unknown }[]
}> {
  const pushed: { channel: IpcEventChannel; payload: unknown }[] = []
  const { handlers } = harness({
    emit: (channel, payload) => {
      pushed.push({ channel, payload })
    }
  })
  const state = await handlers['onboarding:saveProfile'](profile())
  return { handlers, projectId: state.profile?.project.id ?? '', pushed }
}

describe('IPC handlers: guide', () => {
  test('a new project has no progress; update saves a step, the pause route and flags', async () => {
    const { handlers, projectId } = await setup()
    const empty = await handlers['guide:get']({ projectId })
    expect(empty).toMatchObject({ projectId, steps: {}, current: null, paused: null })
    const saved = await handlers['guide:update']({
      projectId,
      steps: { 'topic-kpis': 'done' },
      current: 'set-target-page',
      paused: { stepId: 'set-target-page', route: '#/topics/t1?drawer=topic-page' },
      kickoff: 'started'
    })
    expect(saved.steps).toEqual({ 'topic-kpis': 'done' })
    expect(saved.paused?.route).toBe('#/topics/t1?drawer=topic-page')
    expect((await handlers['guide:get']({ projectId })).current).toBe('set-target-page')
  })

  test('refuses bad requests without echoing them', async () => {
    const { handlers, projectId } = await setup()
    await expect(
      handlers['guide:update']({
        projectId,
        paused: { stepId: 'a', route: 'https://example.com/?email=me@example.com' }
      })
    ).rejects.toThrow(/guide:update/)
    await expect(
      handlers['guide:update']({ projectId, steps: { a: 'started' as never } })
    ).rejects.toThrow()
    await expect(handlers['guide:signal']({ projectId, signal: 'nope' as never })).rejects.toThrow(
      /guide:signal/
    )
    await expect(handlers['guide:get']({ projectId: '../x' })).rejects.toThrow()
  })

  test('a renderer signal is kept; restart clears this project only', async () => {
    const { handlers, projectId } = await setup()
    await handlers['guide:signal']({ projectId, signal: 'sources-viewed' })
    await handlers['guide:update']({ projectId, explainerSeen: 'competitors', tipsOff: true })
    const before = await handlers['guide:get']({ projectId })
    expect(before.signals).toEqual(['sources-viewed'])
    const cleared = await handlers['guide:restart']({ projectId })
    expect(cleared).toMatchObject({ signals: [], explainersSeen: [], tipsOff: false })
  })

  test('saving a competitor anywhere ticks the guide once and tells the windows', async () => {
    const { handlers, projectId, pushed } = await setup()
    const request = {
      projectId,
      id: null,
      name: 'Twilio',
      domain: 'twilio.com',
      aliases: [],
      tier: 'direct' as const
    }
    await handlers['competitors:save'](request)
    await handlers['competitors:save']({ ...request, name: 'Vonage', domain: 'vonage.com' })
    const progress = await handlers['guide:get']({ projectId })
    expect(progress.signals).toEqual(['competitor-saved'])
    const changes = pushed.filter((item) => item.channel === 'guide:changed')
    expect(changes).toHaveLength(1)
    expect((changes[0]?.payload as GuideProgress).signals).toEqual(['competitor-saved'])
  })

  test('a failed save records nothing', async () => {
    const { handlers, projectId } = await setup()
    await expect(
      handlers['competitors:save']({
        projectId,
        id: null,
        name: '',
        domain: null,
        aliases: [],
        tier: 'direct'
      })
    ).rejects.toThrow()
    expect((await handlers['guide:get']({ projectId })).signals).toEqual([])
  })
})
