// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Market } from '@shared/domain'
import type {
  AlertLogEntry,
  AlertRule,
  SaveAlertRuleRequest,
  AllPageRow,
  HelpFillDescribeRequest
} from '@shared/ipc'
import { BuildToolsContext, ipcBuildClient } from '../../buildMenu/buildClient'
import type { ScopeSource } from '../../scope'
import type { HelpFillSource } from '../../ui'
import { AlertsScreen } from '../AlertsScreen'
import { createMockAlertsClient } from '../mock'
import { createMemoryRulesClient } from './rulesClient'
import { ruleLogHash } from './useRuleActions'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

const US: Market = {
  id: 'm-us',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}
const UK: Market = { ...US, id: 'm-uk', country: 'GB' }

function row(id: string, url: string, title: string): AllPageRow {
  return {
    id,
    url,
    title,
    label: title,
    folder: '/',
    status: 'tracked',
    groups: [],
    clusters: [],
    marketIds: ['m-us', 'm-uk'],
    promptCount: 4,
    samples: 1,
    nextCheckAt: null,
    score: 50,
    pageCited: 1,
    aioPrompts: 2
  } as unknown as AllPageRow
}

const SOURCE: ScopeSource = {
  'allpages:list': async () =>
    ({
      domain: 'textbolt.com',
      rows: [
        row('pg-pricing', 'https://textbolt.com/pricing', 'Pricing'),
        row('pg-api', 'https://textbolt.com/api', 'SMS API')
      ],
      markets: [US, UK],
      defaultMarketId: 'm-us',
      searchesLeft: 40
    }) as unknown as Awaited<ReturnType<ScopeSource['allpages:list']>>,
  'structure:get': async () => {
    throw new Error('no structure')
  },
  'topics:list': async () => {
    throw new Error('no topics')
  },
  'grid:listViews': async () => {
    throw new Error('no views')
  }
}

function rule(id: string, name: string, extra: Partial<AlertRule> = {}): AlertRule {
  return {
    id,
    projectId: 'textbolt',
    name,
    when: 'citation_lost',
    scoreDrop: null,
    competitorDomain: null,
    scope: { kind: 'tracked', ids: [] },
    marketIds: [],
    desktop: true,
    emailTo: ['ops@textbolt.com', 'ceo@textbolt.com'],
    slack: false,
    delivery: 'instant',
    status: 'active',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    lastFiredAt: null,
    firedCount: 0,
    ...extra
  }
}

const LOG: AlertLogEntry = {
  id: 'log-1',
  ruleId: 'r-1',
  ruleName: 'Lost citations',
  at: '2026-10-19T09:00:00.000Z',
  pageId: 'pg-pricing',
  pageLabel: 'Pricing',
  pageUrl: 'https://textbolt.com/pricing',
  marketId: 'm-us',
  runId: 'run-9',
  when: 'citation_lost',
  summary: 'Target page no longer cited on 2 questions',
  details: ['best sms api', 'cheap twilio alternative'],
  deliveredTo: ['Desktop', '2 emails']
}

interface Notice {
  message: string
  tone: string | undefined
}

function screenAt(
  hash: string,
  client: ReturnType<typeof createMemoryRulesClient> = createMemoryRulesClient({
    rules: [
      rule('r-1', 'Lost citations'),
      rule('r-2', 'Score drop', { when: 'score_drop', scoreDrop: 10, status: 'paused' })
    ],
    log: [LOG],
    slackReady: true,
    dryRun: {
      days: 30,
      fired: 3,
      checksRead: 12,
      events: [
        {
          at: LOG.at,
          pageId: LOG.pageId,
          pageLabel: LOG.pageLabel,
          pageUrl: LOG.pageUrl,
          marketId: LOG.marketId,
          runId: LOG.runId,
          when: LOG.when,
          summary: LOG.summary,
          details: LOG.details
        }
      ]
    }
  }),
  helpSource?: HelpFillSource
): { client: ReturnType<typeof createMemoryRulesClient>; notices: Notice[]; ui: ReactElement } {
  window.location.hash = hash
  const notices: Notice[] = []
  const focus = hash.split('?')[0]?.split('/')[2]
  const ui = (
    <BuildToolsContext.Provider
      value={{
        client: ipcBuildClient,
        notify: (message, tone) => notices.push({ message, tone })
      }}
    >
      <AlertsScreen
        client={createMockAlertsClient()}
        rulesClient={client}
        scopeSource={SOURCE}
        projectId="textbolt"
        projectName="TextBolt"
        {...(focus ? { focus } : {})}
        {...(helpSource ? { helpSource } : {})}
      />
    </BuildToolsContext.Provider>
  )
  return { client, notices, ui }
}

function settle(ms = 40): Promise<void> {
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)))
}

