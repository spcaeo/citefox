import { describe, expect, test } from 'vitest'
import { GENERATION_TEMPLATE_KINDS } from './templates'
import {
  DEFAULT_TEMPLATE_SETTINGS,
  PLANNED_TEMPLATE_KINDS,
  TEMPLATE_KIND_INFO,
  TEMPLATE_KIND_RETIREMENTS,
  TEMPLATE_STEP_ORDER,
  compareTemplateKinds,
  isListedTemplateStep,
  isRunnableTemplateKind,
  isTemplateTone,
  readTemplateSettings,
  replacementKinds,
  sameTemplateSettings,
  settingsForKind,
  templateKindInfo,
  templateKindLifecycle,
  templateLanguageLabel,
  templateStepIndex,
  type TemplateLifecycleTables,
  type TemplateSettings
} from './template-kinds'

const ALL: TemplateSettings = {
  model: 'claude-opus-5-5',
  language: 'es',
  promptCount: 12,
  tone: 'search_short'
}

describe('template kinds', () => {
  test('every shipped kind has copy and a place in run order', () => {
    for (const kind of GENERATION_TEMPLATE_KINDS) {
      expect(TEMPLATE_KIND_INFO[kind]).toBeDefined()
      expect(TEMPLATE_STEP_ORDER).toContain(kind)
      expect(templateKindInfo(kind)).toBe(TEMPLATE_KIND_INFO[kind])
    }
  })

  test('an unknown kind gets generic copy and analysis settings', () => {
    expect(templateKindInfo('faq_writer')).toEqual({
      label: 'Faq writer',
      file: 'faq_writer.md',
      description: 'The faq writer step.',
      schemaLabel: 'The output fields',
      settings: { language: true, promptCount: false, tones: [] },
      usageNoun: ['faq writer output', 'faq writer outputs']
    })
  })

  test('run order puts aio_gap before run_summary and unknown kinds last by name', () => {
    const sorted = [
      'zeta_step',
      'run_summary',
      'alpha_step',
      'aio_gap',
      'buyer_profile',
      'coverage'
    ]
      .slice()
      .sort(compareTemplateKinds)
    expect(sorted).toEqual([
      'buyer_profile',
      'coverage',
      'aio_gap',
      'run_summary',
      'alpha_step',
      'zeta_step'
    ])
    expect(templateStepIndex('buyer_profile')).toBe(0)
    expect(templateStepIndex('nope')).toBe(TEMPLATE_STEP_ORDER.length)
    expect(compareTemplateKinds('coverage', 'coverage')).toBe(0)
  })

  test('tones', () => {
    expect(isTemplateTone('plain')).toBe(true)
    expect(isTemplateTone('search_short')).toBe(true)
    expect(isTemplateTone('loud')).toBe(false)
  })
})

describe('template settings', () => {
  test('settings that do not apply to a kind are dropped', () => {
    expect(settingsForKind('buyer_profile', { ...ALL, tone: 'plain' })).toEqual({
      model: 'claude-opus-5-5',
      language: 'es',
      promptCount: null,
      tone: 'plain'
    })
    // Buyer prompts are long situational questions: never search-style short.
    expect(settingsForKind('buyer_prompts', ALL)).toEqual({ ...ALL, tone: null })
    expect(settingsForKind('buyer_prompts', { ...ALL, tone: 'conversational' }).tone).toBe(
      'conversational'
    )
    expect(settingsForKind('coverage', ALL)).toEqual({
      model: 'claude-opus-5-5',
      language: 'es',
      promptCount: null,
      tone: null
    })
    expect(settingsForKind('aio_gap', ALL).tone).toBeNull()
    expect(settingsForKind('unknown_step', ALL)).toEqual({
      ...ALL,
      promptCount: null,
      tone: null
    })
  })

  test('stored settings are read field by field, anything unreadable is the default', () => {
    expect(readTemplateSettings(null)).toEqual(DEFAULT_TEMPLATE_SETTINGS)
    expect(readTemplateSettings([1, 2])).toEqual(DEFAULT_TEMPLATE_SETTINGS)
    expect(readTemplateSettings('{"model":"x"}')).toEqual(DEFAULT_TEMPLATE_SETTINGS)
    expect(readTemplateSettings(ALL)).toEqual(ALL)
    expect(readTemplateSettings({ model: '  claude-haiku-5-5  ', extra: true })).toEqual({
      ...DEFAULT_TEMPLATE_SETTINGS,
      model: 'claude-haiku-5-5'
    })
    expect(
      readTemplateSettings({
        model: 'has spaces in it',
        language: 'x'.repeat(17),
        promptCount: 31,
        tone: 'loud'
      })
    ).toEqual(DEFAULT_TEMPLATE_SETTINGS)
    expect(readTemplateSettings({ promptCount: 0 }).promptCount).toBeNull()
    expect(readTemplateSettings({ promptCount: 2.5 }).promptCount).toBeNull()
    expect(readTemplateSettings({ promptCount: 30 }).promptCount).toBe(30)
    expect(readTemplateSettings({ language: '' }).language).toBeNull()
    expect(readTemplateSettings({ model: 7 }).model).toBeNull()
    // The default is copied, never shared.
    expect(readTemplateSettings(null)).not.toBe(DEFAULT_TEMPLATE_SETTINGS)
  })

  test('sameTemplateSettings compares every field', () => {
    expect(sameTemplateSettings(ALL, { ...ALL })).toBe(true)
    expect(sameTemplateSettings(ALL, { ...ALL, model: null })).toBe(false)
    expect(sameTemplateSettings(ALL, { ...ALL, language: 'fr' })).toBe(false)
    expect(sameTemplateSettings(ALL, { ...ALL, promptCount: 3 })).toBe(false)
    expect(sameTemplateSettings(ALL, { ...ALL, tone: 'plain' })).toBe(false)
  })

  test('language labels', () => {
    expect(templateLanguageLabel(null)).toBe("Market's language")
    expect(templateLanguageLabel('es')).toBe('Spanish')
    expect(templateLanguageLabel('ja')).toBe('Japanese')
    expect(templateLanguageLabel('sw')).toBe('sw')
  })
})

