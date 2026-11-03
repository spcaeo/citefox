import { describe, expect, it } from 'vitest'
import { DIAGNOSTICS_EMAIL, DIAGNOSTICS_ISSUES_URL } from './ipc/diagnostics'
import {
  PASTE_HINT,
  reportIssueUrl,
  reportMailtoUrl,
  reportShortBody,
  reportSubject
} from './problem-report'

const RELEASE = 'v0.13.2 · build 1424 · Nov 2, 2026 8:49 AM EST'

describe('problem report links', () => {
  it('builds a short subject from the note and the release', () => {
    expect(reportSubject(RELEASE, '')).toBe(`CiteFox problem report (${RELEASE})`)
    expect(reportSubject(RELEASE, 'Checks fail')).toBe(
      `CiteFox problem report: Checks fail (${RELEASE})`
    )
    expect(reportSubject(RELEASE, 'word '.repeat(50)).length).toBeLessThan(140)
  })

  it('keeps the body short and tells the person to paste', () => {
    const body = reportShortBody('a'.repeat(5000), RELEASE)
    expect(body.length).toBeLessThan(900)
    expect(body).toContain(PASTE_HINT)
    expect(reportShortBody('', RELEASE)).toContain('please describe it here')
  })

  it('opens a mail to CiteFox and a new GitHub issue, both short enough for a link', () => {
    const mail = reportMailtoUrl(RELEASE, 'x'.repeat(3000))
    expect(mail.startsWith(`mailto:${DIAGNOSTICS_EMAIL}?subject=`)).toBe(true)
    expect(mail.length).toBeLessThan(2000)
    const issue = reportIssueUrl(RELEASE, 'x'.repeat(3000))
    expect(issue.startsWith(`${DIAGNOSTICS_ISSUES_URL}?title=`)).toBe(true)
    expect(issue.length).toBeLessThan(2000)
    expect(new URL(issue).searchParams.get('body')).toContain(PASTE_HINT)
  })
})