describe('Alert rules list', () => {
  it('opens on Alert rules with each rule, what it watches and where it goes', async () => {
    const { ui } = screenAt('#/alerts')
    render(ui)
    const list = await screen.findByTestId('alert-rules')
    expect(screen.getByRole('heading', { level: 1, name: 'Alerts & schedules' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Alert rules' }).getAttribute('aria-selected')).toBe(
      'true'
    )
    expect(within(list).getByText('Lost citations')).toBeTruthy()
    expect(within(list).getByText('Score drop')).toBeTruthy()
    expect(within(list).getAllByText('Paused').length).toBeGreaterThan(1)
    expect(list.textContent).toContain('Desktop')
    expect(list.textContent).toMatch(/2 emails|ops@textbolt\.com/)
  })

  it('New rule puts the drawer on the URL; Save sends the rule and closes it', async () => {
    const { ui, client, notices } = screenAt('#/alerts')
    render(ui)
    await screen.findByTestId('alert-rules')
    fireEvent.click(screen.getAllByRole('button', { name: 'New rule' })[0] as HTMLElement)
    await waitFor(() => {
      expect(window.location.hash).toContain('drawer=alert-rule')
    })
    expect(window.location.hash).toContain('rule.id=new')
    const drawer = await screen.findByTestId('alert-rule-drawer')
    // New rules start with the addresses already used for the after-check summary.
    fireEvent.click(within(drawer).getByRole('radio', { name: 'Score drops by N or more' }))
    await settle(450)
    expect(client.calls).toContain('dryRun:score_drop')
    expect(within(drawer).getByTestId('rule-dry-summary').textContent).toContain(
      'Would have fired 3 times in the last 30 days'
    )
    expect(within(drawer).getByTestId('rule-dry-events').textContent).toContain(
      'Target page no longer cited on 2 questions'
    )
    fireEvent.click(within(drawer).getByTestId('rule-save'))
    await waitFor(() => {
      expect(client.calls).toContain('save:new')
    })
    await waitFor(() => {
      expect(window.location.hash).not.toContain('drawer=alert-rule')
    })
    expect(notices.at(-1)?.message).toMatch(/^Saved “Score drops by 10/)
  })

  it('✦ Describe it fills a new rule for review: only known pages and addresses go in', async () => {
    const describes: HelpFillDescribeRequest[] = []
    const help: HelpFillSource = {
      'helpfill:estimate': async ({ kind }) => ({
        kind,
        available: true,
        calls: 1,
        costText: '1 AI call · about $0.01',
        reason: null
      }),
      'helpfill:prompt': async () => {
        throw new Error('no chatbot way for a rule')
      },
      'helpfill:read': async () => {
        throw new Error('no chatbot way for a rule')
      },
      'helpfill:describe': async (request) => {
        describes.push(request)
        return {
          kind: 'alertRule',
          rows: [
            {
              id: 'r0',
              section: null,
              values: {
                name: 'Twilio beats us on pricing',
                when: 'competitor_cited',
                score: '',
                competitor: 'twilio.com',
                scope: 'pages',
                scope_ids: 'pg-pricing,pg-gone',
                markets: 'm-uk',
                desktop: 'no',
                slack: 'no',
                email: 'ops@textbolt.com,stranger@example.com',
                delivery: 'digest',
                note: 'Watches the pricing page in the UK.'
              }
            }
          ],
          setAside: [],
          counts: { read: 1, tracked: 0, repeats: 0, setAside: 0, ready: 1 },
          noun: ['rule', 'rules'],
          brand: 'TextBolt',
          warnings: []
        }
      }
    }
    const made = screenAt('#/alerts?drawer=alert-rule&rule.id=new', undefined, help)
    const saves: SaveAlertRuleRequest[] = []
    const save = made.client.save.bind(made.client)
    made.client.save = (request) => {
      saves.push(request)
      return save(request)
    }
    render(made.ui)
    const drawer = await screen.findByTestId('alert-rule-drawer')
    const box = within(drawer).getByTestId('rule-describe')
    // Describe only: no chatbot card for a rule.
    expect(within(box).queryByRole('radio', { name: /ChatGPT/u })).toBeNull()
    fireEvent.change(await within(box).findByLabelText('What should this rule tell you?'), {
      target: { value: 'Tell me when a competitor overtakes us on pricing questions' }
    })
    fireEvent.click(within(box).getByRole('button', { name: 'Fill in the rule' }))
    await waitFor(() =>
      expect(within(drawer).getByTestId('rule-described').textContent).toContain(
        'Only addresses already set up in Alerts are filled in.'
      )
    )
    expect(describes[0]?.kind).toBe('alertRule')
    // Only the place's own note: no "Read 1 row. 1 is ready." banner.
    expect(within(drawer).queryByTestId('rule-hf-summary')).toBeNull()
    expect(within(drawer).getByTestId('rule-described').textContent).toMatch(
      /^Filled in below\. Check each field, then Save rule\./u
    )
    expect(
      (within(drawer).getByRole('textbox', { name: 'Rule name' }) as HTMLInputElement).value
    ).toBe('Twilio beats us on pricing')
    expect(
      (
        within(drawer).getByRole('radio', {
          name: 'Competitor is cited instead'
        }) as HTMLInputElement
      ).checked
    ).toBe(true)
    // Nothing is saved until Save rule.
    expect(made.client.calls).not.toContain('save:new')
    fireEvent.click(within(drawer).getByTestId('rule-save'))
    await waitFor(() => expect(saves).toHaveLength(1))
    expect(saves[0]).toMatchObject({
      name: 'Twilio beats us on pricing',
      when: 'competitor_cited',
      competitorDomain: 'twilio.com',
      scope: { kind: 'pages', ids: ['pg-pricing'] },
      marketIds: ['m-uk'],
      desktop: false,
      slack: false,
      emailTo: ['ops@textbolt.com'],
      delivery: 'digest'
    })
  })

  it('a rule link opens the same drawer after a reload, and an unknown id is not available', async () => {
    const first = screenAt('#/alerts?drawer=alert-rule&rule.id=r-1')
    const view = render(first.ui)
    const drawer = await screen.findByTestId('alert-rule-drawer')
    await waitFor(() => {
      expect(within(drawer).getByRole('textbox', { name: 'Rule name' })).toBeTruthy()
    })
    expect(
      (within(drawer).getByRole('textbox', { name: 'Rule name' }) as HTMLInputElement).value
    ).toBe('Lost citations')
    expect(within(drawer).getByRole('button', { name: 'Delete rule' })).toBeTruthy()
    view.unmount()
    const second = screenAt('#/alerts?drawer=alert-rule&rule.id=gone')
    render(second.ui)
    expect(
      await screen.findByText('This alert rule is not available to you. It may have been deleted.')
    ).toBeTruthy()
  })

  it('Duplicate opens a new rule copied from the source', async () => {
    const { ui } = screenAt('#/alerts?drawer=alert-rule&rule.id=new&rule.from=r-2')
    render(ui)
    const drawer = await screen.findByTestId('alert-rule-drawer')
    await waitFor(() => {
      expect(
        (within(drawer).getByRole('textbox', { name: 'Rule name' }) as HTMLInputElement).value
      ).toBe('Score drop (copy)')
    })
    expect(within(drawer).getByRole('heading', { name: 'Duplicate alert rule' })).toBeTruthy()
  })

  it('bulk pause and delete (with a confirm) go through the client', async () => {
    const { ui, client } = screenAt('#/alerts')
    render(ui)
    const list = await screen.findByTestId('alert-rules')
    fireEvent.click(within(list).getByRole('checkbox', { name: /Select Lost citations/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Pause 1' }))
    await waitFor(() => {
      expect(client.calls).toContain('status:paused:r-1')
    })
    fireEvent.click(within(list).getByRole('checkbox', { name: /Select Score drop/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete 1' }))
    const confirm = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete rule' }))
    await waitFor(() => {
      expect(client.calls).toContain('remove:r-2')
    })
  })
})

describe('Alert log', () => {
  it('lists what each rule sent, filtered by rule from the URL', async () => {
    const { ui, client } = screenAt(ruleLogHash('r-1'))
    render(ui)
    const log = await screen.findByTestId('alert-log')
    expect(client.calls).toContain('log')
    expect(log.textContent).toContain('Target page no longer cited on 2 questions')
    expect(log.textContent).toContain('Desktop, 2 emails')
    expect(screen.getByRole('tab', { name: 'Alert log' }).getAttribute('aria-selected')).toBe(
      'true'
    )
  })
})

describe('Notifications', () => {
  it('saves every email address as a chip and tests Slack inline', async () => {
    const memory = createMemoryRulesClient({ slackReady: true })
    const { ui } = screenAt('#/alerts/notifications', memory)
    render(ui)
    fireEvent.click(await screen.findByRole('switch', { name: 'Email a summary after each check' }))
    const input = await screen.findByLabelText('Email to')
    fireEvent.change(input, { target: { value: 'ops@textbolt.com, sales@textbolt.com' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const chips = screen.getByTestId('n-email-chips')
    await waitFor(() => {
      expect(within(chips).getByRole('button', { name: 'Remove ops@textbolt.com' })).toBeTruthy()
    })
    expect(within(chips).getByRole('button', { name: 'Remove sales@textbolt.com' })).toBeTruthy()
    expect(screen.getByTestId('reports-link').textContent).toBe(
      'Scheduled report emails are in Reports.'
    )
    expect(screen.getByText('What you will get')).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: 'Post to Slack' }))
    const hook = await screen.findByLabelText('Slack webhook URL')
    fireEvent.change(hook, { target: { value: 'https://hooks.slack.com/services/T/B/fail' } })
    fireEvent.click(screen.getByTestId('slack-test'))
    const result = await screen.findByTestId('slack-test-result')
    expect(result.className).toContain('fail')
    expect(memory.calls.some((call) => call.startsWith('testSlack'))).toBe(true)
    expect(result.textContent).not.toContain('hooks.slack.com')
  })
})
