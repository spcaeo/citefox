import { afterEach, describe, expect, test } from 'vitest'
import { createLogger } from '../logging/logger'
import { REDACTED } from '../logging/redact'
import type { ClaudeCompletion, ClaudeProvider } from '../providers/claude/claude-code'
import { emptyClaudeCliUsage, type ClaudeCliUsage } from '../providers/claude/parse'
import { ProviderError } from '../providers/errors'
import type { HttpTransport } from '../providers/http'
import { MemorySecretStore } from '../secrets/secret-store'
import { openAppDatabase } from '../storage/app-database'
import { getLatestSnapshot, listGenerations } from '../storage/content-records'
import { closeDatabase, openSqliteDatabase, type SqliteDatabase } from '../storage/database'
import { addPageMarket, getPage, insertPage } from '../storage/pages'
import { ensureProjectSchema, insertMarket, writeProjectProfile } from '../storage/project-profile'
import { getCurrentOverride } from '../storage/template-overrides'
import { applyTemplateChoices } from '../engine/project-settings/template-choices'
import { PipelineError } from './errors'
import { BUYER_PROFILE_TEMPLATE } from './template-bodies'
import {
  TemplateContractError,
  createGenerationTemplate,
  deleteGenerationTemplate
} from './templates'
import { completeStructured, modelUsageFromCompletion } from './llm'
import { readPage } from './page-reader'
import {
  generateBuyerProfile,
  generateBuyerPrompts,
  generateCoverage,
  readPromptSetVersion,
  runPageSetup,
  savePromptEdits,
  type PageSetupDeps
} from './setup'
import {
  TEXTBOLT_H1,
  TEXTBOLT_PROFILE,
  TEXTBOLT_PROMPTS_EN,
  TEXTBOLT_PROMPTS_ES,
  TEXTBOLT_URL,
  textboltGapReply,
  textboltJinaBody
} from './textbolt-fixture'

const databases: SqliteDatabase[] = []
const NOW = '2026-10-19T12:00:00.000Z'
const ORIGINAL_FETCH = globalThis.fetch

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  for (const db of databases.splice(0)) closeDatabase(db)
})

describe('ClaudeCompletion.usage', () => {
  test('records usage counts and ignores the top-level token fields and cost', () => {
    const completion = fakeCompletion(TEXTBOLT_PROFILE, { inputTokens: 101, outputTokens: 55 })
    completion.inputTokens = 11
    completion.outputTokens = 22
    completion.usage.totalCostUsd = 1.25
    expect(modelUsageFromCompletion(completion)).toEqual({
      inputTokens: 101,
      outputTokens: 55,
      cacheReadTokens: 7,
      cacheCreationTokens: 3,
      serpapiSearches: 0
    })
    const empty = fakeCompletion({}, {})
    empty.usage = emptyClaudeCliUsage()
    empty.inputTokens = 9
    expect(modelUsageFromCompletion(empty).inputTokens).toBe(0)
  })
})

