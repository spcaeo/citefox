/**
 * Drawers on the URL (Docs/DRAWER.md). An open drawer is `drawer=<id>` in the
 * hash query, followed by the values it owns; a drawer opened from a drawer
 * adds a second `drawer=`:
 *
 *   #/topics?sort=name&drawer=add-questions&target=t1&drawer=new-topic&step=questions
 *
 * The screen keeps its own values (`sort=name`); the route model never sees a
 * drawer's (shell/routes `screenParams`). This module is pure: it only reads
 * and writes hashes. `shell/drawers.ts` owns history (Back closes the top
 * drawer) and the open/close calls.
 */

/** The query key that opens a drawer. Repeated for a stacked drawer. */
export const DRAWER_PARAM = 'drawer'

/**
 * The key shell dialogs used before drawers (`?dialog=add-questions`). Old
 * links still open the drawer; the shell rewrites them to `drawer=` in place.
 */
export const LEGACY_DIALOG_PARAM = 'dialog'

/** A drawer opened from a drawer is the deepest a stack goes. */
export const MAX_DRAWER_DEPTH = 2

export interface DrawerKindSpec {
  /** The drawer's title: its last crumb, and the crumb a stacked drawer shows for it. */
  title: string
  /** Query keys the drawer owns. They leave the URL when it closes. */
  params: readonly string[]
  /** True when `?dialog=<id>` (the old shell dialog link) still opens it. */
  legacyDialog?: boolean
  /** Owned keys that belong to the screen instead while the named key is present. */
  yields?: Readonly<Record<string, string>>
  /**
   * Owned keys read only from the drawer's own part of the URL (after its
   * `drawer=`, before the next one). A screen or another drawer may use the same
   * key (`tab`, `topic`, `page`) without either taking the other's value.
   */
  positional?: readonly string[]
}

/**
 * Every drawer that can be on the URL. Add a row for a new drawer; its params
 * must not clash with another drawer's (a stack holds two different drawers).
 */
