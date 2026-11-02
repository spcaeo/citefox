/**
 * Every Claude step as the template editor lists it (FR-26.1), and the settings
 * a template may carry (FR-26.3).
 *
 * Lookups take a plain string and fall back to a generic description, so a kind
 * another area adds to `GENERATION_TEMPLATE_KINDS` lists, edits, and resolves
 * without a change here. Add it to {@link TEMPLATE_STEP_ORDER} and
 * {@link TEMPLATE_KIND_INFO} to give it its place in run order and its copy.
 */

import { ASSISTANT_TEMPLATE_INFO, ASSISTANT_TEMPLATE_KINDS } from './assistant-templates'
import { isOneOf } from './one-of'

/** Run order of the Claude steps. A kind not listed here sorts after these, by name. */
export const TEMPLATE_STEP_ORDER: readonly string[] = [
  'buyer_profile',
  'buyer_prompts',
  'brand_prompts',
  'coverage',
  'coverage_matrix',
  'page_audit',
  'coverage_fixes',
  'aio_gap',
  'answer_shape',
  'sentiment_claims',
  'sentiment_claims_v2',
  'sentiment_fact_check',
  'video_brief',
  'run_summary',
  'topic_seed_discover',
  'topic_buyer_profile',
  'topic_profile_discover',
  'topic_profile_discover_v2',
  'topic_profile_rewrite',
  'topic_journey_questions',
  'topic_questions_discover',
  'topic_keyword_terms',
  'topic_keyword_expand',
  'topic_keyword_competitor',
  'topic_page_match',
  'topic_page_brief',
  'topic_target_suggest',
  'topic_questions_cleanup',
  'competitor_page_questions',
  'competitor_page_questions_v2',
  'competitor_page_claims',
  'topic_summary',
  'topic_next_actions',
  'topic_why_not_cited',
  'topic_explain_citation',
  'topic_citation_diagnosis',
  'topic_fix_draft',
  'topic_page_edit',
  'topic_owner_why',
  'topic_cluster_suggest',
  'topic_cluster_sort',
  'topic_cluster_name',
  ...ASSISTANT_TEMPLATE_KINDS
]

/** FR-26.3 tones. `search_short` is never offered for buyer prompts (the method writes long questions). */
export const TEMPLATE_TONES = ['plain', 'conversational', 'search_short'] as const

export type TemplateTone = (typeof TEMPLATE_TONES)[number]

export const TEMPLATE_TONE_LABEL: Readonly<Record<TemplateTone, string>> = {
  plain: 'Plain',
  conversational: 'Conversational',
  search_short: 'Search-style short'
}

/** Fixed output languages the editor offers. Null on {@link TemplateSettings.language} is the market's. */
export const TEMPLATE_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'it', label: 'Italian' },
  { code: 'nl', label: 'Dutch' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ja', label: 'Japanese' }
] as const

/** Named models the editor offers besides "Default" (the model set in Settings). */
export const TEMPLATE_MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'] as const

/** Most prompts one template run may be asked to write. */
export const TEMPLATE_PROMPT_COUNT_MAX = 30

/**
 * Settings on one template version (FR-26.3). Every field null means "use the default":
 * the model in Settings, the market's language, the page's prompt count, the template's own tone.
 */
export interface TemplateSettings {
  /** Null uses the model set in Settings (LLM-5). Otherwise a model id. */
  model: string | null
  /** Null writes in the market's language. Otherwise a language code. */
  language: string | null
  /** Null uses the page's prompt count. 1 to {@link TEMPLATE_PROMPT_COUNT_MAX}. */
  promptCount: number | null
  /** Null keeps the wording the template asks for. */
  tone: TemplateTone | null
}

export const DEFAULT_TEMPLATE_SETTINGS: TemplateSettings = {
  model: null,
  language: null,
  promptCount: null,
  tone: null
}