describe('page setup', () => {
  test('reproduces the TextBolt profile, ten prompts, and coverage matrix offline', async () => {
    globalThis.fetch = (() => {
      throw new Error('network')
    }) as typeof fetch
    const script = scriptedProvider((prompt) => route(prompt))
    const { deps, transportCalls } = fixtureDeps(script.provider)
    const result = await runPageSetup(deps, 'page-1')

    expect(transportCalls.some((url) => url.startsWith('https://r.jina.ai/'))).toBe(true)
    expect(result.profile.who).toBe(TEXTBOLT_PROFILE.who)
    expect(result.profile.templateId).toBe('tpl-buyer-profile')
    expect(result.profile.templateName).toBe('CiteFox default')
    expect(result.profile.templateHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.profile.templateUpdatedAt).toBeNull()
    expect(result.profile.promptsStale).toBe(false)
    expect(result.prompts.prompts).toHaveLength(10)
    expect(result.prompts.version).toBe(1)
    expect(result.prompts.templateId).toBe('tpl-buyer-prompts')
    expect(result.prompts.templateName).toBe('CiteFox default')
    expect(result.prompts.templateHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.prompts.templateUpdatedAt).toBeNull()
    expect(result.prompts.brandsClear).toBe(true)
    expect(result.prompts.dirty).toBe(false)
    const texts = result.prompts.prompts.map((prompt) => prompt.variants[0]?.text)
    expect(texts).toEqual(TEXTBOLT_PROMPTS_EN.prompts.map((prompt) => prompt.text))
    for (const text of texts) {
      expect(text?.toLowerCase().includes('textbolt')).toBe(false)
      expect(text?.toLowerCase().includes('text bolt')).toBe(false)
    }
    expect(result.coverage.rows.map((row) => row.coverage)).toEqual([
      'partial',
      'strong',
      'strong',
      'partial',
      'weak',
      'partial',
      'strong',
      'partial',
      'strong',
      'strong'
    ])
    expect(result.coverage.reused).toBe(false)
    expect(result.coverage.templateId).toBe('tpl-coverage-matrix')
    expect(result.coverage.templateName).toBe('CiteFox default')
    expect(result.coverage.templateUpdatedAt).toBeNull()
    const snapshot = getLatestSnapshot(deps.projectDb, 'page-1')
    const blob = snapshot?.bodyText ?? ''
    for (const row of result.coverage.rows) {
      for (const place of row.whereCovered) {
        expect(blob.includes(place) || place === TEXTBOLT_H1).toBe(true)
      }
    }
    expect(result.coverage.rows[4]?.priority).toBe('high')
    expect(result.coverage.rows[4]?.actions).toContain('new_faq')
    expect(getPage(deps.projectDb, 'page-1', 'proj-1')).toMatchObject({
      status: 'setting_up',
      setupStep: 'check',
      promptSetVersion: 1
    })
    const usage = listGenerations(deps.projectDb, 'page-1')
    expect(usage.length).toBeGreaterThan(0)
    for (const row of usage) {
      expect(row.usage).toEqual({
        inputTokens: 101,
        outputTokens: 55,
        cacheReadTokens: 7,
        cacheCreationTokens: 3,
        serpapiSearches: 0
      })
      expect(row.ok).toBe(true)
    }
    // Profile, prompts, then the gaps: 1 matrix batch, 1 audit, 2 fixes batches (5 rows not strong, at most 3 each).
    expect(script.calls).toBe(6)
    expect(result.coverage.rows.filter((row) => row.suggestedFaq !== null)).toHaveLength(5)
    expect(result.coverage.rows[1]?.suggestedFaq).toBeNull()
    // A strong row has nothing to update and never opens with "None".
    const strong = result.coverage.rows.filter((row) => row.coverage === 'strong')
    expect(strong.length).toBeGreaterThan(0)
    for (const row of strong) {
      expect(row.whatToUpdate).toBe('')
      expect(row.mainGap).not.toMatch(/^none\b/iu)
    }
    expect(result.coverage.findings.map((finding) => finding.kind)).toEqual([
      'factual_claim',
      'typo',
      'missing_promised_section'
    ])

    const again = await generateCoverage(deps, 'page-1')
    expect(again.reused).toBe(true)
    expect(script.calls).toBe(6)
  })

  test('retries a schema miss once, then fails without saving a profile', async () => {
    const script = scriptedProvider(() => ({ who: 1 }))
    const deps = await prepared(script.provider)
    await expect(generateBuyerProfile(deps, 'page-1')).rejects.toMatchObject({
      code: 'schema_validation'
    })
    expect(script.calls).toBe(2)
    expect(listGenerations(deps.projectDb, 'page-1')).toHaveLength(2)
    expect(listGenerations(deps.projectDb, 'page-1').every((row) => row.ok === false)).toBe(true)
    expect(listGenerations(deps.projectDb, 'page-1')[0]?.usage.inputTokens).toBe(101)
    const profiles = deps.projectDb
      .prepare<unknown[], { n: number }>('SELECT COUNT(*) AS n FROM buyer_profiles')
      .get()
    expect(profiles?.n).toBe(0)

    const retry = scriptedProvider((prompt) =>
      prompt.includes('failed validation') ? TEXTBOLT_PROFILE : { who: 1 }
    )
    const retryDeps = await prepared(retry.provider)
    const profile = await generateBuyerProfile(retryDeps, 'page-1')
    expect(profile.who).toBe(TEXTBOLT_PROFILE.who)
    expect(retry.calls).toBe(2)
  })

  test('retries a brand name once and fails a quote that is not on the page', async () => {
    const branded = {
      prompts: TEXTBOLT_PROMPTS_EN.prompts.map((prompt, index) =>
        index === 0
          ? { ...prompt, text: 'How does TextBolt alert the whole crew on Saturday?' }
          : prompt
      )
    }
    const script = scriptedProvider((prompt) => {
      if (prompt.includes('Write six parts')) return TEXTBOLT_PROFILE
      if (prompt.includes('failed validation')) return TEXTBOLT_PROMPTS_EN
      return branded
    })
    const deps = await prepared(script.provider)
    await generateBuyerProfile(deps, 'page-1')
    const prompts = await generateBuyerPrompts(deps, 'page-1')
    expect(prompts.brandsClear).toBe(true)
    expect(prompts.prompts[0]?.variants[0]?.text.includes('TextBolt')).toBe(false)

    const quotes = scriptedProvider((prompt) => {
      if (prompt.includes('Write six parts')) return TEXTBOLT_PROFILE
      if (prompt.startsWith('Template: coverage_matrix.md')) {
        const reply = textboltGapReply(prompt) as { rows: { whereCovered: string[] }[] }
        return {
          rows: reply.rows.map((row) => ({
            ...row,
            whereCovered: ['This heading was invented for the test']
          }))
        }
      }
      return textboltGapReply(prompt) ?? TEXTBOLT_PROMPTS_EN
    })
    const quoted = await prepared(quotes.provider)
    await generateBuyerProfile(quoted, 'page-1')
    await generateBuyerPrompts(quoted, 'page-1')
    await expect(generateCoverage(quoted, 'page-1')).rejects.toMatchObject({
      code: 'quote_not_on_page'
    })
    const coverageCalls = listGenerations(quoted.projectDb, 'page-1').filter(
      (row) => row.kind === 'coverage_matrix'
    )
    expect(coverageCalls).toHaveLength(2)
    const runs = quoted.projectDb
      .prepare<unknown[], { n: number }>('SELECT COUNT(*) AS n FROM coverage_runs')
      .get()
    expect(runs?.n).toBe(0)
  })

  test('retries a short keyword prompt once and stores the situational rewrite whole', async () => {
    const tooShort = 'text alerts for employees, no developer'
    expect(tooShort.trim().split(/\s+/)).toHaveLength(6)
    let repairPrompt = ''
    const script = scriptedProvider((prompt) => {
      if (prompt.includes('Write six parts')) return TEXTBOLT_PROFILE
      if (prompt.includes('failed validation')) {
        repairPrompt = prompt
        return TEXTBOLT_PROMPTS_EN
      }
      return {
        prompts: TEXTBOLT_PROMPTS_EN.prompts.map((promptRow, index) =>
          index === 0 ? { ...promptRow, text: tooShort } : promptRow
        )
      }
    })
    const deps = await prepared(script.provider)
    await generateBuyerProfile(deps, 'page-1')
    const prompts = await generateBuyerPrompts(deps, 'page-1')
    const saved = prompts.prompts[0]?.variants[0]?.text
    expect(saved).toBe(TEXTBOLT_PROMPTS_EN.prompts[0]?.text)
    expect(saved?.startsWith('text alerts for employees')).toBe(false)
    expect(repairPrompt).toContain(
      'A buyer prompt is 6 words. Write it as a full situational question of at least 8 words.'
    )
    expect(repairPrompt.includes(tooShort)).toBe(false)
    const promptCalls = listGenerations(deps.projectDb, 'page-1').filter(
      (row) => row.kind === 'buyer_prompts'
    )
    expect(promptCalls.map((row) => row.ok)).toEqual([false, true])

    const stillShort = scriptedProvider((prompt) => {
      if (prompt.includes('Write six parts')) return TEXTBOLT_PROFILE
      return {
        prompts: TEXTBOLT_PROMPTS_EN.prompts.map((promptRow, index) =>
          index === 0 ? { ...promptRow, text: tooShort } : promptRow
        )
      }
    })
    const failed = await prepared(stillShort.provider)
    await generateBuyerProfile(failed, 'page-1')
    await expect(generateBuyerPrompts(failed, 'page-1')).rejects.toMatchObject({
      code: 'schema_validation',
      message:
        'A buyer prompt is 6 words. Write it as a full situational question of at least 8 words.'
    })
    const failedCalls = listGenerations(failed.projectDb, 'page-1').filter(
      (row) => row.kind === 'buyer_prompts'
    )
    expect(failedCalls).toHaveLength(2)
    expect(failedCalls.every((row) => row.ok === false)).toBe(true)
    const stored = failed.projectDb
      .prepare<unknown[], { n: number }>('SELECT COUNT(*) AS n FROM prompt_sets')
      .get()
    expect(stored?.n).toBe(0)
  })

  test('does not retry a provider failure, reuses a cached completion, and keeps prompt versions', async () => {
    const secret = 'sk-ant-api03-abcdefghij'
    const failing = scriptedProvider(() => {
      throw new ProviderError(`claude failed ${secret}`, {
        code: 'network',
        state: 'warning',
        nextStep: 'Try again.',
        secrets: [secret]
      })
    })
    const deps = await prepared(failing.provider, { secrets: [secret] })
    let thrown = ''
    try {
      await generateBuyerProfile(deps, 'page-1')
    } catch (error) {
      thrown = error instanceof Error ? error.message : ''
      expect(error).toBeInstanceOf(PipelineError)
    }
    expect(failing.calls).toBe(1)
    expect(thrown.includes(secret)).toBe(false)
    expect(thrown.includes(REDACTED)).toBe(true)
    const stored = deps.projectDb
      .prepare<unknown[], { error: string | null }>('SELECT error FROM generations')
      .get()
    expect(stored?.error?.includes(secret)).toBe(false)

    const cached = scriptedProvider(() => TEXTBOLT_PROFILE)
    const cacheDeps = await prepared(cached.provider)
    await generateBuyerProfile(cacheDeps, 'page-1')
    cacheDeps.projectDb.prepare(`DELETE FROM buyer_profiles`).run()
    await generateBuyerProfile(cacheDeps, 'page-1')
    expect(cached.calls).toBe(1)

    const prompts = scriptedProvider((prompt) =>
      prompt.includes('Write six parts') ? TEXTBOLT_PROFILE : TEXTBOLT_PROMPTS_EN
    )
    const promptDeps = await prepared(prompts.provider)
    await generateBuyerProfile(promptDeps, 'page-1')
    const first = await generateBuyerPrompts(promptDeps, 'page-1')
    const edited = first.prompts.map((prompt, index) =>
      index === 0
        ? {
            ...prompt,
            variants: prompt.variants.map((variant) => ({
              ...variant,
              text: 'How can a small team alert employees without a developer or a new app?'
            }))
          }
        : prompt
    )
    const second = savePromptEdits(promptDeps.projectDb, 'page-1', edited, {
      projectId: 'proj-1',
      now: () => NOW
    })
    expect(second.version).toBe(2)
    expect(
      readPromptSetVersion(promptDeps.projectDb, 'page-1', 1).prompts[0]?.variants[0]?.text
    ).toBe(TEXTBOLT_PROMPTS_EN.prompts[0]?.text)
    expect(() =>
      savePromptEdits(
        promptDeps.projectDb,
        'page-1',
        edited.map((prompt, index) =>
          index === 0
            ? {
                ...prompt,
                variants: prompt.variants.map((variant) => ({
                  ...variant,
                  text: 'How does TextBolt alert the crew without a developer today?'
                }))
              }
            : prompt
        ),
        { projectId: 'proj-1', now: () => NOW }
      )
    ).toThrow(PipelineError)
  })

  test('saves an owner-written first-person situational prompt and rejects a keyword prompt', async () => {
    const script = scriptedProvider((prompt) =>
      prompt.includes('Write six parts') ? TEXTBOLT_PROFILE : TEXTBOLT_PROMPTS_EN
    )
    const deps = await prepared(script.provider)
    await generateBuyerProfile(deps, 'page-1')
    const first = await generateBuyerPrompts(deps, 'page-1')
    const withText = (text: string): typeof first.prompts =>
      first.prompts.map((prompt, index) =>
        index === 0
          ? { ...prompt, variants: prompt.variants.map((variant) => ({ ...variant, text })) }
          : prompt
      )
    const own =
      'We write the crew update on Friday afternoon, so how do I get it onto my field techs’ phones at 6am Saturday without logging in?'
    const saved = savePromptEdits(deps.projectDb, 'page-1', withText(own), {
      projectId: 'proj-1',
      now: () => NOW
    })
    expect(saved.prompts[0]?.variants[0]?.text).toBe(own)
    expect(() =>
      savePromptEdits(deps.projectDb, 'page-1', withText('sms alert software for small business'), {
        projectId: 'proj-1',
        now: () => NOW
      })
    ).toThrow('A buyer prompt is 6 words.')
  })

  test('passes the outline, FAQs, last-modified date, and a readable profile', async () => {
    const prompts: string[] = []
    const script = scriptedProvider((prompt) => {
      prompts.push(prompt)
      return route(prompt)
    })
    const deps = await prepared(script.provider)
    const probe =
      'Write six parts.\nOUTLINE<{{ outline }}>\nFAQS<{{ faqs }}>\nMOD<{{ last_modified }}>'
    const custom = createGenerationTemplate(
      deps.appDb,
      { kind: 'buyer_profile', name: 'Probe', body: probe },
      { id: 'tpl-probe', now: NOW }
    )
    await generateBuyerProfile(deps, 'page-1', { templateId: custom.id })
    const rendered = prompts[0] ?? ''
    expect(rendered).toContain(
      'OUTLINE<H2: What Are Business Text Alerts, and Why Send Them by Text?\nH2: Ways to Send Scheduled Text Alerts From Email (has a table)\n  H3: 1. Email to SMS Gateway With Gmail or Outlook Schedule Send'
    )
    expect(rendered).toContain(
      'FAQS<FAQ 1. Q: What is the difference between text alerts and SMS marketing campaigns?\nA: Text alerts are SMS messages'
    )
    expect(rendered).toContain('MOD<Not stated on the page. Published 2026-07-28T11:22:29.000Z.>')

    await generateBuyerPrompts(deps, 'page-1')
    const promptCall = prompts.find((prompt) => prompt.includes('You are writing buyer prompts'))
    expect(promptCall).toContain(`Buyer profile:\nWho: ${TEXTBOLT_PROFILE.who}`)
    expect(promptCall).toContain(
      'Trigger events:\n- A missed alert caused real damage over a weekend.'
    )
    expect(promptCall?.includes('{"who"')).toBe(false)
  })

  test('caps the page text a template receives', async () => {
    const prompts: string[] = []
    const script = scriptedProvider((prompt) => {
      prompts.push(prompt)
      return route(prompt)
    })
    const deps = await prepared(script.provider)
    const long = Array.from({ length: 4000 }, (_, index) => `Paragraph ${index} ${'w '.repeat(20)}`)
    deps.projectDb
      .prepare('UPDATE snapshots SET body_text = ? WHERE page_id = ?')
      .run(long.join('\n\n'), 'page-1')
    await generateBuyerProfile(deps, 'page-1', { force: true })
    const rendered = prompts[0] ?? ''
    expect(rendered).toContain('[Page text cut here to fit. The live page continues.]')
    expect(rendered.includes('Paragraph 3999')).toBe(false)
    expect(rendered.length).toBeLessThan(80_000)
  })

  test('a different model or connection does not reuse the cached output', async () => {
    const script = scriptedProvider(() => TEXTBOLT_PROFILE)
    const deps = await prepared(script.provider, { model: 'claude-model-a' })
    await generateBuyerProfile(deps, 'page-1')
    expect(script.calls).toBe(1)
    const clearProfiles = (): void => {
      deps.projectDb.prepare('DELETE FROM buyer_profiles').run()
    }
    clearProfiles()
    await generateBuyerProfile({ ...deps, model: 'claude-model-a' }, 'page-1')
    expect(script.calls).toBe(1)
    clearProfiles()
    await generateBuyerProfile({ ...deps, model: 'claude-model-b' }, 'page-1')
    expect(script.calls).toBe(2)
    clearProfiles()
    await generateBuyerProfile({ ...deps, model: 'claude-model-b' }, 'page-1')
    expect(script.calls).toBe(2)
    clearProfiles()
    const api = { ...script.provider, id: 'anthropic-api' as const }
    await generateBuyerProfile({ ...deps, model: 'claude-model-b', provider: api }, 'page-1')
    expect(script.calls).toBe(3)
  })

  test('a schema retry is not sent once the call cap is reached', async () => {
    const script = scriptedProvider(() => ({ who: 1 }))
    const deps = await prepared(script.provider)
    const call = (daily: number): Promise<unknown> =>
      completeStructured({
        db: deps.projectDb,
        pageId: 'page-1',
        provider: deps.provider,
        logger: deps.logger,
        kind: 'buyer_profile',
        templateId: 'tpl-buyer-profile',
        templateHash: 'a'.repeat(64),
        prompt: `Write six parts. ${daily}`,
        schema: {},
        inputHash: String(daily).repeat(64).slice(0, 64),
        validate: () => ({ code: 'schema_validation', message: 'The reply did not match.' }),
        now: () => NOW,
        caps: { daily, monthly: null }
      })
    await expect(call(1)).rejects.toMatchObject({
      message: 'The daily CiteFox AI cap is reached, so this generation was not run.'
    })
    expect(script.calls).toBe(1)
    await expect(call(5)).rejects.toMatchObject({ code: 'schema_validation' })
    expect(script.calls).toBe(3)
  })

  test('falls back to the default template and rejects a deleted or wrong-kind id', async () => {
    const script = scriptedProvider((prompt) => route(prompt))
    const deps = await prepared(script.provider)
    const custom = createGenerationTemplate(
      deps.appDb,
      { kind: 'buyer_profile', name: 'Field teams', body: BUYER_PROFILE_TEMPLATE },
      { id: 'tpl-field', now: NOW }
    )
    const profile = await generateBuyerProfile(deps, 'page-1', { templateId: custom.id })
    expect(profile.templateId).toBe('tpl-field')
    expect(profile.templateName).toBe('Field teams')
    deleteGenerationTemplate(deps.appDb, custom.id, NOW)
    await expect(
      generateBuyerProfile(deps, 'page-1', { force: true, templateId: custom.id })
    ).rejects.toBeInstanceOf(TemplateContractError)
    await expect(
      generateBuyerProfile(deps, 'page-1', { force: true, templateId: 'tpl-coverage' })
    ).rejects.toMatchObject({ code: 'kind_mismatch', channel: 'buyerProfile:generate' })
    const fallback = await generateBuyerProfile(deps, 'page-1', { force: true })
    expect(fallback.templateId).toBe('tpl-buyer-profile')
    expect(fallback.templateName).toBe('CiteFox default')
  })

  test("uses the project's template choice as its version, and the default once reset (TPL-1)", async () => {
    const script = scriptedProvider((prompt) => route(prompt))
    const deps = await prepared(script.provider)
    const custom = createGenerationTemplate(
      deps.appDb,
      { kind: 'buyer_profile', name: 'Clinics', body: BUYER_PROFILE_TEMPLATE },
      { id: 'tpl-clinics', now: NOW }
    )
    let sequence = 0
    const clock = { now: NOW, createId: () => `choice-${++sequence}` }
    applyTemplateChoices(
      deps.appDb,
      deps.projectDb,
      [{ kind: 'buyer_profile', templateId: custom.id }],
      clock
    )
    const overridden = await generateBuyerProfile(deps, 'page-1')
    expect(overridden.templateId).toBe('ovr-choice-1')
    expect(getCurrentOverride(deps.projectDb, 'buyer_profile')?.baseTemplateId).toBe('tpl-clinics')
    // The project keeps its version even when the library template is deleted.
    deleteGenerationTemplate(deps.appDb, custom.id, NOW)
    const kept = await generateBuyerProfile(deps, 'page-1', { force: true })
    expect(kept.templateId).toBe('ovr-choice-1')
    applyTemplateChoices(deps.appDb, deps.projectDb, [], clock)
    const fallback = await generateBuyerProfile(deps, 'page-1', { force: true })
    expect(fallback.templateId).toBe('tpl-buyer-profile')
  })

  test('writes a second market in its own wording', async () => {
    const script = scriptedProvider((prompt) => route(prompt))
    const { deps } = fixtureDeps(script.provider, { markets: ['mkt-us', 'mkt-mx'] })
    const result = await runPageSetup(deps, 'page-1')
    const spanish = result.prompts.prompts.map(
      (prompt) => prompt.variants.find((variant) => variant.marketId === 'mkt-mx')?.text
    )
    expect(spanish).toEqual(TEXTBOLT_PROMPTS_ES.prompts.map((prompt) => prompt.text))
    expect(spanish[0]).not.toBe(result.prompts.prompts[0]?.variants[0]?.text)
    // Profile, prompts for each market, then the gaps: matrix, audit and fixes.
    expect(script.calls).toBe(7)
  })

  test('names each missing precondition for prompts', async () => {
    const unread = fixtureDeps(scriptedProvider(() => TEXTBOLT_PROMPTS_EN).provider)
    await expect(generateBuyerPrompts(unread.deps, 'page-1')).rejects.toMatchObject({
      message: 'Read the page before writing prompts.',
      nextStep: 'Read the page, then try again.'
    })
    await expect(generateBuyerProfile(unread.deps, 'page-1')).rejects.toMatchObject({
      message: 'Read the page before writing the buyer profile.',
      nextStep: 'Read the page, then try again.'
    })

    const noProfile = await prepared(scriptedProvider(() => TEXTBOLT_PROFILE).provider)
    await expect(generateBuyerPrompts(noProfile, 'page-1')).rejects.toMatchObject({
      message: 'Write the buyer profile before the prompts.',
      nextStep: 'Generate the buyer profile, then write the prompts.'
    })

    const script = scriptedProvider((prompt) =>
      prompt.includes('Write six parts') ? TEXTBOLT_PROFILE : TEXTBOLT_PROMPTS_EN
    )
    const noMarket = await prepared(script.provider)
    await generateBuyerProfile(noMarket, 'page-1')
    noMarket.projectDb.prepare('DELETE FROM page_markets WHERE page_id = ?').run('page-1')
    await expect(generateBuyerPrompts(noMarket, 'page-1')).rejects.toMatchObject({
      message: 'Add a market before writing prompts.',
      nextStep: 'Add a market on the page, then write the prompts.'
    })
  })
})