export const DRAWER_KINDS = {
  'add-questions': {
    title: 'Add questions',
    // `topic=<id>` or `page=<id>` is where the questions go (`target` is the old key);
    // `tab` is type | import | suggest | tracked; ✦ Help me write keeps its way and bot
    // (`help=describe|chatbot`, `bot=chatgpt`); ✦ Match pages is `match=1` with its own
    // way and bot (`mhelp=`, `mbot=`).
    params: ['target', 'topic', 'page', 'tab', 'help', 'bot', 'match', 'mhelp', 'mbot'],
    positional: ['topic', 'page', 'tab'],
    legacyDialog: true
  },
  /**
   * The shared importer's steps (deep audit crosscut §5): what is imported, where to, the
   * step, the result filter. ✦ Help me find them (a list with a helper kind) is
   * `import.help` (`1` open, or its way `describe|chatbot`) with `import.bot`.
   */
  import: {
    title: 'Import a file',
    params: [
      'import.entity',
      'import.target',
      'import.step',
      'import.f',
      'import.help',
      'import.bot'
    ]
  },
  /**
   * Add a page. Over Add questions it hands the address typed so far back (`addpage.url`,
   * `addpage.label`); on its own (tracking) it also owns the group or topic and how the
   * page gets questions (`claude` | `type`, count).
   */
  'add-page': {
    title: 'Add a page',
    params: [
      'addpage.url',
      'addpage.group',
      'addpage.topic',
      'addpage.label',
      'addpage.questions',
      'addpage.count'
    ]
  },
  'new-topic': {
    title: 'New topic',
    // "A buyer problem" keeps its ✦ Help me fill way and bot (`nt.help`, `nt.bot`).
    params: ['draft', 'step', 'way', 'questions', 'topic', 'nt.help', 'nt.bot'],
    legacyDialog: true,
    // A Topics row action (`action=rename&topic=<id>`) keeps its `topic`.
    yields: { topic: 'action' }
  },
  drill: {
    title: 'Rows behind this number',
    params: ['drill', 'drill.f', 'drill.q', 'drill.sort']
  },
  compare: {
    title: 'Compare content',
    params: ['read-from', 'read-to']
  },
  // Ask CiteFox over any screen (assistant/drawer): the question it starts
  // with and what it is about (`kind:id`, opaque ids only).
  ask: {
    title: 'Ask CiteFox',
    params: ['ask.q', 'ask.about']
  },
  // ---- Wave 3 (A1): page setup drawers (Prompts, Buyer profile, Content gaps, Prompt detail). ----
  /** Prompts tab: add a prompt of your own to the draft. */
  'pt-add': {
    title: 'Add my own question',
    params: []
  },
  /** Prompts tab: one prompt's wording in the draft: `pt.edit` = prompt id. */
  'pt-edit': {
    title: 'Edit question',
    params: ['pt.edit']
  },
  /** Prompts tab: Rephrase like a buyer: `pt.rephrase` = prompt id. */
  'pt-rephrase': {
    title: 'Rephrase like a buyer',
    params: ['pt.rephrase']
  },
  /** Prompts tab: prompt count and template (Write the prompts again). */
  'pt-settings': {
    title: 'Question settings',
    params: []
  },
  /** Prompt detail: Edit question (wording, Save only or Save and check now). */
  'pd-edit': {
    title: 'Edit question',
    params: []
  },
  /** Prompt detail: Check now, the prompt as it is. */
  'pd-recheck': {
    title: 'Check this question now',
    params: []
  },
  /** Buyer profile tab: every part as text. */
  'au-edit': {
    title: 'Edit buyer profile',
    params: []
  },
  /** Buyer profile tab: template and Regenerate. */
  'au-settings': {
    title: 'Profile settings',
    params: []
  },
  /** Content gaps tab: template and Write content gaps again. */
  'gp-settings': {
    title: 'Content gaps settings',
    params: []
  },
  // ---- Tracking and Your site (feat/tracking). Each drawer owns one key prefix. ----
  /** Check now scope: `check.scope` (scope/types ScopeKind), `check.ids`, markets, only-not-cited, picked prompts. */
  'check-now': {
    title: 'Check now',
    params: ['check.scope', 'check.ids', 'check.markets', 'check.only', 'check.prompts', 'check.q']
  },
  /** Check history: two checks side by side, results first (`cmp.tab=content` for the page diff). */
  'compare-checks': {
    title: 'Compare checks',
    params: ['cmp.a', 'cmp.b', 'cmp.tab']
  },
  /**
   * One report schedule: `schedule.id` (`new` for a new one), `schedule.mode` view|edit,
   * `schedule.from` (duplicate source), `schedule.q` (the scope picker's search). A new one
   * opened from Export starts from `schedule.project`, `schedule.scope` + `schedule.ids`,
   * `schedule.sec` (sections), `schedule.fmt` and `schedule.mk` (market). The Email preview's
   * "Write it in your own voice with my ChatGPT" is `schedule.help=chatbot` + `schedule.bot`.
   * `schedule.preset=impact14` starts the ready-made "Impact review every 14 days".
   * `schedule.report` (+ `schedule.rival` for Head-to-head) starts a schedule of one ready report.
   */
  schedule: {
    title: 'Report schedule',
    params: [
      'schedule.id',
      'schedule.mode',
      'schedule.from',
      'schedule.q',
      'schedule.project',
      'schedule.scope',
      'schedule.ids',
      'schedule.sec',
      'schedule.fmt',
      'schedule.mk',
      'schedule.help',
      'schedule.bot',
      'schedule.preset',
      'schedule.report',
      'schedule.rival'
    ]
  },
  /** One alert rule: `rule.id` (`new`), `rule.from` (duplicate source). */
  'alert-rule': {
    title: 'Alert rule',
    params: ['rule.id', 'rule.from', 'rule.q']
  },
  /** One cluster's pages: `cluster.id`, `cluster.tab`, `cluster.q`, `cluster.pick`. */
  cluster: {
    title: 'Cluster',
    params: ['cluster.id', 'cluster.tab', 'cluster.q', 'cluster.pick']
  },
  /** One group's pages: `group.id`, `group.q`, `group.pick`. */
  group: {
    title: 'Group',
    params: ['group.id', 'group.q', 'group.pick']
  },
  /**
   * Pick pages for a group or a cluster: `pick.for` (`group:<id>` | `cluster:<id>` | `cluster:new`),
   * `pick.q`, `pick.ids`, filters `pick.folder` and `pick.cluster`, and a new cluster's `pick.name`.
   */
  'pick-pages': {
    title: 'Add pages',
    params: ['pick.for', 'pick.q', 'pick.ids', 'pick.folder', 'pick.cluster', 'pick.name']
  },
  /**
   * Move or add pages: `move.ids` (page ids), `move.to` cluster|group, `move.q`, the picked
   * target `move.pick` (`new` for a new one), its `move.name`, and `move.from` (the cluster a split leaves).
   */
  'move-pages': {
    title: 'Move pages',
    params: ['move.ids', 'move.to', 'move.q', 'move.pick', 'move.name', 'move.from']
  },
  /** Rename a page (its label): `rename.id`. */
  'rename-page': {
    title: 'Rename page',
    params: ['rename.id']
  },
  // ---- Wave 3 (A2): History, Markets, Sentiment and YouTube drawers. ----
  /** One History event: `he.id` = event id; `he.note` = `edit` | `delete` for a note's action. */
  'hist-event': {
    title: 'Event',
    params: ['he.id', 'he.note']
  },
  /**
   * What changed on a page between two reads: `pc.id` = a page change id, or
   * `pc.page` + `pc.from` + `pc.to` (two versions, snapshot ids); `pc.view` = `side`
   * for side by side (inline is the default); `pc.all` = `1` for the whole page.
   */
  'page-change': {
    title: 'What changed',
    params: ['pc.id', 'pc.page', 'pc.from', 'pc.to', 'pc.view', 'pc.all']
  },
  /** Page changes nobody logged as a fix yet. */
  'page-changes': {
    title: 'Page changes',
    params: []
  },
  /** Add a note to the page's History. */
  'hist-note': {
    title: 'Add a note',
    params: []
  },
  /** One Sentiment answer: `sa.id` = overview (capture) id. */
  'st-answer': {
    title: 'Answer',
    params: ['sa.id']
  },
  /** One Sentiment theme's sentences: `sth.id` = an opaque key of the theme. */
  'st-theme': {
    title: 'Theme',
    params: ['sth.id']
  },
  // CRUD drawers (feat/crud). Values are opaque ids only (owner rule): never a
  // name, domain, email or URL. `new` stands for "create one".
  /** Edit one question: `question` = prompt id, `question.src` = its page or topic id. */
  question: {
    title: 'Edit question',
    params: ['question', 'question.src', 'question.tab']
  },
  /**
   * Move or copy questions to a topic or page: `mq.ids` = prompt ids, comma list
   * (`mq.`, so it never shares a key with Move pages' `move.`).
   */
  'move-questions': {
    title: 'Move questions',
    params: ['mq.ids', 'mq.mode']
  },
  /** One topic's settings (rename, pause, duplicate): `ts.topic` = topic id. */
  'topic-settings': {
    title: 'Topic settings',
    params: ['ts.topic']
  },
  /** Add, edit or merge competitors: `competitor` = row id or `new`. */
  competitor: {
    title: 'Edit competitor',
    params: ['competitor', 'competitor.mode', 'competitor.ids']
  },
  /**
   * A logged fix: `fix` = fix id or `new`; prefill from `fix.page`, `fix.prompts`,
   * `fix.from`, `fix.text` (a drafted description) and `fix.kind`; a page fix adds
   * `fix.also` (other sources' questions), `fix.url` (its page) and `fix.pf`; a page
   * change logged as a fix adds `fix.live` (go-live day). ✦ Help write it
   * keeps its way (`fix.help`), chatbot (`fix.bot`) and question (`fix.for`, a prompt id).
   */
  fix: {
    title: 'Fix',
    params: [
      'fix',
      'fix.mode',
      'fix.page',
      'fix.prompts',
      'fix.from',
      'fix.text',
      'fix.kind',
      'fix.also',
      'fix.url',
      'fix.pf',
      'fix.live',
      'fix.help',
      'fix.bot',
      'fix.for'
    ]
  },
  /**
   * Citations → "✦ Draft a pitch": an email to a site Google cites next to competitors
   * for one question. `pitch.row` = the cited page's opaque row id; `pitch.page` and
   * `pitch.prompt` = the question; ✦ keeps its way (`pitch.help`) and chatbot (`pitch.bot`).
   */
  pitch: {
    title: 'Draft a pitch',
    params: ['pitch.row', 'pitch.page', 'pitch.prompt', 'pitch.help', 'pitch.bot']
  },
  /** The page's settings, over any page tab: `ps.section` scrolls to a section. */
  'page-settings': {
    title: 'Page settings',
    params: ['ps.section']
  },
  // ---- Wave 3 (B): Overview, Questions and Topics drawers. ----
  /** A topic's target bands, over its results (the topic is the route's). */
  'topic-bands': {
    title: 'Target bands',
    params: []
  },
  /** Change target page over a topic's results: `tt.ids` = prompt ids, comma list. */
  'topic-target': {
    title: 'Change target page',
    params: ['tt.ids']
  },
  /** The topic's own target page, over its results (the topic is the route's). */
  'topic-page': {
    title: 'Target page',
    params: []
  },
  /**
   * The fix brief for some searches, over a topic's views or Questions: `tb.ids` = prompt
   * ids, comma list; `tb.title` = what they are ("Problem searches where you are not cited").
   */
  'topic-brief': {
    title: 'Fix brief',
    params: ['tb.ids', 'tb.title']
  },
  /**
   * The searches behind a count on a topic or on Questions (Grid, Tree, Pages, the result
   * bar), over the view it came from: the drill's filters (`stage=problem&result=not_cited`,
   * `kind=question|keyword`), with a `d.` prefix on Questions, whose List uses `result` and `source` itself. Read only
   * from the drawer's own part of the URL, so a screen value of the same name stays the
   * screen's (topics/views/url.ts).
   */
  'search-drill': {
    title: 'Searches',
    params: [
      'stage',
      'result',
      'work',
      'words',
      'page',
      'site',
      'source',
      'kind',
      'd.stage',
      'd.result',
      'd.work',
      'd.words',
      'd.page',
      'd.site',
      'd.source',
      'd.kind'
    ],
    positional: [
      'stage',
      'result',
      'work',
      'words',
      'page',
      'site',
      'source',
      'kind',
      'd.stage',
      'd.result',
      'd.work',
      'd.words',
      'd.page',
      'd.site',
      'd.source',
      'd.kind'
    ]
  },
  /**
   * One page fix over any screen (a topic's Get fix brief, Citations › Pages, Overview's
   * Next fixes), so the person keeps working where they are: `pfx.id` = the open fix,
   * `pfx.tab` = its tab (`edits`), `pfx.ids` = every fix a brief covers (comma list,
   * biggest first) when it covers more than one. Fixes keeps its own `?pf=` drawer.
   */
  'page-fix': {
    title: 'Page fix',
    params: ['pfx.id', 'pfx.tab', 'pfx.ids']
  },
  /** Topic folders: new (`tf.topics` = topic ids to move in), rename or move (`tf.folder`). */
  'topic-folder': {
    title: 'Folder',
    params: ['tf.mode', 'tf.folder', 'tf.topics']
  },
  /**
   * Add a market to the project or one page (`am.page`); ✦ Help me fill this keeps
   * its way and bot (`am.help=describe|chatbot`, `am.bot=chatgpt`).
   */
  'add-market': {
    title: 'Add market',
    params: ['am.page', 'am.help', 'am.bot']
  },
  /** Edit one content-gap FAQ draft: `gap` = coverage row id. */
  'gap-draft': {
    title: 'Edit FAQ draft',
    params: ['gap']
  },
  /** Buyer profile regenerate: the new profile side by side with the old. */
  'profile-diff': {
    title: 'Review the new buyer profile',
    params: ['pdiff']
  },
  /** Track a new page (from a picker's "+ New page…"). */
  'track-page': {
    title: 'Track a page',
    params: ['tp.from']
  },
  /**
   * Types of site (Sources' "Manage types…"): add, rename, recolour and delete the
   * project's own types. `st.new=1` opens on a new type (the Type menu's "+ New type…").
   */
  'site-types': {
    title: 'Types of site',
    params: ['st.new']
  },
  /** Add an API key (from a picker's "+ Add a key…"): `key.provider`. */
  'add-key': {
    title: 'Add an API key',
    params: ['key.provider']
  },
  // Moving to a new Mac (transfer/). A picked file is an opaque token main holds it under.
  /** Export one project: `ep.project` = project id, `ep.results=1` includes check results. */
  'export-project': {
    title: 'Export project',
    params: ['ep.project', 'ep.results']
  },
  /** Import a project file: `ip.file` = token, `ip.mode` new|replace, `ip.target` = project id. */
  'import-project': {
    title: 'Import project',
    params: ['ip.file', 'ip.mode', 'ip.target']
  },
  /** Import an app settings file: `is.file` = token. */
  'import-settings': {
    title: 'Import app settings',
    params: ['is.file']
  },
  /**
   * Report a problem (diagnostics/): the report text, a note, and ways to share it.
   * `rp.q=1` includes the question texts; `rp.project` = the project id the report reads.
   */
  'report-problem': {
    title: 'Report a problem',
    params: ['rp.q', 'rp.project']
  },
  // ---- Wave 3 (C): Start, Playground, Reports, Templates, Alerts and Build menu drawers. ----
  /** The Activity list over any screen: what CiteFox is doing now and did in this window. */
  activity: {
    title: 'Activity',
    params: []
  },
  /** Edit the buyer profile on Start › Your site is ready. */
  'start-buyers': {
    title: 'Edit the buyer profile',
    params: []
  },
  /** Save a playground run to a project: `pgs.run` = the run's id (runs live for this session). */
  'playground-save': {
    title: 'Save to project',
    params: ['pgs.run']
  },
  /** The playground gallery's demo drawer. */
  'gallery-drawer': {
    title: 'Cited questions',
    params: []
  },
  /**
   * A ready report's drill-down (src/renderer/src/reports/review): `rd` is the drill id
   * of the number, bar or row clicked. Its rows open `report-detail` over it.
   */
  'report-drill': {
    title: 'Behind this number',
    params: ['rd']
  },
  /** One more level: a question's answers, a site's or a page's questions (`rd2`). */
  'report-detail': {
    title: 'Details',
    params: ['rd2']
  },
  /** The guide drawer (src/renderer/src/guide): this screen's lesson, over any screen. */
  guide: {
    title: 'Guide',
    params: []
  },
  /** One help topic (Docs/help, src/renderer/src/help), over any screen: `help.id` = topic id. */
  help: {
    title: 'Help',
    params: ['help.id']
  }
} as const satisfies Readonly<Record<string, DrawerKindSpec>>

