import { isFixKind, type FixKind, type FixRecheckRule, type LoggedFix } from '@shared/domain'
import { isHelpFillBot, isHelpFillWay, type HelpFillBot, type HelpFillWay } from '@shared/helpfill'
import type { GapSuggestion, UpdateFixRequest } from '@shared/ipc'
import { localMidnightIso, todayInput } from '../../progress/model'
import type { DrawerParamPatch } from '../../shell/drawerUrl'

/**
 * The `fix` drawer's URL and form, pure. `fix` is a fix id or `new`; `fix.mode=edit`
 * edits it. A new fix is prefilled from `fix.page` (a page or topic id), `fix.prompts`
 * (comma prompt ids), `fix.kind` (`new_page`, `rewrite` or `fix`, the default),
 * `fix.text` (a drafted description, "Plan as Fix N") and `fix.from` (a content-gap
 * suggestion id: its "what to change" becomes the description). A page fix (What to
 * fix) adds `fix.also` (comma ids of the other pages and topics whose questions it
 * carries, listed and ticked too), `fix.url` (the page address when `fix.page` is a
 * topic) and `fix.pf` (the page fix's id, so its drawer says "Live since …").
 * `fix.live` is the go-live day (`yyyy-mm-dd`: a page change logged as a fix, else
 * today).
 */

export type FixDrawerMode = 'new' | 'view' | 'edit'

export interface FixDrawerParams {
  mode: FixDrawerMode
  /** Null when logging a new fix. */
  fixId: string | null
  pageId: string | null
  promptIds: string[]
  from: string | null
  /** The kind a new fix starts with. */
  kind: FixKind
  /** A drafted description for a new fix ("" when none). */
  text: string
  /** Other pages and topics whose questions the new fix carries. */
  also: string[]
  /** The page address the new fix is about, when its subject is a topic. */
  url: string | null
  /** The What to fix page fix it is logged from. */
  pageFixId: string | null
  /** The go-live day a new fix starts with (`yyyy-mm-dd`), or null for today. */
  liveOn: string | null
  /** ✦ Help write it: the way (`fix.help`), the chatbot (`fix.bot`), the question (`fix.for`). */
  help: HelpFillWay | null
  bot: HelpFillBot | null
  forPromptId: string | null
}

/** The longest drafted description a link carries. */
export const FIX_TEXT_MAX = 1500

export const NEW_FIX = 'new'

/**
 * `fix.from` when Pages' "Is this a fix?" opens Log a fix: every question of that
 * page starts ticked, since the change was made to the whole page.
 */
export const FROM_PAGE_CHANGE = 'page-change'

export const FIX_RULES: readonly FixRecheckRule[] = [
  'after_3_days',
  'after_7_days',
  'next_scheduled'
]