/** Which settings apply to a kind (FR-26.3 "where they apply"). Model always applies. */
export interface TemplateSettingFlags {
  language: boolean
  promptCount: boolean
  /** Tones offered. Empty when tone does not apply. */
  tones: readonly TemplateTone[]
}

export interface TemplateKindInfo {
  /** Step name in the run-order list. */
  label: string
  /** File name the mock-up shows for this step. */
  file: string
  description: string
  /** One line about the output fields. */
  schemaLabel: string
  settings: TemplateSettingFlags
  /** Plural noun for saved artifacts this kind writes, used in usage lines. */
  usageNoun: readonly [string, string]
}

const PROMPT_WRITER: TemplateSettingFlags = {
  language: true,
  promptCount: true,
  tones: ['plain', 'conversational']
}

const ANALYSIS: TemplateSettingFlags = { language: true, promptCount: false, tones: [] }

/** Copy and settings per kind. A kind missing here gets {@link templateKindInfo}'s fallback. */
export const TEMPLATE_KIND_INFO: Readonly<Record<string, TemplateKindInfo>> = {
  buyer_profile: {
    label: 'Buyer profile',
    file: 'icp.md',
    description:
      'Describes who reads the page and buys from it. Runs once per page, and again if the page changes a lot.',
    schemaLabel: 'One object with six parts',
    settings: { language: true, promptCount: false, tones: ['plain', 'conversational'] },
    usageNoun: ['buyer profile', 'buyer profiles']
  },
  buyer_prompts: {
    label: 'Buyer questions',
    file: 'buyer_prompts.md',
    description:
      'Writes the buyer questions CiteFox checks in Google. Prompts are long situational questions and never contain your brand names.',
    schemaLabel: 'A list of prompts, one object each',
    settings: PROMPT_WRITER,
    usageNoun: ['prompt set', 'prompt sets']
  },
  brand_prompts: {
    label: 'Brand questions',
    file: 'brand_prompts.md',
    description:
      'Writes prompts that name your brand. Used only for sentiment, never in the visibility score.',
    schemaLabel: 'A list of brand prompts',
    settings: { language: true, promptCount: true, tones: [...TEMPLATE_TONES] },
    usageNoun: ['brand prompt set', 'brand prompt sets']
  },
  coverage: {
    label: 'Content gaps',
    file: 'gap_matrix.md',
    description:
      'Rates how well the page answers each prompt, with what is there now, what to update and a new FAQ draft. Reruns only when the page content changed.',
    schemaLabel: 'One row per prompt, plus page-wide fixes',
    settings: ANALYSIS,
    usageNoun: ['coverage matrix', 'coverage matrices']
  },
  coverage_matrix: {
    label: 'Coverage matrix',
    file: 'coverage_matrix.md',
    description:
      'Rates how well the page answers each prompt (strong, partial, weak or none) and quotes where the page covers it. Up to 10 prompts per call.',
    schemaLabel: 'One row per prompt',
    settings: ANALYSIS,
    usageNoun: ['coverage matrix', 'coverage matrices']
  },
  page_audit: {
    label: 'Page audit',
    file: 'page_audit.md',
    description:
      'Lists title, meta and H1 mismatches, claims to check, missing promised sections and typos, each quoted from the page. Runs once per page content.',
    schemaLabel: 'A list of findings',
    settings: ANALYSIS,
    usageNoun: ['page audit', 'page audits']
  },
  coverage_fixes: {
    label: 'Coverage fixes',
    file: 'coverage_fixes.md',
    description:
      'For prompts the page covers partly or not at all: what is there now, what to update and a new FAQ draft.',
    schemaLabel: 'One fix per prompt',
    settings: ANALYSIS,
    usageNoun: ['coverage fix set', 'coverage fix sets']
  },
  aio_gap: {
    label: 'Overview gap',
    file: 'aio_gap.md',
    description:
      'After a check, lists facts the AI Overview states that the page does not, each with its likely source.',
    schemaLabel: 'A list of facts with their likely source',
    settings: ANALYSIS,
    usageNoun: ['overview gap', 'overview gaps']
  },
  answer_shape: {
    label: 'Answer shape',
    file: 'answer_shape.md',
    description: 'Describes how the AI Overview answer is shaped, so the page can match it.',
    schemaLabel: 'The answer shape',
    settings: ANALYSIS,
    usageNoun: ['answer shape', 'answer shapes']
  },
  sentiment_claims: {
    label: 'Sentiment claims',
    file: 'sentiment_claims.md',
    description:
      'Pulls claims about your brand and competitors out of AI Overviews, with the sentence and source.',
    schemaLabel: 'A list of claims',
    settings: ANALYSIS,
    usageNoun: ['claim set', 'claim sets']
  },
  sentiment_claims_v2: {
    label: 'Sentiment claims',
    file: 'sentiment_claims_v2.md',
    description:
      'Pulls claims about your brand and the competitors of the page’s product out of AI Overviews, with the sentence, the tone and the source.',
    schemaLabel: 'Brands named and a list of claims',
    settings: ANALYSIS,
    usageNoun: ['claim set', 'claim sets']
  },
  sentiment_fact_check: {
    label: 'Sentiment fact check',
    file: 'sentiment_fact_check.md',
    description:
      'Checks the claims an overview makes about your brand against your brand facts and pages. Runs only when there is such a claim.',
    schemaLabel: 'One check per claim',
    settings: ANALYSIS,
    usageNoun: ['fact check', 'fact checks']
  },
  video_brief: {
    label: 'Video brief',
    file: 'video_brief.md',
    description: 'Drafts a short video brief for a question AI Overviews answer with videos.',
    schemaLabel: 'One video brief',
    settings: ANALYSIS,
    usageNoun: ['video brief', 'video briefs']
  },
  run_summary: {
    label: 'Check summary',
    file: 'run_summary.md',
    description:
      'Writes the headline and short body for each finished check. States the citation change and the content change side by side, never a cause.',
    schemaLabel: 'A headline and a short body',
    settings: ANALYSIS,
    usageNoun: ['check summary', 'check summaries']
  },
  topic_seed_discover: {
    label: 'Topic seed ideas',
    file: 'topic_seed_discover.md',
    description:
      'Reads your homepage, key pages and saved products (no searches) and suggests buyer problems to start a topic from, each tied to one product, with segments.',
    schemaLabel: 'Seeds with their product, segments',
    settings: ANALYSIS,
    usageNoun: ['topic seed ideas output', 'topic seed ideas outputs']
  },
  topic_buyer_profile: {
    label: 'Topic buyer profile',
    file: 'topic_buyer_profile.md',
    description:
      'Writes the buyer profile for a topic: who types these questions, their tools, segments, triggers, values and poor fit, with where each point came from.',
    schemaLabel: 'Profile points with sources',
    settings: ANALYSIS,
    usageNoun: ['topic buyer profile output', 'topic buyer profile outputs']
  },
  topic_profile_discover: {
    label: 'Topic profile assists',
    file: 'topic_profile_discover.md',
    description:
      'Discovers more profile points from your site, rewrites or shortens a section, or explains its sources.',
    schemaLabel: 'Profile points',
    settings: ANALYSIS,
    usageNoun: ['topic profile assists output', 'topic profile assists outputs']
  },
  topic_profile_discover_v2: {
    label: 'Topic profile discovery',
    file: 'topic_profile_discover_v2.md',
    description:
      'Finds new profile points for one section from the topic’s own pages, or explains where each point comes from.',
    schemaLabel: 'Profile points or an explanation',
    settings: ANALYSIS,
    usageNoun: ['topic profile discovery output', 'topic profile discovery outputs']
  },
  topic_profile_rewrite: {
    label: 'Topic profile rewrite',
    file: 'topic_profile_rewrite.md',
    description:
      'Rewrites or shortens one profile section in plainer buyer language. Reads no site text.',
    schemaLabel: 'Rewritten points',
    settings: ANALYSIS,
    usageNoun: ['topic profile rewrite output', 'topic profile rewrite outputs']
  },
  topic_journey_questions: {
    label: 'Journey questions',
    file: 'topic_journey_questions.md',
    description:
      'Writes long first-person buyer questions for each journey stage. Never your brand.',
    schemaLabel: 'Questions per stage',
    settings: ANALYSIS,
    usageNoun: ['journey questions output', 'journey questions outputs']
  },
  topic_questions_discover: {
    label: 'More questions',
    file: 'topic_questions_discover.md',
    description:
      'Adds questions for a stage, finds journey gaps, or rewrites questions in buyer language.',
    schemaLabel: 'Questions and gaps',
    settings: ANALYSIS,
    usageNoun: ['more questions output', 'more questions outputs']
  },
  topic_keyword_terms: {
    label: 'Core terms',
    file: 'topic_keyword_terms.md',
    description: 'Finds the core search terms for a topic and their synonyms.',
    schemaLabel: 'Terms with synonyms',
    settings: ANALYSIS,
    usageNoun: ['core terms output', 'core terms outputs']
  },
  topic_keyword_expand: {
    label: 'Keyword groups',
    file: 'topic_keyword_expand.md',
    description:
      'Writes intent keyword groups (best lists, pricing, alternatives, how-to and more) beside the coverage groups made in code.',
    schemaLabel: 'Keyword groups',
    settings: ANALYSIS,
    usageNoun: ['keyword groups output', 'keyword groups outputs']
  },
  topic_keyword_competitor: {
    label: 'Competitor keywords',
    file: 'topic_keyword_competitor.md',
    description:
      'Writes the "Competitor vs" and "alternatives" keyword groups from the competitors of the topic’s product.',
    schemaLabel: 'Keyword groups',
    settings: ANALYSIS,
    usageNoun: ['competitor keywords output', 'competitor keywords outputs']
  },
  topic_page_match: {
    label: 'Page match',
    file: 'topic_page_match.md',
    description:
      'Matches each question or keyword to the page that should answer it, with a confidence and a one-line reason.',
    schemaLabel: 'One match per prompt',
    settings: ANALYSIS,
    usageNoun: ['page match output', 'page match outputs']
  },
  topic_page_brief: {
    label: 'Page brief',
    file: 'topic_page_brief.md',
    description: 'Drafts a short brief for a page that would answer a question.',
    schemaLabel: 'A brief',
    settings: ANALYSIS,
    usageNoun: ['page brief output', 'page brief outputs']
  },
  topic_target_suggest: {
    label: 'Target page pick',
    file: 'topic_target_suggest.md',
    description:
      "Picks the best target page for a topic from the site's pages and how its checks cite them, with a reason each, or names a page to write.",
    schemaLabel: 'Up to three pages and a new page idea',
    settings: ANALYSIS,
    usageNoun: ['target page pick', 'target page picks']
  },
  topic_questions_cleanup: {
    label: 'Question clean-up',
    file: 'topic_questions_cleanup.md',
    description:
      'Turns pasted sales and support lines into buyer questions, tagged by stage, without your brand.',
    schemaLabel: 'Before and after per question',
    settings: ANALYSIS,
    usageNoun: ['question clean-up output', 'question clean-up outputs']
  },
  competitor_page_questions: {
    label: 'Competitor page questions',
    file: 'competitor_page_questions.md',
    description:
      'Writes the buyer questions a competitor page answers, with both brands left out, and the claims you do not make.',
    schemaLabel: 'Questions and claims',
    settings: ANALYSIS,
    usageNoun: ['competitor page questions output', 'competitor page questions outputs']
  },
  competitor_page_questions_v2: {
    label: 'Competitor page questions',
    file: 'competitor_page_questions_v2.md',
    description:
      'Writes the buyer questions a competitor page answers, each tied to one of its headings, with both brands left out.',
    schemaLabel: 'Questions with their section',
    settings: ANALYSIS,
    usageNoun: ['competitor page questions output', 'competitor page questions outputs']
  },
  competitor_page_claims: {
    label: 'Competitor page claims',
    file: 'competitor_page_claims.md',
    description:
      'Lists the claims a competitor page makes and whether your own pages make them too, with the page that shows it.',
    schemaLabel: 'Claims with your evidence',
    settings: ANALYSIS,
    usageNoun: ['competitor page claims output', 'competitor page claims outputs']
  },
  topic_summary: {
    label: 'Topic summary',
    file: 'topic_summary.md',
    description:
      'Writes the topic summary line and the executive summary from saved results. The next actions are their own step.',
    schemaLabel: 'A line and a summary',
    settings: ANALYSIS,
    usageNoun: ['topic summary output', 'topic summary outputs']
  },
  topic_next_actions: {
    label: 'Next actions',
    file: 'topic_next_actions.md',
    description:
      'Picks the next three actions for a topic from its results, open gaps and page matches, each with the questions it is about.',
    schemaLabel: 'Three actions',
    settings: ANALYSIS,
    usageNoun: ['next actions output', 'next actions outputs']
  },
  topic_why_not_cited: {
    label: 'Why not cited',
    file: 'topic_why_not_cited.md',
    description:
      'Explains why an overview cites others and not you, from the stored overview, and drafts the fix.',
    schemaLabel: 'Reasons and a fix',
    settings: ANALYSIS,
    usageNoun: ['why not cited output', 'why not cited outputs']
  },
  topic_explain_citation: {
    label: 'Explain this citation',
    file: 'topic_explain_citation.md',
    description:
      'Explains why the stored AI Overview cites the sources it cites for one question. Timing, not proof.',
    schemaLabel: 'A short explanation and its facts',
    settings: ANALYSIS,
    usageNoun: ['citation explanation', 'citation explanations']
  },
  topic_citation_diagnosis: {
    label: 'Citation diagnosis',
    file: 'topic_citation_diagnosis.md',
    description:
      'Explains why the stored AI Overview cites the sources it cites for one question, and why not you. Timing, not proof.',
    schemaLabel: 'Reasons, sources cited instead and facts',
    settings: ANALYSIS,
    usageNoun: ['citation diagnosis', 'citation diagnoses']
  },
  topic_fix_draft: {
    label: 'Fix draft',
    file: 'topic_fix_draft.md',
    description:
      'Drafts the edit for a question the overview does not cite you for, from its diagnosis: where to make it, the steps and the text.',
    schemaLabel: 'Where, steps and a draft',
    settings: ANALYSIS,
    usageNoun: ['fix draft', 'fix drafts']
  },
  topic_page_edit: {
    label: 'Page edits',
    file: 'topic_page_edit.md',
    description:
      'Reads a page and suggests the edits that help it answer the searches it should win: blocks to cut, rewrite or add.',
    schemaLabel: 'A summary and the changes',
    settings: ANALYSIS,
    usageNoun: ['page edit', 'page edits']
  },
  topic_owner_why: {
    label: 'Why Google picks a page',
    file: 'topic_owner_why.md',
    description:
      'Compares the page you chose with the page of yours Google cites instead, says which should own the searches and what content to change.',
    schemaLabel: 'A verdict, what the answer needs and the changes',
    settings: ANALYSIS,
    usageNoun: ['page comparison', 'page comparisons']
  },
  topic_cluster_suggest: {
    label: 'Suggest topics',
    file: 'topic_cluster_suggest.md',
    description:
      'Suggests new topics to track from saved data only: the buyer problem, its situation, an example and starter questions across the journey.',
    schemaLabel: 'Topic ideas with questions',
    settings: ANALYSIS,
    usageNoun: ['topic suggestion', 'topic suggestions']
  },
  topic_cluster_sort: {
    label: 'Sort into topics',
    file: 'topic_cluster_sort.md',
    description:
      'Proposes a topic for each picked question: one of the listed topics, or a new one when allowed, with a short reason.',
    schemaLabel: 'A topic per question',
    settings: ANALYSIS,
    usageNoun: ['sort proposal', 'sort proposals']
  },
  topic_cluster_name: {
    label: 'Name a topic',
    file: 'topic_cluster_name.md',
    description:
      'Names the buyer problem a set of questions shares, with a one or two sentence situation.',
    schemaLabel: 'A name and a situation',
    settings: ANALYSIS,
    usageNoun: ['topic name', 'topic names']
  },
  ...Object.fromEntries(
    ASSISTANT_TEMPLATE_KINDS.map((kind) => [
      kind,
      {
        label: ASSISTANT_TEMPLATE_INFO[kind].label,
        file: `${kind}.md`,
        description: ASSISTANT_TEMPLATE_INFO[kind].description,
        schemaLabel: 'An answer with its sources, unknowns and proposed actions',
        settings: ANALYSIS,
        usageNoun: ASSISTANT_TEMPLATE_INFO[kind].usage
      } satisfies TemplateKindInfo
    ])
  )
}

