import { DEFAULT_INTERVAL_DAYS, type EngineId } from '@shared/domain'
import {
  DEFAULT_PROMPT_MIX,
  SETUP_LISTS,
  type SetupContext,
  type SetupDraft,
  type SetupItem,
  type SetupListId,
  type SetupRow
} from '@shared/ipc'
import { DEFAULT_COUNTRY, DEFAULT_LANGUAGE } from './markets'

/**
 * Step 7 starts with Google AI Overview ticked only (owner, 2026-11-01). ChatGPT and
 * the other engines stay in the list, unticked.
 */
export const SETUP_DEFAULT_ENGINES: readonly EngineId[] = ['google_aio']

/** Onboarding v2: the setup before anything is typed. */
export function emptySetupDraft(): SetupDraft {
  const lists = Object.fromEntries(SETUP_LISTS.map((id) => [id, []])) as unknown as Record<
    SetupListId,
    readonly SetupItem[]
  >
  return {
    site: {
      domain: '',
      projectName: '',
      userName: '',
      country: DEFAULT_COUNTRY,
      countryCode: '',
      language: DEFAULT_LANGUAGE,
      languageCode: '',
      location: ''
    },
    readWay: null,
    readDone: false,
    summary: '',
    summaryOrigin: 'ai',
    lists,
    topic: '',
    topicOrigin: 'ai',
    prompts: {},
    search: {
      provider: 'cloro',
      engines: [...SETUP_DEFAULT_ENGINES],
      everyDays: DEFAULT_INTERVAL_DAYS
    },
    mix: DEFAULT_PROMPT_MIX,
    questionsMix: null
  }
}

/** The row Claude sees for an item (the card's own fields dropped). */
export function rowOf(item: SetupItem): SetupRow {
  return {
    name: item.name,
    detail: item.detail,
    url: item.url,
    tag: item.tag,
    ...(item.tier !== undefined ? { tier: item.tier } : {})
  }
}

/** The ticked rows of one list. */
export function keptRows(draft: SetupDraft, list: SetupListId): SetupRow[] {
  return draft.lists[list].filter((item) => item.kept).map(rowOf)
}

/** What Claude knows about the business so far: the kept rows of every section. */
export function contextFromDraft(draft: SetupDraft): SetupContext {
  const names = (list: SetupListId): string[] => keptRows(draft, list).map((row) => row.name)
  return {
    domain: draft.site.domain.trim(),
    country: draft.site.country === 'other' ? draft.site.countryCode : draft.site.country,
    language: draft.site.language === 'other' ? draft.site.languageCode : draft.site.language,
    summary: draft.summary,
    brands: names('brands'),
    products: keptRows(draft, 'products'),
    buyers: keptRows(draft, 'buyers'),
    triggers: names('triggers'),
    competitors: keptRows(draft, 'competitors'),
    switchingFrom: names('switchingFrom'),
    integrations: names('integrations'),
    topic: draft.topic,
    mix: draft.mix
  }
}

/**
 * The draft's project rules as section request fields (`rules`), or none: every
 * section run after a "Save as a project rule" carries them.
 */
export function rulesOf(draft: SetupDraft): { rules?: readonly string[] } {
  return draft.rules && draft.rules.length > 0 ? { rules: draft.rules } : {}
}