export type DrawerId = keyof typeof DRAWER_KINDS

export function isDrawerId(value: string | null | undefined): value is DrawerId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DRAWER_KINDS, value)
}

export function drawerKind(id: DrawerId): DrawerKindSpec {
  return DRAWER_KINDS[id]
}

/** One open drawer: its id and the values it owns. */
export interface DrawerEntry {
  id: DrawerId
  params: Readonly<Record<string, string>>
}

/** Values to set on a drawer; null or '' removes a key. */
export type DrawerParamPatch = Readonly<Record<string, string | null | undefined>>

interface SplitHash {
  path: string
  params: URLSearchParams
}

function split(hash: string): SplitHash {
  const plain = hash.startsWith('#') ? hash.slice(1) : hash
  const at = plain.indexOf('?')
  return at < 0
    ? { path: plain, params: new URLSearchParams() }
    : { path: plain.slice(0, at), params: new URLSearchParams(plain.slice(at + 1)) }
}

function join(path: string, params: URLSearchParams): string {
  const query = params.toString()
  return `#${path || '/'}${query ? `?${query}` : ''}`
}

function ownsKey(id: DrawerId, key: string, params: URLSearchParams): boolean {
  const spec: DrawerKindSpec = DRAWER_KINDS[id]
  if (!spec.params.includes(key)) return false
  const yieldTo = spec.yields?.[key]
  return yieldTo === undefined || !params.has(yieldTo)
}