/** Copy for any kind, including one this module does not know yet. */
export function templateKindInfo(kind: string): TemplateKindInfo {
  const known = TEMPLATE_KIND_INFO[kind]
  if (known !== undefined) return known
  const words = kind.replace(/_/g, ' ')
  const label = words.charAt(0).toUpperCase() + words.slice(1)
  return {
    label,
    file: `${kind}.md`,
    description: `The ${words} step.`,
    schemaLabel: 'The output fields',
    settings: ANALYSIS,
    usageNoun: [`${words} output`, `${words} outputs`]
  }
}

/** Position in run order. Unknown kinds sort after every known one. */
export function templateStepIndex(kind: string): number {
  const index = TEMPLATE_STEP_ORDER.indexOf(kind)
  return index === -1 ? TEMPLATE_STEP_ORDER.length : index
}

export function compareTemplateKinds(left: string, right: string): number {
  return templateStepIndex(left) - templateStepIndex(right) || left.localeCompare(right)
}

/**
 * Kinds registered ahead of the package that writes them (Docs/PROMPT-AUDIT.md, P0),
 * with that package. Their shipped body is a placeholder: a planned kind is hidden
 * from the Templates screen and never runs. The owning package deletes its line here
 * when it ships the body; nothing else in the registry changes.
 */
