import type { LlmCallTrace } from '../providers/claude/claude-code'

/**
 * What a Claude call is for, in the words of the progress panel:
 * "Asking Claude to <purpose>". Keyed by the call's trace (assist id or
 * template kind). An unknown call reads "Asking Claude".
 */
const ASSIST_PURPOSE: Readonly<Record<string, string>> = {
  'project.fillSiteRead': 'read what your site sells and its brand names',
  'project.fillSwitching': 'find what buyers switch from and the tools used with you',
  'project.productCompetitors': 'search the web for competitors',
  'start.firstPages': 'pick your first pages to track',
  'page.shorterTitle': 'write shorter titles',
  'page.titles': 'suggest titles',
  'page.promises': 'list what the page promises',
  'page.checkFacts': 'check the facts on the page',
  'page.verifyClaims': 'check the claims online',
  'audience.sharpen': 'sharpen the buyer profile',
  'audience.triggers': 'find trigger events on the page',
  'prompts.more': 'write more buyer prompts',
  'prompts.rephrase': 'rephrase the prompt',
  'prompts.checkPage': 'check the page against the prompts',
  'questions.matchPages': 'match each question to a tracked page',
  'gaps.draftFix': 'draft a fix',
  'results.explainChange': 'explain the change',
  'results.topActions': 'pick the top actions',
  'results.whyNotFirst': 'explain why you are not first',
  'results.overviewRead': 'read what this overview says about you',
  'progress.nextFix': 'pick the next fix',
  'progress.otherMarkets': 'compare other markets',
  'progress.draftFix': 'draft a fix',
  'markets.suggest': 'suggest markets',
  'markets.localPrompts': 'write local prompts',
  'markets.whatsDifferent': 'explain what is different',
  'status.explainUsage': 'explain your usage',
  'status.explainErrors': 'explain the errors',
  'report.summary': 'summarise the report',
  'history.whatChanged': 'say what changed between checks',
  'template.improve': 'improve the template',
  'communities.reply': 'draft a reply',
  'citations.pitch': 'draft a pitch email',
  'alerts.describeRule': 'turn your words into an alert rule',
  'fixes.anchorText': 'suggest anchor text for backlinks',
  'fixes.recoveryPlan': 'write a recovery plan',
  'structure.clusters': 'group your pages into clusters',
  'structure.import': 'read the imported structure',
  'ask.citefox': 'answer your question'
}

const TEMPLATE_PURPOSE: Readonly<Record<string, string>> = {
  buyer_profile: 'write the buyer profile',
  buyer_prompts: 'write buyer prompts',
  brand_prompts: 'write brand prompts',
  coverage: 'check how the page covers each prompt',
  aio_gap: 'explain the gap',
  answer_shape: 'read the answer shape',
  sentiment_claims: 'read what the overview says about you',
  video_brief: 'write a video brief',
  run_summary: 'summarise the run',
  topic_seed_discover: 'suggest problems to start from',
  topic_buyer_profile: 'write the buyer profile',
  topic_profile_discover: 'find more for the profile',
  topic_journey_questions: 'write buyer questions',
  topic_questions_discover: 'find more questions',
  topic_keyword_terms: 'find core terms and synonyms',
  topic_keyword_expand: 'write keyword groups',
  topic_keyword_competitor: 'write competitor keywords',
  topic_page_match: 'match questions to your pages',
  topic_page_brief: 'draft a page brief',
  topic_target_suggest: 'pick the target page',
  topic_questions_cleanup: 'clean up the questions',
  competitor_page_questions: 'turn their page into questions',
  competitor_page_questions_v2: 'turn their page into questions',
  competitor_page_claims: 'list the claims their page makes',
  topic_summary: 'summarise the topic',
  topic_next_actions: 'pick the next three actions',
  topic_citation_diagnosis: 'explain who the overview cites and why',
  topic_fix_draft: 'draft the fix',
  topic_page_edit: 'suggest the edits to your page',
  topic_owner_why: 'compare your two pages',
  topic_cluster_suggest: 'suggest topics to track',
  topic_cluster_sort: 'sort questions into topics',
  topic_cluster_name: 'name the topic',
  topic_why_not_cited: 'explain why you are not cited',
  topic_explain_citation: 'explain the citation'
}

/** True when the panel has words for this assist ("Asking CiteFox AI to …"). */
export function hasAssistPurpose(assistId: string): boolean {
  return ASSIST_PURPOSE[assistId] !== undefined
}

/**
 * "Asking CiteFox AI to find brand names and competitors", or "Asking CiteFox AI again …"
 * on a retry. Users never see the provider (Claude Code or Codex) outside Connections.
 */
export function claudeStepLabel(
  trace: LlmCallTrace | undefined,
  retry: boolean,
  ai = 'CiteFox AI'
): string {
  const purpose =
    (trace?.assistId ? ASSIST_PURPOSE[trace.assistId] : undefined) ??
    (trace?.templateKind ? TEMPLATE_PURPOSE[trace.templateKind] : undefined) ??
    null
  if (retry) return purpose ? `Asking ${ai} again to ${purpose}` : `Asking ${ai} again`
  return purpose ? `Asking ${ai} to ${purpose}` : `Asking ${ai}`
}

/** FR-25.1 "CiteFox AI · on your plan" or "CiteFox AI · API key". No provider names. */
export function connectionText(connection: 'claude-code' | 'anthropic-api' | 'codex'): string {
  return connection === 'anthropic-api' ? 'CiteFox AI · API key' : 'CiteFox AI · on your plan'
}
