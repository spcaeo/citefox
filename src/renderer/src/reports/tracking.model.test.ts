import { describe, expect, it } from 'vitest'
import type { AlertSettings, AutoExport } from '@shared/domain'
import type { ProjectDetail } from '@shared/ipc'
import {
  ALL_PROJECTS_CHOICE,
  buildSchedule,
  copyName,
  draftIssues,
  duplicateDraft,
  emailProblem,
  emptyDraft,
  mailPreview,
  nextSendLine,
  type ScheduleDraft
} from './scheduleModel'
import { sampleSchedules } from './scheduleFixtures'
import {
  deliveryHash,
  readScheduleDrawer,
  reportFormatFor,
  scheduleSeedParams
} from './schedules/utils/scheduleUrl'
import { defaultExportForm, type ExportForm } from './export/model'
import {
  formFromUrl,
  marketFromUrl,
  pushesHistory,
  urlPatch,
  type ExportUrl
} from './export/utils/urlState'
import { reportScopeOf, resolveExportScope, scheduleSeed } from './export/utils/scope'
import { sendRows, sendsCountLine } from './sends/sendsModel'
import type { ScopeOptions } from '../scope'

const LONDON = 'Europe/London'
/** Thursday Oct 22, 2026, 10:00 in London. */
const NOW = new Date('2026-10-22T09:00:00Z')

function draft(overrides: Partial<ScheduleDraft> = {}): ScheduleDraft {
  return {
    ...emptyDraft(LONDON),
    name: 'Weekly client report',
    projectId: 'harbor',
    recipients: ['ana@harbor.example'],
    ...overrides
  }
}

function url(values: Partial<ExportUrl> = {}): ExportUrl {
  return {
    scope: null,
    ids: null,
    page: null,
    fmt: null,
    sec: null,
    mk: null,
    market: null,
    win: null,
    from: null,
    to: null,
    pq: null,
    ...values
  }
}

describe('schedule drafts', () => {
  it('checks names, recipients, sections and picks before saving', () => {
    expect(draftIssues(draft())).toBeNull()
    expect(draftIssues(draft({ name: ' ' }))).toBe('Name this schedule.')
    expect(draftIssues(draft({ recipients: [] }))).toBe('Add at least one recipient.')
    expect(draftIssues(draft({ format: 'pdf', sections: [] }))).toMatch(/Pick at least one section/)
    expect(draftIssues(draft({ format: 'summary', sections: [] }))).toBeNull()
    expect(draftIssues(draft({ recipients: ['ana@harbor.example', 'nobody'] }))).toMatch(/nobody/)
    expect(draftIssues(draft({ scope: { kind: 'group', ids: [] } }))).toMatch(/Pick/)
  })

  it('validates each address on its own', () => {
    expect(emailProblem('ana@harbor.example')).toBeNull()
    expect(emailProblem(' ana@harbor.example ')).toBeNull()
    expect(emailProblem('ana@harbor')).toBe('Not an email address')
    expect(emailProblem('harbor.example')).toBe('Not an email address')
  })

  it('stores a scope only when it narrows one project', () => {
    const group = buildSchedule(draft({ scope: { kind: 'group', ids: ['g1'] } }), 's1', 'c')
    expect(group.scope).toEqual({ kind: 'group', ids: ['g1'] })
    expect(buildSchedule(draft(), 's1', 'c').scope).toBeNull()
    const all = buildSchedule(
      draft({ projectId: null, scope: { kind: 'pages', ids: ['p1'] } }),
      's1',
      'c'
    )
    expect(all.scope).toBeNull()
  })

  it('duplicates as "Copy of …" with the same settings', () => {
    const source = sampleSchedules()[0]!
    const copy = duplicateDraft(source)
    expect(copy.name).toBe(`Copy of ${source.name}`)
    expect(copy.recipients).toEqual(source.recipients)
    expect(copyName('Copy of Weekly')).toBe('Copy of Weekly')
  })

  it('says when the next send is, in the schedule zone', () => {
    expect(nextSendLine(draft({ trigger: 'weekly', day: 1, time: '08:00' }), NOW)).toBe(
      'Next send Mon, Oct 26, 08:00 (Europe/London)'
    )
    expect(nextSendLine(draft({ trigger: 'after_check' }), NOW)).toMatch(/after the next/)
  })

  it('previews one email per project for all projects, and the scope for one', () => {
    expect(ALL_PROJECTS_CHOICE).toBe('All my projects (one email each)')
    const all = mailPreview(draft({ projectId: null }), 'All my projects', '', 'Default sender')
    expect(all.greeting).toBe(
      'Each project gets its own email, in its default market. Here’s the latest for that project:'
    )
    expect(all.greeting).not.toContain('no market')
    const one = mailPreview(draft(), 'Harbor', 'CA · EN', 'Default sender', 'Money pages')
    expect(one.greeting).toBe('Here’s the latest for Harbor · Money pages (CA · EN):')
  })
})

