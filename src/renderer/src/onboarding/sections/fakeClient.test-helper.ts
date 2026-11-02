import { vi } from 'vitest'
import type {
  SetupDraft,
  SetupItem,
  SetupListId,
  SetupRow,
  SetupSectionId,
  SetupSectionResult
} from '@shared/ipc'
import type { SetupSectionClient } from '../sectionClient'
import { emptySetupDraft } from '../setupDraft'

/** Test-only: a fake section client (no IPC, no Claude) with spies. */
export interface FakeSectionOptions {
  available?: boolean
  /** Rows each sectionRun / sectionRead returns, per section. */
  rows?: Partial<Record<SetupSectionId, SetupRow[]>>
  text?: string | null
  warnings?: string[]
}

export function row(name: string, extra: Partial<SetupRow> = {}): SetupRow {
  return { name, detail: '', url: null, tag: null, ...extra }
}

export function fakeSectionClient(options: FakeSectionOptions = {}): SetupSectionClient & {
  sectionEstimate: ReturnType<typeof vi.fn>
  sectionPrompt: ReturnType<typeof vi.fn>
  sectionRun: ReturnType<typeof vi.fn>
  sectionRead: ReturnType<typeof vi.fn>
  finishSetup: ReturnType<typeof vi.fn>
} {
  const available = options.available ?? true
  const result = (section: SetupSectionId): SetupSectionResult => ({
    section,
    rows: options.rows?.[section] ?? [],
    text: options.text ?? null,
    warnings: options.warnings ?? []
  })
  return {
    sectionEstimate: vi.fn(async ({ section }: { section: SetupSectionId }) => ({
      kind: section,
      available,
      calls: available ? 1 : 0,
      costText: available ? '1 AI call · on your AI plan' : '',
      reason: available ? null : 'No AI is set up.'
    })),
    sectionPrompt: vi.fn(async ({ section }: { section: SetupSectionId }) => ({
      section,
      prompt: `Find more ${section} for this business.`,
      columns: ['name', 'detail'],
      webSearch: section === 'competitors'
    })),
    sectionRun: vi.fn(async ({ section }: { section: SetupSectionId }) => result(section)),
    sectionRead: vi.fn(async ({ section }: { section: SetupSectionId }) => result(section)),
    finishSetup: vi.fn(async () => {
      throw new Error('not in these tests')
    })
  }
}

let next = 0

export function item(name: string, extra: Partial<SetupItem> = {}): SetupItem {
  next += 1
  return {
    id: `t${next}`,
    name,
    detail: '',
    url: null,
    tag: null,
    origin: 'ai',
    kept: true,
    edited: false,
    fresh: false,
    ...extra
  }
}

/** A TextBolt-like draft after step 3's read. */
export function textboltDraft(
  lists: Partial<Record<SetupListId, SetupItem[]>> = {},
  extra: Partial<SetupDraft> = {}
): SetupDraft {
  const base = emptySetupDraft()
  return {
    ...base,
    site: {
      ...base.site,
      domain: 'textbolt.com',
      projectName: 'TextBolt',
      country: 'US',
      language: 'en'
    },
    readWay: 'claude',
    readDone: true,
    summary: 'Turns an email into a text message and sends replies back to the inbox.',
    lists: { ...base.lists, ...lists },
    ...extra
  }
}
