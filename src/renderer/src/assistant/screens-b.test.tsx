// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import type { AppSchedule, DueList, Notice, ProjectSchedule } from '@shared/domain'
import { alertsAiPatch } from '../alerts/aiContext'
import { ConnectionsScreen } from '../connections/ConnectionsScreen'
import { CheckNowScreen } from '../projects/CheckNowScreen'
import { createMockShellClient } from '../projects/mockClient'
import { settingsAiPatch } from '../settings/aiContext'
import { NoticesGrid } from '../status/components/NoticesGrid'
import { currentAiContext, resetAiContext, setAiBase } from './context/store'

afterEach(() => {
  cleanup()
  resetAiContext()
  window.location.hash = ''
})

const DUE: DueList = {
  day: '2026-10-23',
  pages: [
    {
      projectId: 'p1',
      pageId: 'page-a',
      label: 'Text alerts',
      title: null,
      url: 'https://example.com/a',
      marketIds: ['us-en'],
      dueAt: '2026-10-23T08:00:00.000Z',
      intervalDays: 14,
      reason: 'scheduled',
      promptIds: null
    }
  ]
}

describe('Ask CiteFox context on tracking and setup screens', () => {
  test('Check now names the due pages and the queue numbers', async () => {
    render(
      <CheckNowScreen
        client={createMockShellClient()}
        pausedProject
        projectId="p1"
        listDue={async () => DUE}
      />
    )
    await waitFor(() => {
      expect(currentAiContext().entities).toContainEqual({
        kind: 'page',
        id: 'page-a',
        label: 'Text alerts',
        detail: 'Scheduled'
      })
    })
    const context = currentAiContext()
    expect(context.numbers.map((item) => item.label)).toContain('Pages due')
    expect(context.facts).toContain('This project is paused; Check now still runs it.')
  })

  test('Connections tells states and key counts, never a key or its hint', async () => {
    const shell = createMockShellClient({ paceMs: 0, wait: () => Promise.resolve() })
    await shell.addKey({
      provider: 'serpapi',
      name: 'My plan',
      secret: 'serp-secret-0001',
      cap: 5000,
      projectIds: []
    })
    render(
      <ConnectionsScreen
        client={shell}
        overview={await shell.getOverview()}
        claudeModel={null}
        onChanged={async () => undefined}
      />
    )
    const facts = currentAiContext().facts
    expect(facts.find((fact) => fact.startsWith('SerpApi:'))).toMatch(/1 key/)
    expect(facts.some((fact) => fact.startsWith('Claude:'))).toBe(true)
    const text = JSON.stringify(currentAiContext())
    expect(text).not.toContain('serp-secret')
    expect(text).not.toContain('0001')
    expect(text).not.toContain('My plan')
  })

  test('a notice row carries its own ✦ once a project is open', () => {
    setAiBase({
      screen: 'status',
      screenLabel: 'Status',
      route: '#/status',
      crumbs: [],
      projectId: 'p1',
      projectName: 'TextBolt',
      pageId: null,
      topicId: null,
      promptId: null,
      marketId: null,
      runId: null,
      filters: {}
    })
    const notice: Notice = {
      id: 'n1',
      kind: 'search_cap',
      projectId: 'p1',
      projectName: 'TextBolt',
      title: 'Search cap reached',
      body: 'TextBolt used its 500 searches.',
      actions: [],
      createdAt: '2026-10-23T08:00:00.000Z',
      resolvedAt: null,
      resolution: null
    }
    render(
      <NoticesGrid
        state={{
          notices: [notice],
          error: null,
          message: null,
          resolve: async () => 'Done.'
        }}
      />
    )
    const sparkle = screen.getByRole('button', { name: 'Ask CiteFox about Search cap reached' })
    expect(sparkle.getAttribute('data-ai-sparkle')).toBe('alert')
  })
})

describe('Context patches for settings screens', () => {
  const app: AppSchedule = {
    startAtLogin: true,
    catchUpAfterSleep: false,
    checkWhenClosed: true,
    dailyCheckTime: '09:00'
  }
  const project: ProjectSchedule = {
    projectId: 'p1',
    defaultIntervalDays: 14,
    dailyCheckTime: '09:00',
    quietFrom: '22:00',
    quietUntil: '07:00',
    spreadAcrossDay: false,
    catchUp: true,
    paused: false,
    nextCheckAt: null,
    pagesDueToday: 3
  }

  test('Schedule & alerts: the tab, the schedule and the alert switches, no recipients', () => {
    const patch = alertsAiPatch({
      tab: 'notifications',
      app,
      project,
      alerts: {
        projectId: 'p1',
        desktop: true,
        emailAfterCheck: false,
        emailAccountId: null,
        emailTo: ['owner@example.com'],
        slackEnabled: false,
        slackWebhookStored: true,
        monthlyClientPdf: true,
        monthlyPdfTo: 'client@example.com'
      },
      email: { mode: 'smtp', accounts: [] }
    })
    expect(patch.filters).toEqual({ tab: 'Notifications' })
    expect(patch.facts).toContain('This project re-checks every 14 days')
    expect(patch.facts).toContain('Quiet hours: 22:00–07:00')
    expect(patch.facts).toContain('Desktop alerts: on')
    expect(patch.numbers).toEqual([{ label: 'Pages due today', value: '3' }])
    expect(JSON.stringify(patch)).not.toContain('@example.com')
  })

  test('Settings: the tab and the form values, never the name or the CiteFox AI path', () => {
    const patch = settingsAiPatch({
      tab: 'general',
      draft: {
        userName: 'Rakesh',
        defaultCountry: 'US',
        defaultLanguage: 'en',
        defaultLocation: '',
        defaultDevice: 'desktop',
        defaultIntervalDays: '14',
        defaultSamples: '1',
        defaultPromptCount: '10',
        claudeBinaryPath: '/usr/local/bin/claude',
        claudeConcurrency: '2',
        claudeModel: '',
        claudeProvider: 'claude-code',
        codexBinaryPath: '',
        codexModel: '',
        codexQuickModel: '',
        jinaMode: 'fallback',
        budget: ''
      },
      unsaved: true,
      serpKeys: 2
    })
    expect(patch.filters).toEqual({ tab: 'General' })
    expect(patch.facts).toContain('Monthly search budget: no cap')
    expect(patch.facts).toContain('Unsaved changes')
    expect(patch.facts?.[0]).toMatch(/^Claude: Claude Code · model .+ · 2 at a time$/)
    const text = JSON.stringify(patch)
    expect(text).not.toContain('Rakesh')
    expect(text).not.toContain('/usr/local/bin')
  })
})