describe('template kind lifecycle (Docs/PROMPT-AUDIT.md section 3, rule 6)', () => {
  test('every planned kind and every replacement is a registered kind with a package', () => {
    for (const [kind, pkg] of Object.entries(PLANNED_TEMPLATE_KINDS)) {
      expect(GENERATION_TEMPLATE_KINDS).toContain(kind)
      expect(pkg).toMatch(/^P[0-9A-Z]+$/)
    }
    for (const [kind, replacedBy] of Object.entries(TEMPLATE_KIND_RETIREMENTS)) {
      expect(GENERATION_TEMPLATE_KINDS).toContain(kind)
      expect(replacedBy.length).toBeGreaterThan(0)
      for (const next of replacedBy) expect(GENERATION_TEMPLATE_KINDS).toContain(next)
    }
  })

  test('as shipped: nothing is planned, and every combined kind is retired', () => {
    expect(Object.keys(PLANNED_TEMPLATE_KINDS)).toEqual([])
    // P6 shipped both sentiment replacements.
    expect(templateKindLifecycle('sentiment_claims')).toBe('retired')
    for (const kind of ['sentiment_claims_v2', 'sentiment_fact_check']) {
      expect(templateKindLifecycle(kind)).toBe('live')
      expect(isRunnableTemplateKind(kind)).toBe(true)
      expect(isListedTemplateStep(kind, true)).toBe(true)
    }
    // P1 shipped the three content-gap steps, so the combined coverage step is retired.
    for (const kind of ['coverage_matrix', 'page_audit', 'coverage_fixes']) {
      expect(templateKindLifecycle(kind)).toBe('live')
      expect(isRunnableTemplateKind(kind)).toBe(true)
    }
    expect(templateKindLifecycle('coverage')).toBe('retired')
    expect(isListedTemplateStep('coverage', false)).toBe(false)
    expect(isListedTemplateStep('coverage', true)).toBe(true)
    // P5 shipped its replacements, so its combined kinds are retired.
    expect(templateKindLifecycle('topic_fix_draft')).toBe('live')
    expect(templateKindLifecycle('topic_why_not_cited')).toBe('retired')
    expect(templateKindLifecycle('topic_explain_citation')).toBe('retired')
    for (const kind of Object.keys(TEMPLATE_KIND_RETIREMENTS)) {
      const shipped = replacementKinds(kind).every((next) => !(next in PLANNED_TEMPLATE_KINDS))
      expect(templateKindLifecycle(kind)).toBe(shipped ? 'retired' : 'live')
      expect(isRunnableTemplateKind(kind)).toBe(!shipped)
    }
    // P4 shipped both replacements of the competitor page step.
    expect(templateKindLifecycle('competitor_page_questions')).toBe('retired')
    expect(templateKindLifecycle('competitor_page_questions_v2')).toBe('live')
    expect(templateKindLifecycle('competitor_page_claims')).toBe('live')
    // P3 shipped both replacements of the profile assists.
    expect(templateKindLifecycle('topic_profile_discover')).toBe('retired')
    expect(templateKindLifecycle('topic_profile_discover_v2')).toBe('live')
    expect(templateKindLifecycle('topic_profile_rewrite')).toBe('live')
    // A kind outside the tables (and a prototype key) is live.
    expect(templateKindLifecycle('buyer_profile')).toBe('live')
    expect(templateKindLifecycle('some_new_step')).toBe('live')
    expect(templateKindLifecycle('constructor')).toBe('live')
  })

  test('a combined kind retires once none of its replacements is planned', () => {
    const partly: TemplateLifecycleTables = {
      planned: { page_audit: 'P1' },
      retirements: { coverage: ['coverage_matrix', 'page_audit', 'coverage_fixes'] }
    }
    expect(templateKindLifecycle('coverage', partly)).toBe('live')
    expect(templateKindLifecycle('coverage_matrix', partly)).toBe('live')
    expect(templateKindLifecycle('page_audit', partly)).toBe('planned')

    const shipped: TemplateLifecycleTables = { planned: {}, retirements: partly.retirements }
    expect(templateKindLifecycle('coverage', shipped)).toBe('retired')
    expect(isRunnableTemplateKind('coverage', shipped)).toBe(false)
    expect(isRunnableTemplateKind('page_audit', shipped)).toBe(true)
  })

  test('a retired step lists only with a project version; a planned one never', () => {
    const tables: TemplateLifecycleTables = {
      planned: { topic_fix_draft: 'P5' },
      retirements: { topic_explain_citation: ['topic_citation_diagnosis'] }
    }
    expect(isListedTemplateStep('topic_explain_citation', false, tables)).toBe(false)
    expect(isListedTemplateStep('topic_explain_citation', true, tables)).toBe(true)
    expect(isListedTemplateStep('topic_fix_draft', true, tables)).toBe(false)
    expect(isListedTemplateStep('topic_citation_diagnosis', false, tables)).toBe(true)
  })

  test('replacementKinds lists the new steps in run order', () => {
    expect(replacementKinds('topic_why_not_cited')).toEqual([
      'topic_citation_diagnosis',
      'topic_fix_draft'
    ])
    expect(replacementKinds('coverage')).toEqual([
      'coverage_matrix',
      'page_audit',
      'coverage_fixes'
    ])
    expect(replacementKinds('buyer_profile')).toEqual([])
  })
})
