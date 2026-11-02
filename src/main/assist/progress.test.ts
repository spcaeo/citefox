import { describe, expect, test } from 'vitest'
import type { AssistProgress } from '@shared/ipc'
import {
  inProgressRun,
  pageLabel,
  progressHint,
  progressNote,
  progressRetryNext,
  progressScope,
  progressStep,
  runWithProgress,
  takeClaudeContext
} from './progress'
import { claudeStepLabel } from './progress-labels'

function collector(): {
  events: AssistProgress[]
  emit: (event: AssistProgress) => void
  clock: () => number
} {
  const events: AssistProgress[] = []
  let now = 1_000
  return {
    events,
    emit: (event) => events.push(event),
    clock: () => {
      now += 250
      return now
    }
  }
}

describe('assist progress runs', () => {
  test('a step outside a run is a no-op', () => {
    expect(inProgressRun()).toBe(false)
    const step = progressStep({ kind: 'read', label: 'Reading /pricing' })
    expect(() => {
      step.update('Reading')
      step.done('Read')
    }).not.toThrow()
    progressNote({ kind: 'result', label: '3 suggestions ready' })
  })

  test('emits running then the end state with timestamps, channel, scope and run id', async () => {
    const { events, emit, clock } = collector()
    const value = await runWithProgress(
      { channel: 'assist:run', scope: 'page.promises', emit, clock, runId: 'run-1' },
      async () => {
        expect(inProgressRun()).toBe(true)
        const read = progressStep({ kind: 'read', label: 'Reading /pricing' })
        read.update('Reading')
        read.done('Read · 820 words')
        read.fail('ignored after the end')
        progressStep({ kind: 'read', label: 'Reading /compare' }).skip('Not found')
        progressNote({ kind: 'result', label: '9 suggestions ready' })
        return 42
      }
    )
    expect(value).toBe(42)
    expect(events.map((event) => [event.stepId, event.state, event.detail])).toEqual([
      ['s1', 'running', null],
      ['s1', 'running', 'Reading'],
      ['s1', 'done', 'Read · 820 words'],
      ['s2', 'running', null],
      ['s2', 'skipped', 'Not found'],
      ['s3', 'running', null],
      ['s3', 'done', null]
    ])
    for (const event of events) {
      expect(event).toMatchObject({ runId: 'run-1', channel: 'assist:run', scope: 'page.promises' })
    }
    const done = events[2]
    expect(done?.endedAt).toBeGreaterThan(done?.startedAt ?? 0)
    expect(events[0]?.endedAt).toBeNull()
  })

  test('drops steps after the invoke settled (background work it started)', async () => {
    const { events, emit } = collector()
    const late: (() => void)[] = []
    await runWithProgress({ channel: 'checks:start', emit }, () => {
      late.push(() => progressStep({ kind: 'claude', label: 'Asking CiteFox AI' }).done())
    })
    for (const step of late) step()
    expect(events).toEqual([])
  })

  test('a throwing emitter never fails the step, and errors still close the run', async () => {
    await expect(
      runWithProgress(
        {
          channel: 'assist:run',
          emit: () => {
            throw new Error('window closed')
          }
        },
        async () => {
          progressStep({ kind: 'read', label: 'Reading textbolt.com' }).done()
          throw new Error('boom')
        }
      )
    ).rejects.toThrow('boom')
  })

  test('caps labels and redacts key shapes and control characters', async () => {
    const { events, emit } = collector()
    await runWithProgress({ channel: 'assist:run', emit }, () => {
      progressStep({
        kind: 'claude',
        label: `Asking\nClaude ${'x'.repeat(200)}`,
        detail: 'failed with sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789'
      }).fail()
    })
    const event = events[1]
    expect(event?.label.length).toBeLessThanOrEqual(120)
    expect(event?.label.startsWith('Asking Claude')).toBe(true)
    expect(event?.detail).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz')
  })

  test('the hint and the retry flag reach the next Claude step', async () => {
    const { emit } = collector()
    await runWithProgress({ channel: 'topics:matchPages', emit }, () => {
      expect(takeClaudeContext()).toEqual({ retry: false, hint: null })
      progressHint('Matching 20 prompts · 1 of 2')
      progressRetryNext()
      expect(takeClaudeContext()).toEqual({ retry: true, hint: 'Matching 20 prompts · 1 of 2' })
      expect(takeClaudeContext().retry).toBe(false)
    })
  })

  test('scope is the assist id, else the draft id, else the domain', () => {
    expect(progressScope([{ assistId: 'page.promises', draftId: 'd1' }])).toBe('page.promises')
    expect(progressScope([{ projectId: 'p1', draftId: 'd1' }])).toBe('d1')
    expect(progressScope([{ projectId: null, domain: 'textbolt.com' }])).toBe('textbolt.com')
    expect(progressScope([])).toBeNull()
    expect(progressScope(['x'])).toBeNull()
  })

  test('page labels show the host for the homepage and the path otherwise', () => {
    expect(pageLabel('https://www.textbolt.com/')).toBe('textbolt.com')
    expect(pageLabel('https://textbolt.com/pricing/')).toBe('/pricing')
    expect(pageLabel('not a url')).toBe('not a url')
  })

  test('Claude step labels name the purpose and the retry', () => {
    const trace = {
      source: 'assist' as const,
      projectId: null,
      templateKind: null,
      templateId: null,
      templateHash: null,
      assistId: 'project.fillSiteRead'
    }
    expect(claudeStepLabel(trace, false)).toBe(
      'Asking CiteFox AI to read what your site sells and its brand names'
    )
    expect(claudeStepLabel(trace, true)).toBe(
      'Asking CiteFox AI again to read what your site sells and its brand names'
    )
    expect(
      claudeStepLabel({ ...trace, assistId: null, templateKind: 'topic_page_match' }, false)
    ).toBe('Asking CiteFox AI to match questions to your pages')
    expect(claudeStepLabel(undefined, false)).toBe('Asking CiteFox AI')
  })
})