describe('schedule drawer URL', () => {
  it('reads a new schedule seeded from Export', () => {
    const params = scheduleSeedParams({
      projectId: 'harbor',
      scope: { kind: 'group', ids: ['g1', 'g2'] },
      sections: ['overview', 'trends'],
      format: 'pdf',
      marketIds: ['ca-en']
    })
    const state = readScheduleDrawer(params)
    expect(state).toMatchObject({ id: 'new', mode: 'edit', from: null })
    expect(state.seed).toMatchObject({
      projectId: 'harbor',
      scope: { kind: 'group', ids: ['g1', 'g2'] },
      format: 'pdf',
      marketIds: ['ca-en']
    })
    expect(state.seed.sections).toContain('overview')
  })

  it('opens a stored schedule in view or edit, and a duplicate from its source', () => {
    expect(readScheduleDrawer({ 'schedule.id': 's1' }).mode).toBe('view')
    expect(readScheduleDrawer({ 'schedule.id': 's1', 'schedule.mode': 'edit' }).mode).toBe('edit')
    expect(readScheduleDrawer({ 'schedule.id': 'new', 'schedule.from': 's1' })).toMatchObject({
      id: 'new',
      mode: 'edit',
      from: 's1'
    })
    expect(reportFormatFor('xlsx')).toBe('excel')
    expect(reportFormatFor('json')).toBe('pdf')
    expect(deliveryHash('d 1')).toBe('#/reports?view=history&delivery=d%201')
  })
})

describe('export settings on the URL', () => {
  const base = (): ExportForm => defaultExportForm(new Date('2026-10-22T12:00:00'))

  it('reads every field and falls back on unknown values', () => {
    const form = formFromUrl(
      url({
        scope: 'group',
        ids: 'g1,g2',
        fmt: 'pdf',
        sec: 'overview',
        win: 'range',
        from: '2026-10-01',
        to: 'bad'
      }),
      base()
    )
    expect(form.scope).toBe('group')
    expect(form.ids).toEqual(['g1', 'g2'])
    expect(form.format).toBe('pdf')
    expect(form.sections.overview).toBe(true)
    expect(form.sections.trends).toBe(false)
    expect(form.from).toBe('2026-10-01')
    expect(form.to).toBe(base().to)
    expect(formFromUrl(url({ scope: 'nope', fmt: 'doc' }), base())).toMatchObject({
      scope: 'page',
      format: 'html'
    })
    expect(formFromUrl(url({ scope: 'project', ids: 'g1' }), base()).ids).toEqual([])
  })

  it('writes defaults as missing keys, and only scope, format and window add history', () => {
    expect(urlPatch({ scope: 'page' })).toEqual({ scope: null, ids: null })
    expect(urlPatch({ scope: 'topic', ids: ['t1'] })).toEqual({ scope: 'topic', ids: 't1' })
    expect(urlPatch({ format: 'html' })).toEqual({ fmt: null })
    expect(urlPatch({ checks: 'latest' })).toEqual({ win: null, from: null, to: null })
    expect(pushesHistory({ scope: 'group' })).toBe(true)
    expect(pushesHistory({ from: '2026-10-01' })).toBe(false)
    expect(marketFromUrl(url({ market: 'ca-en' }))).toBe('ca-en')
    expect(marketFromUrl(url({ mk: 'us-en', market: 'ca-en' }))).toBe('us-en')
  })
})