function route(prompt: string): unknown {
  const gap = textboltGapReply(prompt)
  if (gap !== null) return gap
  if (prompt.includes('Write six parts')) return TEXTBOLT_PROFILE
  if (prompt.includes('Market language: es')) return TEXTBOLT_PROMPTS_ES
  return TEXTBOLT_PROMPTS_EN
}

function fakeCompletion(json: unknown, counts: Partial<ClaudeCliUsage>): ClaudeCompletion {
  const usage: ClaudeCliUsage = {
    inputTokens: counts.inputTokens ?? 101,
    outputTokens: counts.outputTokens ?? 55,
    cacheCreationInputTokens: counts.cacheCreationInputTokens ?? 3,
    cacheReadInputTokens: counts.cacheReadInputTokens ?? 7,
    totalCostUsd: counts.totalCostUsd ?? 0.2,
    modelUsage: counts.modelUsage ?? {}
  }
  return {
    provider: 'claude-code',
    text: JSON.stringify(json),
    json,
    inputTokens: 11,
    outputTokens: 22,
    durationMs: 8,
    model: 'claude-sonnet',
    resolvedModel: 'claude-sonnet',
    usage
  }
}

function scriptedProvider(reply: (prompt: string) => unknown): {
  provider: ClaudeProvider
  calls: number
} {
  const state = { calls: 0 }
  const provider: ClaudeProvider = {
    id: 'claude-code',
    async complete(request) {
      state.calls += 1
      const json = reply(request.prompt)
      if (json instanceof Error) throw json
      return fakeCompletion(json, {})
    }
  }
  return {
    provider,
    get calls() {
      return state.calls
    }
  }
}