export const PLANNED_TEMPLATE_KINDS: Readonly<Record<string, string>> = {}

/**
 * Combined kinds split into narrower ones (Docs/PROMPT-AUDIT.md section 3, rule 6),
 * each with the kinds that replace it. A combined kind is retired once none of its
 * replacements is planned, so shipping the last new body retires the old step:
 * hidden from run order, its project versions kept read-only, never run. An old
 * project version would otherwise fail the narrower schemas.
 */
export const TEMPLATE_KIND_RETIREMENTS: Readonly<Record<string, readonly string[]>> = {
  coverage: ['coverage_matrix', 'page_audit', 'coverage_fixes'],
  sentiment_claims: ['sentiment_claims_v2', 'sentiment_fact_check'],
  topic_profile_discover: ['topic_profile_discover_v2', 'topic_profile_rewrite'],
  competitor_page_questions: ['competitor_page_questions_v2', 'competitor_page_claims'],
  topic_why_not_cited: ['topic_citation_diagnosis', 'topic_fix_draft'],
  topic_explain_citation: ['topic_citation_diagnosis']
}

/** The one line the template editor shows on a retired step's project version. */
export const RETIRED_STEP_NOTICE =
  "This project's version was written for the old combined step. Open the new steps to edit them."

/** `planned`: registered, not written yet. `live`: runs. `retired`: replaced by narrower kinds. */
export type TemplateKindLifecycle = 'planned' | 'live' | 'retired'

