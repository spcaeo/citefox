import { describe, expect, test } from 'vitest'
import {
  API_KEY_HINT_LENGTH,
  CHANGE_KINDS,
  DEFAULT_INCLUDE_SUBDOMAINS,
  DEFAULT_REPORT_SCHEDULE_STATUS,
  DELIVERY_OUTCOMES,
  DELIVERY_TRIGGERS,
  DEFAULT_INTERVAL_DAYS,
  DEFAULT_MARKET_DEVICE,
  FAQ_DRAFT_MAX_WORDS,
  FAQ_DRAFT_MIN_WORDS,
  META_FLAG_LENGTH,
  PLAYGROUND_COMPARE_LIMIT,
  PLAYGROUND_MEMORY_RUNS,
  REPORT_FORMATS,
  REPORT_SCHEDULE_STATUSES,
  SUMMARY_STYLES,
  SEARCHES_PER_PROMPT_MAX,
  SEARCHES_PER_PROMPT_MIN,
  SHIPPED_TEMPLATE_NAME,
  SMTP_PRESETS,
  STALE_CHECK_DAYS,
  TEMPLATE_NAME_MAX_LENGTH,
  TEMPLATE_NAME_MIN_LENGTH,
  TEMPLATE_NOTES_MAX_LENGTH,
  TEMPLATE_VARIABLES,
  TITLE_FLAG_LENGTH,
  TRAY_MENU_CHECK_LIMIT,
  VISIBILITY_POINT_BRAND_MENTIONED,
  VISIBILITY_POINT_NOT_CITED,
  VISIBILITY_POINT_OTHER_OWN,
  VISIBILITY_POINT_PAGE_CITED,
  isApiKeyProvider,
  isBuyerProfilePart,
  isCapRule,
  isChangeKind,
  isCheckErrorCode,
  isCitationClass,
  isDeliveryOutcome,
  isDeliveryTrigger,
  isEmailMode,
  isExportFormat,
  isReportFormat,
  isReportScheduleStatus,
  isSummaryStyle,
  isClaudeProvider,
  isConnectionState,
  isCountryCode,
  serpApiGl,
  isCoverageAction,
  isCoverageFindingKind,
  isCoverageLevel,
  isCoveragePriority,
  isGenerationTemplateKind,
  isIntentStage,
  isIntervalDays,
  INTERVAL_DAYS,
  intervalDaysText,
  intervalLabel,
  QUICK_INTERVAL_DAYS,
  isJinaMode,
  isLanguageTag,
  isMarketDevice,
  isPageReadReader,
  isPageStatus,
  isProjectStatus,
  isPromptCheckStatus,
  isPromptMovement,
  isPromptSource,
  isQueueState,
  isSampleCount,
  isSmtpSecurity,
  isSerpApiRotationMode,
  isTemplateVariable,
  type ApiKeyMetadata,
  type Market,
  type ProjectSummary
} from './domain'