async function prepared(
  provider: ClaudeProvider,
  extras?: Partial<PageSetupDeps>
): Promise<PageSetupDeps> {
  const built = fixtureDeps(provider)
  const deps = { ...built.deps, ...extras }
  await readPage({
    db: deps.projectDb,
    transport: deps.transport,
    logger: deps.logger,
    secretStore: deps.secretStore,
    jinaKeychainRef: null,
    reader: 'jina',
    jinaMode: 'always',
    pageId: 'page-1',
    projectId: 'proj-1',
    now: () => NOW,
    clock: () => 1_000
  })
  return deps
}

function fixtureDeps(
  provider: ClaudeProvider,
  options?: { markets?: string[] }
): { deps: PageSetupDeps; transportCalls: string[] } {
  const appDb = track(openAppDatabase(':memory:'))
  const projectDb = track(openSqliteDatabase(':memory:'))
  ensureProjectSchema(projectDb)
  writeProjectProfile(projectDb, {
    includeSubdomains: false,
    brandNames: ['TextBolt', 'Text Bolt'],
    competitors: ['SimpleTexting', 'Twilio'],
    market: {
      id: 'mkt-us',
      country: 'US',
      language: 'en',
      location: null,
      device: 'desktop',
      localWording: false,
      serpapiLocation: null
    }
  })
  insertMarket(projectDb, {
    id: 'mkt-mx',
    country: 'MX',
    language: 'es',
    location: 'Mexico City',
    device: 'desktop',
    localWording: true,
    serpapiLocation: null
  })
  insertPage(projectDb, {
    id: 'page-1',
    projectId: 'proj-1',
    url: TEXTBOLT_URL,
    title: null,
    label: null,
    folder: null,
    status: 'not_tracked',
    setupStep: 'read',
    intervalDays: 14,
    samples: 1,
    promptCount: 10,
    defaultMarketId: 'mkt-us',
    pinned: false,
    score: null,
    promptSetVersion: null
  })
  for (const marketId of options?.markets ?? ['mkt-us']) {
    addPageMarket(projectDb, {
      pageId: 'page-1',
      marketId,
      addedAt: NOW,
      baselineRunId: null
    })
  }
  const transportCalls: string[] = []
  const transport: HttpTransport = {
    async request(request) {
      transportCalls.push(request.url)
      if (request.url.startsWith('https://r.jina.ai/')) {
        return { status: 200, body: textboltJinaBody() }
      }
      return { status: 404, body: 'missing' }
    }
  }
  return {
    transportCalls,
    deps: {
      appDb,
      projectDb,
      transport,
      provider,
      logger: createLogger({ write: () => undefined }),
      secretStore: new MemorySecretStore(),
      jinaKeychainRef: null,
      jinaMode: 'always',
      projectId: 'proj-1',
      now: () => NOW,
      clock: () => 1_000
    }
  }
}

function track(db: SqliteDatabase): SqliteDatabase {
  databases.push(db)
  return db
}