/** The tables {@link templateKindLifecycle} reads. Tests pass their own. */
export interface TemplateLifecycleTables {
  planned: Readonly<Record<string, string>>
  retirements: Readonly<Record<string, readonly string[]>>
}

const SHIPPED_LIFECYCLE: TemplateLifecycleTables = {
  planned: PLANNED_TEMPLATE_KINDS,
  retirements: TEMPLATE_KIND_RETIREMENTS
}

function ownEntry<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined
}

export function templateKindLifecycle(
  kind: string,
  tables: TemplateLifecycleTables = SHIPPED_LIFECYCLE
): TemplateKindLifecycle {
  if (ownEntry(tables.planned, kind) !== undefined) return 'planned'
  const replacedBy = ownEntry(tables.retirements, kind)
  if (replacedBy === undefined || replacedBy.length === 0) return 'live'
  return replacedBy.some((next) => ownEntry(tables.planned, next) !== undefined)
    ? 'live'
    : 'retired'
}

/** True when CiteFox may send this kind's template to Claude. */
export function isRunnableTemplateKind(
  kind: string,
  tables: TemplateLifecycleTables = SHIPPED_LIFECYCLE
): boolean {
  return templateKindLifecycle(kind, tables) === 'live'
}

/**
 * True when the Templates screen lists the step. A retired step lists only while
 * the open project still has its own version, so that version stays readable.
 */