function ids(value: string | undefined): string[] {
  return [
    ...new Set(
      (value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ]
}

export function fixParamsFrom(params: Readonly<Record<string, string>>): FixDrawerParams {
  const value = params.fix ?? NEW_FIX
  const pageId = params['fix.page'] || null
  const from = params['fix.from'] || null
  const kind = isFixKind(params['fix.kind']) ? params['fix.kind'] : 'fix'
  const help = {
    help: isHelpFillWay(params['fix.help']) ? params['fix.help'] : null,
    bot: isHelpFillBot(params['fix.bot']) ? params['fix.bot'] : null,
    forPromptId: params['fix.for'] || null
  }
  if (value === NEW_FIX) {
    return {
      mode: 'new',
      fixId: null,
      pageId,
      promptIds: ids(params['fix.prompts']),
      from,
      kind,
      text: (params['fix.text'] ?? '').slice(0, FIX_TEXT_MAX),
      also: ids(params['fix.also']).filter((id) => id !== pageId),
      url: params['fix.url'] || null,
      pageFixId: params['fix.pf'] || null,
      liveOn:
        localMidnightIso(params['fix.live'] ?? '') === null ? null : (params['fix.live'] ?? null),
      ...help
    }
  }
  return {
    mode: params['fix.mode'] === 'edit' ? 'edit' : 'view',
    fixId: value,
    pageId: null,
    promptIds: [],
    from: null,
    kind: 'fix',
    text: '',
    also: [],
    url: null,
    pageFixId: null,
    liveOn: null,
    ...help
  }
}

export interface FixPrefill {
  pageId?: string | null
  promptIds?: readonly string[]
  from?: string | null
  kind?: FixKind | null
  /** A drafted description. */
  text?: string | null
  /** Other pages and topics whose questions are ticked too. */
  also?: readonly string[]
  /** The page address, when the subject is a topic. */
  url?: string | null
  /** The What to fix page fix it is logged from. */
  pageFixId?: string | null
  /** The go-live day, `yyyy-mm-dd` in local time. */
  liveOn?: string | null
}

export function newFixValues(prefill: FixPrefill = {}): DrawerParamPatch {
  return {
    fix: NEW_FIX,
    'fix.page': prefill.pageId ?? null,
    'fix.prompts':
      prefill.promptIds && prefill.promptIds.length > 0 ? prefill.promptIds.join(',') : null,
    'fix.from': prefill.from ?? null,
    'fix.kind': prefill.kind && prefill.kind !== 'fix' ? prefill.kind : null,
    'fix.text': prefill.text?.trim().slice(0, FIX_TEXT_MAX) || null,
    'fix.also': prefill.also && prefill.also.length > 0 ? prefill.also.join(',') : null,
    'fix.url': prefill.url || null,
    'fix.pf': prefill.pageFixId || null,
    'fix.live': prefill.liveOn ?? null
  }
}

export function viewFixValues(fixId: string): DrawerParamPatch {
  return { fix: fixId }
}

export function editFixValues(fixId: string): DrawerParamPatch {
  return { fix: fixId, 'fix.mode': 'edit' }
}

export interface FixForm {
  description: string
  /** New page, rewrite or fix (the Changes ledger). */
  kind: FixKind
  /** The go-live day, `yyyy-mm-dd` in local time. */
  goLive: string
  rule: FixRecheckRule
  promptIds: string[]
  marketIds: string[]
}

/** A new fix: today, re-checked 3 days after, every market of the subject. */
export function newForm(
  now: Date,
  prefill: {
    promptIds: readonly string[]
    marketIds: readonly string[]
    description: string
    kind?: FixKind
    /** `yyyy-mm-dd`; today when absent. */
    goLive?: string | null
  }
): FixForm {
  return {
    description: prefill.description,
    kind: prefill.kind ?? 'fix',
    goLive: prefill.goLive ?? todayInput(now),
    rule: 'after_3_days',
    promptIds: [...prefill.promptIds],
    marketIds: [...prefill.marketIds]
  }
}

export function formForFix(fix: LoggedFix): FixForm {
  return {
    description: fix.description,
    kind: fix.kind,
    goLive: todayInput(new Date(fix.goLiveAt)),
    rule: fix.rule,
    promptIds: [...fix.promptIds],
    marketIds: [...fix.marketIds]
  }
}

/** The description a suggestion prefills: what to change, with the main gap under it. */
export function suggestionText(gap: GapSuggestion | undefined): string {
  if (gap === undefined) return ''
  const what = gap.whatToUpdate.trim()
  const why = gap.mainGap.trim()
  return why && why !== what ? `${what}\n\n${why}` : what
}

/** Once the follow-up started or ran, what it checked is history: only the words change. */
export function planLocked(fix: LoggedFix): boolean {
  return fix.status !== 'planned' || fix.followUpJobId !== null || fix.followUpRunId !== null
}

/** The first thing to fix before saving, or null. */
export function formError(form: FixForm, hasSubject: boolean): string | null {
  if (!hasSubject) return 'Pick the page or topic you changed.'
  if (form.description.trim().length === 0) return 'Describe what you changed first.'
  if (form.promptIds.length === 0) return 'Pick at least one question this fix should help.'
  if (form.marketIds.length === 0) return 'Pick at least one market.'
  if (localMidnightIso(form.goLive) === null) return 'Pick the day the change goes live.'
  return null
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join(',') === [...right].sort().join(',')
}

/**
 * Only what changed; null when nothing did. A locked fix sends the description and
 * the kind only (the kind is a label: it never re-plans the follow-up).
 */
export function updateRequest(
  projectId: string,
  fix: LoggedFix,
  form: FixForm
): UpdateFixRequest | null {
  const request: { -readonly [K in keyof UpdateFixRequest]: UpdateFixRequest[K] } = {
    projectId,
    fixId: fix.id
  }
  if (form.description.trim() !== fix.description.trim()) request.description = form.description
  if (form.kind !== fix.kind) request.kind = form.kind
  if (!planLocked(fix)) {
    const goLiveAt = localMidnightIso(form.goLive)
    if (goLiveAt !== null && form.goLive !== todayInput(new Date(fix.goLiveAt))) {
      request.goLiveAt = goLiveAt
    }
    if (form.rule !== fix.rule) request.rule = form.rule
    if (!sameList(form.promptIds, fix.promptIds)) request.promptIds = form.promptIds
    if (!sameList(form.marketIds, fix.marketIds)) request.marketIds = form.marketIds
  }
  return Object.keys(request).length > 2 ? request : null
}

export function sameForm(left: FixForm, right: FixForm): boolean {
  return (
    left.description.trim() === right.description.trim() &&
    left.kind === right.kind &&
    left.goLive === right.goLive &&
    left.rule === right.rule &&
    sameList(left.promptIds, right.promptIds) &&
    sameList(left.marketIds, right.marketIds)
  )
}

export function toggled(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}