function isPositional(id: DrawerId, key: string): boolean {
  return (DRAWER_KINDS[id] as DrawerKindSpec).positional?.includes(key) === true
}

/** The drawer ids in `params`, bottom first: `drawer=` values, else a legacy `dialog=`. */
function stackIds(params: URLSearchParams): { ids: DrawerId[]; legacy: boolean } {
  const ids: DrawerId[] = []
  for (const value of params.getAll(DRAWER_PARAM)) {
    if (isDrawerId(value) && !ids.includes(value)) ids.push(value)
    if (ids.length === MAX_DRAWER_DEPTH) break
  }
  if (ids.length > 0) return { ids, legacy: false }
  const legacy = params.get(LEGACY_DIALOG_PARAM)
  if (isDrawerId(legacy) && (DRAWER_KINDS[legacy] as DrawerKindSpec).legacyDialog) {
    return { ids: [legacy], legacy: true }
  }
  return { ids: [], legacy: false }
}

/** One query entry and the open drawer whose part of the URL it sits in (null: before any). */
interface PlacedEntry {
  key: string
  value: string
  segment: DrawerId | null
}

function placed(params: URLSearchParams, ids: readonly DrawerId[]): PlacedEntry[] {
  const out: PlacedEntry[] = []
  let segment: DrawerId | null = null
  params.forEach((value, key) => {
    if (key === DRAWER_PARAM) segment = isDrawerId(value) && ids.includes(value) ? value : null
    out.push({ key, value, segment })
  })
  return out
}