export function isListedTemplateStep(
  kind: string,
  hasProjectVersion: boolean,
  tables: TemplateLifecycleTables = SHIPPED_LIFECYCLE
): boolean {
  const lifecycle = templateKindLifecycle(kind, tables)
  return lifecycle === 'live' || (lifecycle === 'retired' && hasProjectVersion)
}

/** The kinds that replace a combined kind, in run order. Empty when it is not split. */
export function replacementKinds(
  kind: string,
  tables: TemplateLifecycleTables = SHIPPED_LIFECYCLE
): string[] {
  return [...(ownEntry(tables.retirements, kind) ?? [])].sort(compareTemplateKinds)
}

export function isTemplateTone(value: string): value is TemplateTone {
  return isOneOf(TEMPLATE_TONES, value)
}

/**
 * Settings from stored JSON. Anything unreadable becomes the default for that
 * field, so an old row or a hand-edited file never blocks a run.
 */
export function readTemplateSettings(value: unknown): TemplateSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ...DEFAULT_TEMPLATE_SETTINGS }
  }
  const record = value as Record<string, unknown>
  return {
    model: settingText(record.model, 80),
    language: settingText(record.language, 16),
    promptCount:
      typeof record.promptCount === 'number' &&
      Number.isInteger(record.promptCount) &&
      record.promptCount >= 1 &&
      record.promptCount <= TEMPLATE_PROMPT_COUNT_MAX
        ? record.promptCount
        : null,
    tone: typeof record.tone === 'string' && isTemplateTone(record.tone) ? record.tone : null
  }
}

/** Drops settings that do not apply to `kind`, so a stored value never leaks into another step. */
export function settingsForKind(kind: string, settings: TemplateSettings): TemplateSettings {
  const flags = templateKindInfo(kind).settings
  return {
    model: settings.model,
    language: flags.language ? settings.language : null,
    promptCount: flags.promptCount ? settings.promptCount : null,
    tone: settings.tone !== null && flags.tones.includes(settings.tone) ? settings.tone : null
  }
}

export function sameTemplateSettings(left: TemplateSettings, right: TemplateSettings): boolean {
  return (
    left.model === right.model &&
    left.language === right.language &&
    left.promptCount === right.promptCount &&
    left.tone === right.tone
  )
}

export function templateLanguageLabel(code: string | null): string {
  if (code === null) return "Market's language"
  return TEMPLATE_LANGUAGES.find((item) => item.code === code)?.label ?? code
}

function settingText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > max) return null
  if (!/^[A-Za-z0-9._:-]+$/.test(trimmed)) return null
  return trimmed
}
