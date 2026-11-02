import { describe, expect, it } from 'vitest'
import { formatClock } from '../utils/dates'
import {
  UNENCRYPTED_MAIL_WARNING,
  accountIssues,
  connectionSubtitle,
  draftForProvider,
  draftFromAccount,
  emptyAccountDraft,
  explainAlertsError,
  nextCheckLabel,
  passwordHint,
  providerSummary,
  quietIssue,
  securityWarning,
  spreadHint,
  wallClock,
  toSaveRequest,
  guideFor,
  projectScheduleNote,
  closedHint,
  platformFromUserAgent
} from './model'
import type { EmailAccountRow } from './model'

const SECRET = 'placeholder-not-a-secret'

describe('SMTP security warning', () => {
  it('warns that mail and the password are unencrypted when security is none', () => {
    expect(securityWarning('none')).toBe(UNENCRYPTED_MAIL_WARNING)
    expect(UNENCRYPTED_MAIL_WARNING).toContain('mail')
    expect(UNENCRYPTED_MAIL_WARNING).toContain('password')
    expect(UNENCRYPTED_MAIL_WARNING).toContain('unencrypted')
  })

  it('stays quiet for STARTTLS and SSL/TLS', () => {
    expect(securityWarning('starttls')).toBeNull()
    expect(securityWarning('ssl')).toBeNull()
  })
})

describe('email account draft', () => {
  it('requires a password only when creating an account', () => {
    const created = emptyAccountDraft('gmail')
    expect(accountIssues(created).password).toMatch(/keychain/)
    const editing = draftFromAccount(gmailRow())
    expect(accountIssues({ ...editing, password: '' }).password).toBeUndefined()
  })

  it('never puts the password on the save payload when the field is blank', () => {
    const request = toSaveRequest({ ...draftFromAccount(gmailRow()), password: '' })
    expect(request.password).toBeNull()
    expect(JSON.stringify(request)).not.toContain(SECRET)
    const withSecret = toSaveRequest({ ...emptyAccountDraft('gmail'), password: SECRET })
    expect(withSecret.password).toBe(SECRET)
    expect('password' in { ...gmailRow() }).toBe(false)
  })

  it('fills host, port, and security from the provider preset', () => {
    const draft = draftForProvider('sendgrid', {
      fromName: 'CiteFox reports',
      fromAddress: 'reports@textbolt.com',
      replyTo: ''
    })
    expect(draft.provider).toBe('sendgrid')
    expect(draft.host).toBe('smtp.sendgrid.net')
    expect(draft.port).toBe('587')
    expect(draft.security).toBe('starttls')
    expect(draft.username).toBe('apikey')
    expect(draft.fromAddress).toBe('reports@textbolt.com')
    expect(draft.password).toBe('')
    expect(providerSummary('gmail')).toBe('smtp.gmail.com · 587 · STARTTLS')
    expect(providerSummary('other')).toBe('Settings from your provider')
  })

  it('matches the mock-up connection subtitles', () => {
    expect(connectionSubtitle(draftFromAccount(gmailRow()))).toBe(
      'Editing your default account, Gmail · you@textbolt.com.'
    )
    expect(connectionSubtitle(draftFromAccount(sesRow()))).toBe(
      'Editing Amazon SES · reports@textbolt.com, used for Acme Clinics client reports.'
    )
    expect(
      connectionSubtitle(emptyAccountDraft('mailgun')).startsWith('New account: Mailgun')
    ).toBe(true)
  })

  it('tells an edit to leave the password blank', () => {
    expect(passwordHint(guideFor('gmail'), true)).toContain('leave blank to keep it')
    expect(passwordHint(guideFor('gmail'), false)).toContain('system keychain')
  })
})

