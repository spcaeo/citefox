import type { ProjectTransferSection } from '@shared/ipc'

/**
 * Which project tables travel in a `.citefox-project.json` file, the part of the
 * file each belongs to, and how a duplicate is recognised. Tables not listed here
 * never travel: caches, job queues, logs, drafts, and anything tied to this Mac.
 */

export type Value = string | number | null
export type Row = Record<string, Value>

/** What the key and count rules may look at besides the row itself. */
export interface RowContext {
  /** Prompt sets marked active: their questions are the ones the project asks. */
  activeSets: ReadonlySet<string>
  /** Question id → its wording in lower case without punctuation (first market). */
  questionText: ReadonlyMap<string, string>
}

/** Ids that a duplicate hands over to the existing row (merge only). */
export type IdMapKind = 'market' | 'page' | 'product' | 'group' | 'cluster'

export interface TablePolicy {
  table: string
  section: ProjectTransferSection | ((row: Row) => ProjectTransferSection)
  /** Singular noun for result notes. */
  noun: string | ((row: Row) => string)
  /** True when the row counts toward its part's number. */
  counts?: (row: Row, context: RowContext) => boolean
  /** Two rows with the same key are the same thing. Null: never a duplicate. */
  key?: (row: Row, context: RowContext) => string | null
  /** The one-row settings tables (`id = 1`). */
  singleton?: boolean
  /** Values that belong to this Mac (key ids, keychain refs, timers): written as given. */
  local?: Readonly<Record<string, Value>>
  /** Links to stored checks, cleared when check results are left out. */
  resultLinks?: Readonly<Record<string, Value>>
  /** Columns of raw provider JSON: credential fields are removed on export. */
  raw?: readonly string[]
  idMap?: IdMapKind
}

const always = (): boolean => true

function lower(value: Value | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : String(value ?? '')
}