/**
 * The drawer that owns one query entry, or null when it is the screen's. A key
 * in a drawer's own part of the URL is that drawer's. Elsewhere a key goes to
 * an open drawer that owns it, unless that drawer reads it only from its own
 * part (`positional`) or the entry sits in another drawer's part that owns it.
 */
function ownerOf(
  entry: PlacedEntry,
  ids: readonly DrawerId[],
  params: URLSearchParams
): DrawerId | null {
  if (entry.segment !== null && ownsKey(entry.segment, entry.key, params)) return entry.segment
  for (const id of ids) {
    if (id === entry.segment || isPositional(id, entry.key)) continue
    if (ownsKey(id, entry.key, params)) return id
  }
  return null
}

function stackFrom(params: URLSearchParams): DrawerEntry[] {
  const { ids } = stackIds(params)
  const entries = placed(params, ids)
  return ids.map((id) => {
    const own: Record<string, string> = {}
    for (const entry of entries) {
      if (entry.value && entry.key !== DRAWER_PARAM && ownerOf(entry, ids, params) === id) {
        // The first value wins, as `URLSearchParams.get` reads it.
        if (!(entry.key in own)) own[entry.key] = entry.value
      }
    }
    return { id, params: own }
  })
}

/** The open drawers in `hash`, bottom first (at most two). */
export function drawerStack(hash: string): DrawerEntry[] {
  return stackFrom(split(hash).params)
}