describe('schedule copy', () => {
  const now = new Date('2026-10-20T15:00:00.000Z')

  it('shows today, the due count, and the 30-day follow-on', () => {
    // Nine in Chicago, in the computer's own clock style ("9:00 AM" or "09:00").
    const nine = formatClock('2026-10-20T14:00:00.000Z', { timeZone: 'America/Chicago' })
    expect(nine).toMatch(/^0?9:00(\sAM)?$/)
    expect(
      nextCheckLabel({
        paused: false,
        intervalDays: 14,
        nextCheckAt: '2026-10-20T14:00:00.000Z',
        pagesDueToday: 14,
        now,
        timeZone: 'America/Chicago'
      })
    ).toBe(`Today ${nine} · 14 pages due`)
    expect(
      nextCheckLabel({
        paused: false,
        intervalDays: 30,
        nextCheckAt: '2026-10-20T14:00:00.000Z',
        pagesDueToday: 14,
        now,
        timeZone: 'America/Chicago'
      })
    ).toBe(`Today ${nine} · 14 pages due, then each page 30 days after its last check`)
  })

  it('says there is no check while the project is paused', () => {
    expect(
      nextCheckLabel({
        paused: true,
        intervalDays: 14,
        nextCheckAt: '2026-10-20T14:00:00.000Z',
        pagesDueToday: 0,
        now,
        timeZone: 'UTC'
      })
    ).toBe('None while this project is paused')
  })

  it('uses the mock-up spread sentence for 14 pages at 09:00', () => {
    expect(spreadHint(14, '09:00')).toBe(
      `Runs today's 14 due pages in small batches from ${wallClock('09:00')} instead of all at once, so other projects and your search rate limit get room.`
    )
  })

  it('accepts a quiet window only when both clocks are set or both are blank', () => {
    expect(quietIssue('', '')).toBeNull()
    expect(quietIssue('22:00', '07:00')).toBeNull()
    expect(quietIssue('22:00', '')).toMatch(/both/)
  })
})

describe('explainAlertsError', () => {
  it('strips the invoke wrapper and hides any echoed password', () => {
    expect(
      explainAlertsError(
        new Error("Error invoking remote method 'email:getSettings': Error: The engine is busy.")
      )
    ).toEqual({
      reason: 'The engine is busy.',
      nextStep: null
    })
    const leaked = explainAlertsError(new Error(`rejected ${SECRET}`), SECRET)
    expect(leaked.reason).toBe('Something went wrong. Try again.')
    expect(JSON.stringify(leaked)).not.toContain(SECRET)
    expect(JSON.stringify(leaked)).not.toContain('Error invoking remote method')
  })
})

function gmailRow(): EmailAccountRow {
  return {
    id: 'acct-gmail',
    provider: 'gmail',
    fromName: 'CiteFox reports',
    fromAddress: 'you@textbolt.com',
    replyTo: null,
    host: 'smtp.gmail.com',
    port: 587,
    security: 'starttls',
    username: 'you@textbolt.com',
    keychainRef: 'email/acct-gmail',
    isDefault: true,
    lastTestAt: '2026-10-19T15:00:00.000Z',
    lastTestOk: true,
    lastTestMessage: null,
    lastTestNextStep: null,
    usedFor: null
  }
}

function sesRow(): EmailAccountRow {
  return {
    ...gmailRow(),
    id: 'acct-ses',
    provider: 'ses',
    fromAddress: 'reports@textbolt.com',
    host: 'email-smtp.us-east-1.amazonaws.com',
    username: 'ses-smtp-user',
    isDefault: false,
    usedFor: 'Acme Clinics client reports'
  }
}

describe('projectScheduleNote', () => {
  it('names each of the user’s projects and nothing else', () => {
    const note = projectScheduleNote([
      { projectId: 'a', name: 'Harbor Dental', intervalDays: 14, time: '09:00', paused: false },
      { projectId: 'b', name: 'Northwind', intervalDays: 30, time: '06:00', paused: true }
    ])
    expect(note).toContain(
      `Harbor Dental every 14 days at ${wallClock('09:00')}, Northwind paused.`
    )
    expect(note).not.toContain('TextBolt')
    expect(note).not.toContain('Acme')
  })

  it('keeps the app-wide sentence when there are no projects', () => {
    const note = projectScheduleNote([])
    expect(note).toContain('set once in App settings › General')
    expect(note).not.toContain('every')
  })
})

describe('closedHint', () => {
  it('says what each system really adds, and that turning it off removes it', () => {
    expect(closedHint('mac')).toContain('Login Items')
    expect(closedHint('windows')).toContain('Task Scheduler')
    expect(closedHint('linux')).toContain('systemd')
    for (const platform of ['mac', 'windows', 'linux', 'other'] as const) {
      expect(closedHint(platform)).toMatch(/turn(ing)? this off removes it/i)
      expect(closedHint(platform)).not.toMatch(/lock|unlock|gate/i)
    }
  })

  it('reads the platform from the user agent', () => {
    expect(platformFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)')).toBe('mac')
    expect(platformFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows')
    expect(platformFromUserAgent('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux')
    expect(platformFromUserAgent('Mozilla/5.0 (Unknown)')).toBe('other')
  })
})