describe('section 10 enums', () => {
  test('accepts the SRS values and rejects neighbours', () => {
    expect(isProjectStatus('active')).toBe(true)
    expect(isProjectStatus('paused')).toBe(true)
    expect(isProjectStatus('archived')).toBe(true)
    expect(isProjectStatus('deleted')).toBe(false)

    expect(isApiKeyProvider('serpapi')).toBe(true)
    expect(isApiKeyProvider('jina')).toBe(true)
    expect(isApiKeyProvider('anthropic')).toBe(true)
    expect(isApiKeyProvider('youtube')).toBe(true)
    expect(isApiKeyProvider('claude-code')).toBe(false)
    expect(isApiKeyProvider('anthropic-api')).toBe(false)

    expect(isClaudeProvider('claude-code')).toBe(true)
    expect(isClaudeProvider('anthropic-api')).toBe(true)
    expect(isClaudeProvider('anthropic')).toBe(false)

    expect(isMarketDevice('desktop')).toBe(true)
    expect(isMarketDevice('mobile')).toBe(true)
    expect(isMarketDevice('tablet')).toBe(false)

    expect(isSerpApiRotationMode('in_order')).toBe(true)
    expect(isSerpApiRotationMode('spread_evenly')).toBe(true)
    expect(isSerpApiRotationMode('project_keys')).toBe(true)
    expect(isSerpApiRotationMode('random')).toBe(false)

    expect(isConnectionState('ok')).toBe(true)
    expect(isConnectionState('warning')).toBe(true)
    expect(isConnectionState('off')).toBe(true)
    expect(isConnectionState('unchecked')).toBe(true)
    expect(isConnectionState('unknown')).toBe(false)

    expect(isJinaMode('fallback')).toBe(true)
    expect(isJinaMode('always')).toBe(true)
    expect(isJinaMode('never')).toBe(true)
    expect(isJinaMode('sometimes')).toBe(false)

    expect(isIntervalDays(1)).toBe(true)
    expect(isIntervalDays(7)).toBe(true)
    expect(isIntervalDays(14)).toBe(true)
    expect(isIntervalDays(30)).toBe(true)
    expect(isIntervalDays(60)).toBe(true)
    expect(isIntervalDays(90)).toBe(true)
    expect(isIntervalDays(0)).toBe(false)
    expect(isIntervalDays(2)).toBe(false)
    expect(isIntervalDays(21)).toBe(false)

    expect(isSampleCount(1)).toBe(true)
    expect(isSampleCount(5)).toBe(true)
    expect(isSampleCount(0)).toBe(false)
  })

  test('defaults are subdomains included, desktop, and 7 days (owner, 2026-11-01)', () => {
    expect(DEFAULT_INCLUDE_SUBDOMAINS).toBe(true)
    expect(DEFAULT_MARKET_DEVICE).toBe('desktop')
    expect(DEFAULT_INTERVAL_DAYS).toBe(7)
  })

  test('interval words: every day for 1, every N days otherwise', () => {
    expect(INTERVAL_DAYS).toEqual([1, 7, 14, 30, 60, 90])
    expect(QUICK_INTERVAL_DAYS).toEqual([1, 7, 14, 30])
    expect(intervalLabel(1)).toBe('Every day')
    expect(intervalLabel(7)).toBe('Every 7 days')
    expect(intervalDaysText(1)).toBe('1 day')
    expect(intervalDaysText(90)).toBe('90 days')
  })

  test('country is uppercase alpha-2 and language is a lowercase BCP-47 shape', () => {
    expect(isCountryCode('US')).toBe(true)
    expect(isCountryCode('GB')).toBe(true)
    expect(isCountryCode('UK')).toBe(true)
    expect(isCountryCode('us')).toBe(false)
    expect(isCountryCode('USA')).toBe(false)

    // SerpApi lists the United Kingdom as gl=uk; GB and the older UK both search as uk.
    expect(serpApiGl('GB')).toBe('uk')
    expect(serpApiGl('UK')).toBe('uk')
    expect(serpApiGl('US')).toBe('us')

    expect(isLanguageTag('en')).toBe(true)
    expect(isLanguageTag('pt-BR')).toBe(true)
    expect(isLanguageTag('zh-Hant')).toBe(true)
    expect(isLanguageTag('es-419')).toBe(true)
    expect(isLanguageTag('EN')).toBe(false)
    expect(isLanguageTag('e')).toBe(false)
    expect(isLanguageTag('en_US')).toBe(false)
  })

  test('project, key metadata, and market shapes carry no secret field', () => {
    const project: ProjectSummary = {
      id: '1',
      name: 'TextBolt',
      slug: 'textbolt',
      domain: 'textbolt.com',
      dbPath: 'projects/textbolt.sqlite',
      clientName: null,
      status: 'active'
    }
    const key: ApiKeyMetadata = {
      id: '1',
      provider: 'serpapi',
      name: 'Personal',
      keychainRef: 'serpapi/personal',
      hint: 'b1f4',
      rotationOrder: 1,
      cap: null,
      on: true,
      projectIds: [],
      state: 'unchecked',
      lastReason: null,
      serpapiUsage: null
    }
    const market: Market = {
      id: '1',
      country: 'US',
      language: 'en',
      location: 'Austin',
      device: 'desktop',
      localWording: true,
      serpapiLocation: null
    }

    const serialized = JSON.stringify({ project, key, market })
    expect(serialized).not.toMatch(/secret|password|api[_-]?key|token/i)
    expect(Object.hasOwn(key, 'keychainRef')).toBe(true)
    expect(key.hint).toHaveLength(API_KEY_HINT_LENGTH)
    expect(key.cap).toBeNull()
    expect(key.projectIds).toEqual([])
    expect(key.state).toBe('unchecked')
    expect(isCountryCode(market.country)).toBe(true)
    expect(isLanguageTag(market.language)).toBe(true)
    expect(market.location).toBe('Austin')
    expect(project.clientName).toBeNull()
  })

  test('M2 page, prompt, and gap enums match the SRS lists', () => {
    expect(isPageStatus('setting_up')).toBe(true)
    expect(isPageStatus('not_tracked')).toBe(true)
    expect(isPageStatus('tracked')).toBe(true)
    expect(isPageStatus('paused')).toBe(true)
    expect(isPageStatus('removed')).toBe(true)
    expect(isPageStatus('deleted')).toBe(false)

    expect(isPageReadReader('auto')).toBe(true)
    expect(isPageReadReader('direct')).toBe(true)
    expect(isPageReadReader('jina')).toBe(true)
    expect(isPageReadReader('file')).toBe(true)
    expect(isPageReadReader('browser')).toBe(false)

    expect(isPromptSource('title_meta_h1')).toBe(true)
    expect(isPromptSource('trigger_event')).toBe(true)
    expect(isPromptSource('objection')).toBe(true)
    expect(isPromptSource('detail_check')).toBe(true)
    expect(isPromptSource('written_by_user')).toBe(true)
    expect(isPromptSource('keyword')).toBe(false)

    expect(isIntentStage('problem')).toBe(true)
    expect(isIntentStage('unset')).toBe(true)
    expect(isIntentStage('awareness')).toBe(false)

    expect(isCoverageLevel('strong')).toBe(true)
    expect(isCoverageLevel('partial')).toBe(true)
    expect(isCoverageLevel('weak')).toBe(true)
    expect(isCoverageLevel('none')).toBe(true)
    expect(isCoverageLevel('full')).toBe(false)

    expect(isCoverageAction('new_faq')).toBe(true)
    expect(isCoverageAction('update_existing')).toBe(true)
    expect(isCoverageAction('small_update')).toBe(true)
    expect(isCoverageAction('optional_faq')).toBe(true)
    expect(isCoverageAction('none')).toBe(true)
    expect(isCoverageAction('no_change')).toBe(false)

    expect(isCoveragePriority('high')).toBe(true)
    expect(isCoveragePriority('medium')).toBe(true)
    expect(isCoveragePriority('low')).toBe(true)
    expect(isCoveragePriority('urgent')).toBe(false)

    expect(isCoverageFindingKind('factual_claim')).toBe(true)
    expect(isCoverageFindingKind('title_length')).toBe(true)
    expect(isCoverageFindingKind('title_meta_mismatch')).toBe(true)
    expect(isCoverageFindingKind('other')).toBe(true)
    expect(isCoverageFindingKind('title_or_meta')).toBe(false)

    expect(isGenerationTemplateKind('buyer_profile')).toBe(true)
    expect(isGenerationTemplateKind('buyer_prompts')).toBe(true)
    expect(isGenerationTemplateKind('coverage')).toBe(true)
    expect(isGenerationTemplateKind('brand_prompts')).toBe(true)
    expect(isGenerationTemplateKind('sentiment_claims')).toBe(true)
    expect(isGenerationTemplateKind('answer_shape')).toBe(true)
    expect(isGenerationTemplateKind('sentiment')).toBe(false)

    expect([...TEMPLATE_VARIABLES]).toEqual([
      'url',
      'title',
      'meta_description',
      'h1',
      'page_text',
      'brand_name',
      'prompt_count',
      'outline',
      'faqs',
      'last_modified',
      'competitors',
      'market',
      'market_language',
      'buyer_values',
      'prompt',
      'aio_text',
      'aio_references',
      'brand_facts',
      'own_pages',
      'prompt_text',
      'overview_text',
      // Prompt-audit block variables (Docs/PROMPT-AUDIT.md section 3).
      'business_block',
      'product_block',
      'market_block',
      'buyer_block',
      'competitor_block',
      'stage_rules',
      'mode_rules',
      'evidence'
    ])
    expect(isTemplateVariable('page_text')).toBe(true)
    expect(isTemplateVariable('page.title')).toBe(false)

    expect(isBuyerProfilePart('poor_fit')).toBe(true)
    expect(isBuyerProfilePart('who')).toBe(true)
    expect(isBuyerProfilePart('persona')).toBe(false)

    expect(TITLE_FLAG_LENGTH).toBe(60)
    expect(META_FLAG_LENGTH).toBe(160)
    expect(FAQ_DRAFT_MIN_WORDS).toBe(40)
    expect(FAQ_DRAFT_MAX_WORDS).toBe(70)
    expect(PLAYGROUND_MEMORY_RUNS).toBe(20)
    expect(PLAYGROUND_COMPARE_LIMIT).toBe(3)
    expect(SHIPPED_TEMPLATE_NAME).toBe('CiteFox default')
    expect(TEMPLATE_NAME_MIN_LENGTH).toBe(1)
    expect(TEMPLATE_NAME_MAX_LENGTH).toBe(80)
    expect(TEMPLATE_NOTES_MAX_LENGTH).toBe(500)
    expect(SEARCHES_PER_PROMPT_MIN).toBe(1)
    expect(SEARCHES_PER_PROMPT_MAX).toBe(2)
  })

  test('section 7 statuses, points, and SMTP presets match the SRS lists', () => {
    expect(isPromptCheckStatus('page_cited')).toBe(true)
    expect(isPromptCheckStatus('other_own_page')).toBe(true)
    expect(isPromptCheckStatus('brand_mentioned')).toBe(true)
    expect(isPromptCheckStatus('not_cited')).toBe(true)
    expect(isPromptCheckStatus('no_aio')).toBe(true)
    expect(isPromptCheckStatus('error')).toBe(true)
    expect(isPromptCheckStatus('missing')).toBe(false)

    expect(isPromptMovement('gained')).toBe(true)
    expect(isPromptMovement('unchanged')).toBe(true)
    expect(isPromptMovement('same')).toBe(false)

    expect(isCitationClass('target')).toBe(true)
    expect(isCitationClass('own')).toBe(true)
    expect(isCitationClass('competitor')).toBe(true)
    expect(isCitationClass('other')).toBe(true)
    expect(isCitationClass('you')).toBe(false)

    expect(isCheckErrorCode('token_expired')).toBe(true)
    expect(isCheckErrorCode('empty')).toBe(true)
    expect(isCheckErrorCode('no_aio')).toBe(false)

    expect(VISIBILITY_POINT_PAGE_CITED).toBe(3)
    expect(VISIBILITY_POINT_OTHER_OWN).toBe(1)
    expect(VISIBILITY_POINT_BRAND_MENTIONED).toBe(1)
    expect(VISIBILITY_POINT_NOT_CITED).toBe(0)
    expect(STALE_CHECK_DAYS).toBe(7)
    expect(TRAY_MENU_CHECK_LIMIT).toBe(5)

    expect(SMTP_PRESETS).toHaveLength(8)
    expect(SMTP_PRESETS.map((preset) => preset.provider)).toEqual([
      'gmail',
      'microsoft365',
      'ses',
      'sendgrid',
      'mailgun',
      'resend',
      'postmark',
      'other'
    ])
    expect(isSmtpSecurity('starttls')).toBe(true)
    expect(isSmtpSecurity('ssl')).toBe(true)
    expect(isSmtpSecurity('none')).toBe(true)
    expect(isEmailMode('smtp')).toBe(true)
    expect(isEmailMode('mail_app')).toBe(true)
    expect(isExportFormat('pdf')).toBe(true)
    expect(isExportFormat('xlsx')).toBe(true)
    expect(isExportFormat('csv')).toBe(true)
    expect(isExportFormat('html')).toBe(true)
    expect(isExportFormat('json')).toBe(true)
    expect(isExportFormat('docx')).toBe(false)
    expect(isExportFormat('excel')).toBe(false)
    expect(isReportFormat('pdf')).toBe(true)
    expect(isReportFormat('excel')).toBe(true)
    expect(isReportFormat('csv')).toBe(true)
    expect(isReportFormat('html_link')).toBe(true)
    expect(isReportFormat('summary')).toBe(true)
    expect(isReportFormat('xlsx')).toBe(false)
    expect(REPORT_FORMATS).toEqual(['pdf', 'excel', 'csv', 'html_link', 'summary'])
    expect(DEFAULT_REPORT_SCHEDULE_STATUS).toBe('active')
    expect(isReportScheduleStatus('active')).toBe(true)
    expect(isReportScheduleStatus('paused')).toBe(true)
    expect(isReportScheduleStatus('archived')).toBe(false)
    expect(REPORT_SCHEDULE_STATUSES).toEqual(['active', 'paused'])
    expect(SUMMARY_STYLES).toEqual(['standard', 'client_friendly'])
    expect(isSummaryStyle('standard')).toBe(true)
    expect(isSummaryStyle('client_friendly')).toBe(true)
    expect(isSummaryStyle('brief')).toBe(false)
    expect(CHANGE_KINDS).toEqual(['lost_citation', 'gained_citation', 'score_drop', 'check_failed'])
    expect(isChangeKind('lost_citation')).toBe(true)
    expect(isChangeKind('gained_citation')).toBe(true)
    expect(isChangeKind('score_drop')).toBe(true)
    expect(isChangeKind('check_failed')).toBe(true)
    expect(isChangeKind('prompt_lost')).toBe(false)
    expect(DELIVERY_TRIGGERS).toEqual([
      'account_test',
      'report_test',
      'after_check',
      'weekly',
      'monthly',
      'on_change',
      'check_summary',
      'slack',
      'cap',
      'monthly_pdf',
      'export'
    ])
    expect(isDeliveryTrigger('account_test')).toBe(true)
    expect(isDeliveryTrigger('monthly_pdf')).toBe(true)
    expect(isDeliveryTrigger('nope')).toBe(false)
    expect(DELIVERY_OUTCOMES).toEqual(['sent', 'draft', 'failed'])
    expect(isDeliveryOutcome('sent')).toBe(true)
    expect(isDeliveryOutcome('draft')).toBe(true)
    expect(isDeliveryOutcome('failed')).toBe(true)
    expect(isDeliveryOutcome('queued')).toBe(false)
    expect(isQueueState('paused_today')).toBe(true)
    expect(isCapRule('allow_10')).toBe(true)
    expect(isCapRule('overage')).toBe(false)
  })
})