/** Lower case, no punctuation, single spaces: "How do I…?" equals "how do i". */
export function plainText(value: Value | undefined): string {
  return lower(value)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** `https://www.Example.com/a/` → `example.com/a`, so the same page is one page. */
export function normalUrl(value: Value | undefined): string {
  const text = lower(value)
  return text
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^www\./, '')
    .replace(/#.*$/, '')
    .replace(/\/+$/, '')
}

/** A domain as people type it: `HTTPS://www.Acme.com/` → `acme.com`. */
export function normalDomain(value: string): string {
  return normalUrl(value).split('/')[0] ?? ''
}

function isTopic(row: Row): boolean {
  return row.kind === 'topic'
}

const SETTINGS_ROW = { section: 'settings' as const, singleton: true, counts: always }

/** Every table that travels. The order here does not matter: inserts follow foreign keys. */
export const TABLE_POLICIES: readonly TablePolicy[] = [
  // ---- Settings: one row each. ----
  { ...SETTINGS_ROW, table: 'project_settings', noun: 'site and brand setting' },
  {
    ...SETTINGS_ROW,
    table: 'project_options',
    noun: 'Claude and sample setting',
    local: { claude_key_id: null, claude_fallback_key_id: null }
  },
  {
    ...SETTINGS_ROW,
    table: 'project_schedule',
    noun: 'schedule',
    local: { dedicated_key_id: null, next_check_at: null, pages_due_today: 0 }
  },
  {
    ...SETTINGS_ROW,
    table: 'alert_settings',
    noun: 'notification setting',
    // The Slack webhook is a keychain item and the email account is this Mac's.
    local: { slack_enabled: 0, slack_keychain_ref: null, email_account_id: null }
  },
  { ...SETTINGS_ROW, table: 'community_settings', noun: 'community setting' },
  { ...SETTINGS_ROW, table: 'engine_settings', noun: 'engine setting' },
  {
    ...SETTINGS_ROW,
    table: 'sitemap_settings',
    noun: 'sitemap setting',
    local: { last_sync_at: null }
  },
  {
    table: 'template_overrides',
    section: 'settings',
    noun: 'template version',
    key: (row) => `${lower(row.kind)}:${String(row.version)}`
  },
  // ---- Markets. ----
  {
    table: 'markets',
    section: 'markets',
    noun: 'market',
    counts: always,
    idMap: 'market',
    key: (row) =>
      [lower(row.country), lower(row.language), lower(row.location), lower(row.device)].join('|')
  },
  // ---- Pages and topics (a topic is a page row of kind `topic`). ----
  {
    table: 'pages',
    section: (row) => (isTopic(row) ? 'topics' : 'pages'),
    noun: (row) => (isTopic(row) ? 'topic' : 'page'),
    counts: always,
    idMap: 'page',
    resultLinks: { score: null },
    key: (row) => (isTopic(row) ? `topic:${plainText(row.label)}` : `url:${normalUrl(row.url)}`)
  },
  {
    table: 'page_markets',
    section: 'pages',
    noun: 'page market',
    resultLinks: { baseline_run_id: null, last_checked_at: null }
  },
  { table: 'snapshots', section: 'pages', noun: 'page reading' },
  { table: 'page_engines', section: 'pages', noun: 'page engine choice' },
  { table: 'sitemaps', section: 'pages', noun: 'sitemap', key: (row) => normalUrl(row.url) },
  { table: 'topics', section: 'topics', noun: 'topic setting' },
  // ---- Questions. ----
  { table: 'prompt_sets', section: 'questions', noun: 'question set' },
  {
    table: 'prompts',
    section: 'questions',
    noun: 'question',
    counts: (row, context) => context.activeSets.has(String(row.prompt_set_id)),
    key: (row, context) => {
      const text = context.questionText.get(String(row.id))
      return text ? `${String(row.prompt_set_id)}:${text}` : null
    }
  },
  { table: 'prompt_variants', section: 'questions', noun: 'question wording' },
  { table: 'topic_prompts', section: 'questions', noun: 'topic question detail' },
  { table: 'prompt_lineage', section: 'questions', noun: 'question history row' },
  { table: 'brand_prompts', section: 'questions', noun: 'brand prompt' },
  // ---- Buyer profile. ----
  { table: 'buyer_profiles', section: 'buyerProfile', noun: 'buyer profile', counts: always },
  {
    table: 'buyer_context',
    section: 'buyerProfile',
    noun: 'buyer detail',
    counts: always,
    key: (row) => `${lower(row.kind)}|${plainText(row.name)}`
  },
  // ---- Competitors (the project's list is in project_settings; see competitors.ts). ----
  {
    table: 'product_competitors',
    section: 'competitors',
    noun: 'product competitor',
    counts: always,
    key: (row) =>
      `${String(row.product_id ?? '')}|${
        row.domain !== null && row.domain !== undefined
          ? normalDomain(String(row.domain))
          : plainText(row.name)
      }`
  },
  {
    table: 'site_kinds',
    section: 'competitors',
    noun: 'site kind',
    key: (row) => lower(row.domain)
  },
  // ---- Products. ----
  {
    table: 'products',
    section: 'products',
    noun: 'product',
    counts: always,
    idMap: 'product',
    key: (row) => plainText(row.name)
  },
  // ---- Groups and clusters. ----
  {
    table: 'groups',
    section: 'groups',
    noun: 'group',
    counts: always,
    idMap: 'group',
    key: (row) => plainText(row.name)
  },
  { table: 'group_pages', section: 'groups', noun: 'group page' },
  {
    table: 'clusters',
    section: 'groups',
    noun: 'cluster',
    counts: always,
    idMap: 'cluster',
    key: (row) => plainText(row.name)
  },
  { table: 'cluster_pages', section: 'groups', noun: 'cluster page' },
  { table: 'silos', section: 'groups', noun: 'site section', key: (row) => lower(row.path) },
  // ---- Alert rules. ----
  {
    table: 'alert_rules',
    section: 'alertRules',
    noun: 'alert rule',
    counts: always,
    key: (row) => plainText(row.name)
  },
  // ---- Notes, fixes and other things people wrote. ----
  { table: 'notes', section: 'notes', noun: 'note', counts: always },
  {
    table: 'fixes',
    section: 'notes',
    noun: 'fix',
    counts: always,
    resultLinks: { followup_run_id: null, followup_job_id: null }
  },
  { table: 'fix_prompts', section: 'notes', noun: 'fix question' },
  {
    table: 'brand_facts',
    section: 'notes',
    noun: 'brand fact',
    counts: always,
    key: (row) => plainText(row.text)
  },
  { table: 'gap_states', section: 'notes', noun: 'content gap mark' },
  {
    table: 'saved_views',
    section: 'notes',
    noun: 'saved view',
    key: (row) => `${lower(row.grid)}|${plainText(row.name)}`
  },
  {
    table: 'ignored_cited_urls',
    section: 'notes',
    noun: 'ignored citation',
    key: (row) => lower(row.normalized_url)
  },
  { table: 'video_ideas', section: 'notes', noun: 'video idea', counts: always },
  // ---- Stored check results (only with "Include stored check results"). ----
  { table: 'check_jobs', section: 'results', noun: 'check job' },
  { table: 'runs', section: 'results', noun: 'check', counts: always },
  {
    table: 'serp_results',
    section: 'results',
    noun: 'search result',
    local: { key_id: null },
    raw: ['raw_search_json', 'raw_aio_json']
  },
  { table: 'aio_references', section: 'results', noun: 'AI Overview link' },
  {
    table: 'engine_answers',
    section: 'results',
    noun: 'engine answer',
    local: { key_id: null },
    raw: ['raw_json']
  },
  { table: 'engine_sources', section: 'results', noun: 'engine source' },
  { table: 'overview_reads', section: 'results', noun: 'overview reading' },
  { table: 'generations', section: 'results', noun: 'Claude run' },
  { table: 'analyses', section: 'results', noun: 'analysis' },
  { table: 'coverage_runs', section: 'results', noun: 'content gap run' },
  { table: 'coverage_rows', section: 'results', noun: 'content gap row' },
  { table: 'coverage_findings', section: 'results', noun: 'content gap finding' },
  {
    table: 'brand_captures',
    section: 'results',
    noun: 'brand answer',
    local: { key_id: null },
    raw: ['raw_search_json', 'raw_aio_json']
  },
  { table: 'sentiment_reads', section: 'results', noun: 'sentiment reading' },
  { table: 'claims', section: 'results', noun: 'brand claim' },
  { table: 'topic_summaries', section: 'results', noun: 'topic summary' },
  { table: 'answer_shapes', section: 'results', noun: 'answer shape' }
]

const BY_TABLE: ReadonlyMap<string, TablePolicy> = new Map(
  TABLE_POLICIES.map((policy) => [policy.table, policy])
)

export function policyFor(table: string): TablePolicy | undefined {
  return BY_TABLE.get(table)
}

export function sectionOf(policy: TablePolicy, row: Row): ProjectTransferSection {
  return typeof policy.section === 'function' ? policy.section(row) : policy.section
}

export function nounOf(policy: TablePolicy, row: Row): string {
  return typeof policy.noun === 'function' ? policy.noun(row) : policy.noun
}

/** Tables of the results part. */
export function isResultTable(table: string): boolean {
  return policyFor(table)?.section === 'results'
}

/** Labels the preview and result lists use. */
export const SECTION_LABELS: Readonly<Record<ProjectTransferSection, string>> = {
  settings: 'Project settings',
  markets: 'Markets',
  pages: 'Pages',
  topics: 'Topics',
  questions: 'Questions',
  buyerProfile: 'Buyer profile',
  competitors: 'Competitors',
  products: 'Products',
  groups: 'Groups and clusters',
  alertRules: 'Alert rules',
  reportSchedules: 'Report schedules',
  notes: 'Notes, fixes and brand facts',
  results: 'Stored check results'
}

/** Prompt sets marked active and each question's wording, for the key and count rules. */
export function rowContext(tables: Readonly<Record<string, readonly Row[]>>): RowContext {
  const activeSets = new Set(
    (tables.prompt_sets ?? []).filter((row) => row.is_active === 1).map((row) => String(row.id))
  )
  const questionText = new Map<string, string>()
  for (const row of tables.prompt_variants ?? []) {
    const id = String(row.prompt_id)
    if (!questionText.has(id)) questionText.set(id, plainText(row.text))
  }
  return { activeSets, questionText }
}
