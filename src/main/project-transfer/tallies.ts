import {
  PROJECT_TRANSFER_SECTIONS,
  type ProjectImportSectionResult,
  type ProjectTransferSection
} from '@shared/ipc'
import { SECTION_LABELS } from './catalog'

type Outcome = 'skipped' | 'failed'

interface SectionTally {
  added: number
  skipped: number
  failed: number
  /** "skipped|question|same text as another question" → how many. */
  reasons: Map<string, number>
}

const MAX_NOTES = 4

/** Added, skipped and failed rows per part of the file, with their reasons. */
export class ImportTallies {
  private readonly sections = new Map<ProjectTransferSection, SectionTally>()

  private of(section: ProjectTransferSection): SectionTally {
    let tally = this.sections.get(section)
    if (tally === undefined) {
      tally = { added: 0, skipped: 0, failed: 0, reasons: new Map() }
      this.sections.set(section, tally)
    }
    return tally
  }

  added(section: ProjectTransferSection, count = 1): void {
    this.of(section).added += count
  }

  /**
   * A row that was left out. `counted` rows change the part's number; the rest
   * (a market wording, a page reading) only add a note.
   */
  left(
    section: ProjectTransferSection,
    outcome: Outcome,
    noun: string,
    reason: string,
    counted: boolean
  ): void {
    const tally = this.of(section)
    if (counted) tally[outcome] += 1
    const key = `${outcome}|${noun}|${reason}`
    tally.reasons.set(key, (tally.reasons.get(key) ?? 0) + 1)
  }

  /** Keeps the skipped and failed rows; the added counts start again (a merge adds its own). */
  withoutAdded(): ImportTallies {
    const next = new ImportTallies()
    for (const [section, tally] of this.sections) {
      next.sections.set(section, { ...tally, added: 0, reasons: new Map(tally.reasons) })
    }
    return next
  }

  results(present: ReadonlySet<ProjectTransferSection>): ProjectImportSectionResult[] {
    return PROJECT_TRANSFER_SECTIONS.filter(
      (section) => present.has(section) || this.sections.has(section)
    ).map((section) => {
      const tally = this.sections.get(section)
      return {
        section,
        label: SECTION_LABELS[section],
        added: tally?.added ?? 0,
        skipped: tally?.skipped ?? 0,
        failed: tally?.failed ?? 0,
        notes: tally ? notes(tally.reasons) : []
      }
    })
  }
}

function notes(reasons: ReadonlyMap<string, number>): string[] {
  return [...reasons.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_NOTES)
    .map(([key, count]) => {
      const [outcome, noun, reason] = key.split('|')
      const word = outcome === 'failed' ? 'not added' : 'skipped'
      return `${count} ${count === 1 ? noun : plural(noun ?? '')} ${word}: ${reason}`
    })
}

function plural(noun: string): string {
  if (noun.endsWith('y') && !/[aeiou]y$/.test(noun)) return `${noun.slice(0, -1)}ies`
  if (noun.endsWith('s')) return noun
  return `${noun}s`
}