/**
 * The query keys that belong to the drawers in `params` (each `drawer`, a
 * legacy `dialog` that opened one, and every open drawer's own values). A
 * positional key is listed only when no screen value of it remains; use
 * `screenQuery` for the screen's values.
 */
export function drawerOwnedKeys(params: URLSearchParams): ReadonlySet<string> {
  const { ids, legacy } = stackIds(params)
  const keys = new Set<string>([DRAWER_PARAM])
  if (legacy) keys.add(LEGACY_DIALOG_PARAM)
  const screenKeys = new Set(screenQuery(params).keys())
  for (const entry of placed(params, ids)) {
    if (ownerOf(entry, ids, params) !== null && !screenKeys.has(entry.key)) keys.add(entry.key)
  }
  return keys
}

/**
 * The screen's own query values: `params` without the drawers' (each `drawer`,
 * a legacy `dialog` that opened one, and every value an open drawer owns), in
 * their order. Opening a drawer never changes the route under it.
 */
export function screenQuery(params: URLSearchParams): URLSearchParams {
  const { ids, legacy } = stackIds(params)
  const next = new URLSearchParams()
  for (const entry of placed(params, ids)) {
    if (entry.key === DRAWER_PARAM) continue
    if (legacy && entry.key === LEGACY_DIALOG_PARAM) continue
    if (ownerOf(entry, ids, params) !== null) continue
    next.append(entry.key, entry.value)
  }
  return next
}

