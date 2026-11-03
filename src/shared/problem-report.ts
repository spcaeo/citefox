/**
 * The two "send it" links of Report a problem. A link cannot carry a whole report (a
 * mail link and a GitHub address both have a size limit), so each carries a short
 * body only. The full report is copied to the clipboard first and the person pastes it.
 */

import { DIAGNOSTICS_EMAIL, DIAGNOSTICS_ISSUES_URL } from './ipc/diagnostics'

/** Longest short body, in characters, before it is cut. */
export const SHORT_BODY_MAX = 600

/** The paste hint the short body ends with. */
export const PASTE_HINT = 'Paste the full report below this line (it is already copied):'

function firstWords(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`
}

/** "Problem report: <what happened, short> (v0.13.2 · build 1424)". */
export function reportSubject(release: string, note: string): string {
  const what = firstWords(note, 60)
  return `CiteFox problem report${what ? `: ${what}` : ''} (${release})`
}

/** A short body: the note's first lines, then the paste hint. */
export function reportShortBody(note: string, release: string): string {
  const what = firstWords(note, SHORT_BODY_MAX)
  return [
    what ? `What happened: ${what}` : 'What happened: (please describe it here)',
    `CiteFox: ${release}`,
    '',
    PASTE_HINT,
    ''
  ].join('\n')
}

/** `mailto:` to the CiteFox address with a short subject and body. */
export function reportMailtoUrl(release: string, note: string): string {
  const subject = encodeURIComponent(reportSubject(release, note))
  const body = encodeURIComponent(reportShortBody(note, release))
  return `mailto:${DIAGNOSTICS_EMAIL}?subject=${subject}&body=${body}`
}

/** A new GitHub issue with a title and a short body. */
export function reportIssueUrl(release: string, note: string): string {
  const title = encodeURIComponent(reportSubject(release, note))
  const body = encodeURIComponent(reportShortBody(note, release))
  return `${DIAGNOSTICS_ISSUES_URL}?title=${title}&body=${body}`
}
