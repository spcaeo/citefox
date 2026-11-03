import { releaseLine } from '@shared/release-line'
import type { FailedCheckSummary } from './failed-checks'

/** What the report says about the computer and the app. All plain facts, no secrets. */
export interface ReportFacts {
  madeAt: Date
  app: {
    name: string
    version: string
    buildNumber: number | null
    builtAt: string | null
    commit: string | null
  }
  system: {
    platform: string
    arch: string
    osRelease: string
    electron: string
    node: string
    chrome: string
    locale: string
    timeZone: string
  }
  ai: AiFacts
  keys: readonly KeyFacts[]
  failures: FailedCheckSummary | null
  includeQuestions: boolean
  note: string
  log: readonly string[]
  logTailLines: number
}

export interface AiFacts {
  /** The connection chosen in Settings, by the product's own name. */
  connection: string
  /** The program's file name only (never its folder), or null when found automatically. */
  programFile: string | null
  /** Last checkup of that program, or null when none was run. */
  checkup: {
    /** The program that checkup ran (it may differ from the connection chosen now). */
    program: string
    ranAt: string
    ready: boolean
    login: string
    roundTrip: string
    version: string | null
    message: string
  } | null
}

export interface KeyFacts {
  label: string
  /** A key of this kind is saved and switched on. */
  configured: boolean
  /** Its last state (`ok`, `warning`, `off`, `unchecked`), or null with no key. */
  state: string | null
  /** The stored reason code of the last failure, or null. */
  reason: string | null
}

const yesNo = (value: boolean): string => (value ? 'yes' : 'no')

function heading(title: string): string {
  return `\n## ${title}`
}

/** The report as plain text. Pure: the same facts give the same text. */
export function formatReport(facts: ReportFacts): string {
  const { app, system, ai } = facts
  const out: string[] = []
  out.push('CiteFox problem report')
  out.push(`Made: ${facts.madeAt.toISOString()}`)
  out.push(
    'Nothing here was sent anywhere by CiteFox. Keys, email addresses, your home folder and IP addresses are removed.'
  )

  out.push(heading('What happened'))
  out.push(facts.note.trim().length > 0 ? facts.note.trim() : '(nothing written)')

  out.push(heading('App'))
  out.push(
    `Release: ${releaseLine({ version: app.version, number: app.buildNumber, builtAt: app.builtAt })}`
  )
  out.push(`Name: ${app.name}`)
  out.push(`Version: ${app.version}`)
  out.push(`Build number: ${app.buildNumber ?? 'unknown'}`)
  out.push(`Built at (UTC): ${app.builtAt ?? 'unknown'}`)
  out.push(`Commit: ${app.commit ?? 'unknown'}`)

  out.push(heading('Computer'))
  out.push(`System: ${system.platform} ${system.arch}, version ${system.osRelease}`)
  out.push(`Electron: ${system.electron}`)
  out.push(`Chromium: ${system.chrome}`)
  out.push(`Node: ${system.node}`)
  out.push(`Language: ${system.locale}`)
  out.push(`Time zone: ${system.timeZone}`)

  out.push(heading('AI program'))
  out.push(`Connection: ${ai.connection}`)
  out.push(`Program file: ${ai.programFile ?? 'found automatically'}`)
  if (ai.checkup === null) {
    out.push('Last checkup: none yet')
  } else {
    out.push(`Last checkup: ${ai.checkup.ranAt} (${ai.checkup.program})`)
    out.push(`Ready: ${yesNo(ai.checkup.ready)}`)
    out.push(`Signed in: ${ai.checkup.login}`)
    out.push(`Test question: ${ai.checkup.roundTrip}`)
    out.push(`Program version: ${ai.checkup.version ?? 'unknown'}`)
    out.push(`Message: ${ai.checkup.message}`)
  }

  out.push(heading('Keys (yes or no only, never the key)'))
  for (const key of facts.keys) {
    const detail = key.configured
      ? `yes, ${key.state ?? 'unchecked'}${key.reason ? `, last problem: ${key.reason}` : ''}`
      : 'no'
    out.push(`${key.label}: ${detail}`)
  }

  out.push(heading('Recent failed checks'))
  if (facts.failures === null) {
    out.push('(not read)')
  } else if (facts.failures.recent.length === 0) {
    out.push('No failed checks are stored.')
  } else {
    out.push('Counts by engine and reason:')
    for (const item of facts.failures.counts) {
      out.push(`- ${item.engine}: ${item.code} x ${item.count}`)
    }
    out.push('')
    out.push(`Latest ${facts.failures.recent.length}, newest first:`)
    for (const item of facts.failures.recent) {
      const question =
        facts.includeQuestions && item.question ? ` | question: ${item.question}` : ''
      out.push(
        `- ${item.at} | ${item.engine} | ${item.code} | ${item.message || '(no message)'}${question}`
      )
    }
    if (facts.failures.unreadable > 0) {
      out.push(`(${facts.failures.unreadable} project file(s) could not be read)`)
    }
  }
  out.push(
    facts.includeQuestions
      ? 'Question texts: included, because you ticked the box.'
      : 'Question texts: not included.'
  )

  out.push(heading(`Log (last ${facts.logTailLines} lines)`))
  out.push(facts.log.length > 0 ? facts.log.join('\n') : '(the log is empty)')
  out.push('')
  return out.join('\n')
}