/** True when `hash` opens a drawer with the old `?dialog=` key. */
export function usesLegacyDialog(hash: string): boolean {
  return stackIds(split(hash).params).legacy
}

/**
 * `hash` with exactly `stack` open: the screen's own values stay in their
 * order, then each drawer as `drawer=<id>` followed by its values.
 */
export function withDrawerStack(hash: string, stack: readonly DrawerEntry[]): string {
  const { path, params } = split(hash)
  const next = screenQuery(params)
  for (const entry of stack.slice(0, MAX_DRAWER_DEPTH)) {
    next.append(DRAWER_PARAM, entry.id)
    for (const key of DRAWER_KINDS[entry.id].params) {
      const value = entry.params[key]
      if (value) next.append(key, value)
    }
  }
  return join(path, next)
}

/** `entry`'s values with `patch` applied (null or '' removes a key; unknown keys are dropped). */
function patched(entry: DrawerEntry, patch: DrawerParamPatch): DrawerEntry {
  const params: Record<string, string> = { ...entry.params }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || !(DRAWER_KINDS[entry.id].params as readonly string[]).includes(key))
      continue
    if (value === null || value === '') delete params[key]
    else params[key] = value
  }
  return { id: entry.id, params }
}

/**
 * Where opening drawer `id` goes from `hash`. It stacks over the open one; a
 * drawer already open becomes the top again with the new values; a full stack
 * swaps its top drawer.
 */
export function withDrawerOpened(
  hash: string,
  id: DrawerId,
  values: DrawerParamPatch = {}
): string {
  const stack = drawerStack(hash)
  const at = stack.findIndex((entry) => entry.id === id)
  const below = at >= 0 ? stack.slice(0, at) : stack.slice(0, MAX_DRAWER_DEPTH - 1)
  return withDrawerStack(hash, [...below, patched({ id, params: {} }, values)])
}

/** `hash` with the drawers from `depth` up closed (0 closes them all). */
export function withDrawersClosed(hash: string, depth: number): string {
  return withDrawerStack(hash, drawerStack(hash).slice(0, Math.max(0, depth)))
}

/** `hash` with the drawer at `depth` given new values. */
export function withDrawerParams(hash: string, depth: number, patch: DrawerParamPatch): string {
  const stack = drawerStack(hash)
  const entry = stack[depth]
  if (!entry) return hash
  return withDrawerStack(hash, [
    ...stack.slice(0, depth),
    patched(entry, patch),
    ...stack.slice(depth + 1)
  ])
}

/** The screen under the drawers: `hash` with none open. */
export function screenHash(hash: string): string {
  return withDrawerStack(hash, [])
}

/** True when both stacks hold the same drawers with the same values. */
export function sameStack(left: readonly DrawerEntry[], right: readonly DrawerEntry[]): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => {
      const other = right[index]
      if (!other || other.id !== entry.id) return false
      const keys = Object.keys(entry.params)
      return (
        keys.length === Object.keys(other.params).length &&
        keys.every((key) => entry.params[key] === other.params[key])
      )
    })
  )
}