describe('export scope', () => {
  const options: ScopeOptions = {
    projectId: 'harbor',
    domain: 'harbor.example',
    pages: ['p1', 'p2', 'p3'].map((id) => ({
      id,
      url: `https://harbor.example/${id}`,
      label: id,
      folder: null,
      status: 'tracked' as const,
      tracked: true,
      groupIds: id === 'p3' ? [] : ['g1'],
      clusterIds: [],
      marketIds: [],
      promptCount: 0,
      samples: 1,
      nextCheckAt: null,
      score: null,
      pageCited: null,
      aioPrompts: null
    })),
    groups: [{ id: 'g1', name: 'Money pages', kind: 'group', count: 2 }],
    clusters: [],
    topics: [],
    views: [],
    markets: [],
    defaultMarketId: null,
    searchesLeft: null
  }

  it('resolves only pick kinds; page and project resolve in main', () => {
    const form = { ...defaultExportForm(), scope: 'project' as const }
    expect(resolveExportScope(form, options)).toEqual([])
    expect(resolveExportScope({ ...form, scope: 'pages', ids: ['p1', 'p2'] }, options)).toEqual([
      'p1',
      'p2'
    ])
    expect(resolveExportScope({ ...form, scope: 'group', ids: ['g1'] }, options)).toEqual([
      'p1',
      'p2'
    ])
    expect(resolveExportScope({ ...form, scope: 'pages', ids: ['p1'] }, null)).toEqual([])
  })

  it('turns the export scope into the schedule scope and seed', () => {
    const form = defaultExportForm()
    const context = { pageId: 'p1', pageIsTopic: false, resolved: [] as string[] }
    expect(reportScopeOf(form, context)).toEqual({ kind: 'pages', ids: ['p1'] })
    expect(reportScopeOf(form, { ...context, pageIsTopic: true })).toEqual({
      kind: 'topic',
      ids: ['p1']
    })
    expect(
      reportScopeOf({ ...form, scope: 'view', ids: ['v1'] }, { ...context, resolved: ['a', 'b'] })
    ).toEqual({
      kind: 'pages',
      ids: ['a', 'b']
    })
    expect(reportScopeOf({ ...form, scope: 'group', ids: [] }, context)).toEqual({
      kind: 'project',
      ids: []
    })
    const seed = scheduleSeed(
      { ...form, scope: 'group', ids: ['g1'], format: 'xlsx' },
      { projectId: 'harbor', ...context, hasTopic: false, market: 'ca-en' }
    )
    expect(seed).toMatchObject({
      'schedule.id': 'new',
      'schedule.project': 'harbor',
      'schedule.scope': 'group',
      'schedule.ids': 'g1',
      'schedule.fmt': 'excel',
      'schedule.mk': 'ca-en'
    })
    expect(seed['schedule.sec']).not.toContain('raw')
  })
})

describe('All sends', () => {
  const project = { id: 'harbor', name: 'Harbor' } as ProjectDetail
  const alerts: AlertSettings = {
    projectId: 'harbor',
    desktop: true,
    emailAfterCheck: true,
    emailAccountId: null,
    emailTo: ['ops@harbor.example'],
    slackEnabled: false,
    slackWebhookStored: true,
    monthlyClientPdf: true,
    monthlyPdfTo: 'client@harbor.example'
  }
  const auto = {
    projectId: 'harbor',
    pageId: null,
    enabled: false,
    destination: 'folder',
    folder: '/Users/me/Reports',
    emailTo: null,
    spec: null,
    runs: []
  } as unknown as AutoExport

  it('lists schedules, then each project’s alerts, Slack and automatic export', () => {
    const items = sampleSchedules().slice(0, 1)
    const rows = sendRows(
      items,
      [{ projectId: 'harbor', alerts, auto, problem: null }],
      [project],
      []
    )
    expect(rows.map((row) => row.kind)).toEqual([
      'schedule',
      'after_check',
      'monthly_pdf',
      'slack',
      'auto_export'
    ])
    expect(rows[0]?.where.href).toContain('drawer=schedule')
    expect(rows[1]).toMatchObject({ to: 'ops@harbor.example', on: true, project: 'Harbor' })
    expect(rows[1]?.where.href).toContain('/alerts/notifications')
    expect(rows[2]).toMatchObject({ to: 'client@harbor.example', when: '1st of each month' })
    expect(rows[3]).toMatchObject({ on: false, to: 'Slack channel (webhook saved)' })
    expect(rows[4]).toMatchObject({ to: '/Users/me/Reports', on: false })
    expect(rows[4]?.where.href).toContain('/export')
    expect(sendsCountLine(rows)).toBe(`3 of 5 sends on`)
  })

  it('skips a project whose settings could not be read', () => {
    const rows = sendRows(
      [],
      [{ projectId: 'harbor', alerts: null, auto: null, problem: 'x' }],
      [project],
      []
    )
    expect(rows).toEqual([])
  })
})
