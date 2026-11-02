import { describe, expect, test } from 'vitest'
import { DEFAULT_TEMPLATE_SETTINGS, type TemplateSettings } from '@shared/domain'
import { ASK_QUESTION_MAX, ASSIST_INSTRUCTION_MAX } from '@shared/ipc'
import {
  parseAskFilter,
  parseAskProject,
  parseAskQuestion,
  parseAssistDescribe,
  parseAssistRun,
  parseLlmUsage,
  parseSaveOverride,
  parseTemplateKind,
  parseTemplateSteps,
  parseTemplateVersions,
  parseTryTemplate,
  readTemplateSettingsRequest
} from './ipc-ai'

const SETTINGS: TemplateSettings = {
  model: 'claude-opus-5-5',
  language: 'es',
  promptCount: 12,
  tone: 'conversational'
}

function rejects(run: () => unknown, channel: string): void {
  expect(run).toThrow(new RegExp(`^${channel}:`))
}

describe('template editor parsers', () => {
  test('templates:steps takes an optional project id and nothing else', () => {
    expect(parseTemplateSteps({})).toEqual({})
    expect(parseTemplateSteps({ projectId: 'proj-1' })).toEqual({ projectId: 'proj-1' })
    rejects(() => parseTemplateSteps({ projectId: 'proj-1', kind: 'coverage' }), 'templates:steps')
    rejects(() => parseTemplateSteps({ projectId: '../etc' }), 'templates:steps')
    rejects(() => parseTemplateSteps(null), 'templates:steps')
    rejects(() => parseTemplateSteps([]), 'templates:steps')
  })

  test('a kind request needs a project and a known kind', () => {
    const channel = 'templates:resetOverride'
    expect(parseTemplateKind({ projectId: 'proj-1', kind: 'run_summary' }, channel)).toEqual({
      projectId: 'proj-1',
      kind: 'run_summary'
    })
    rejects(() => parseTemplateKind({ projectId: 'proj-1', kind: 'nope' }, channel), channel)
    rejects(() => parseTemplateKind({ projectId: 'proj-1' }, channel), channel)
    rejects(
      () => parseTemplateKind({ projectId: 'proj-1', kind: 'coverage', x: 1 }, channel),
      channel
    )
  })

  test('templates:saveOverride reads the body and every setting', () => {
    expect(
      parseSaveOverride({
        projectId: 'proj-1',
        kind: 'buyer_prompts',
        body: 'Write {{ prompt_count }} prompts.',
        settings: SETTINGS
      })
    ).toEqual({
      projectId: 'proj-1',
      kind: 'buyer_prompts',
      body: 'Write {{ prompt_count }} prompts.',
      settings: SETTINGS
    })
    const good = {
      projectId: 'proj-1',
      kind: 'coverage',
      body: 'Body',
      settings: DEFAULT_TEMPLATE_SETTINGS
    }
    rejects(() => parseSaveOverride({ ...good, kind: 'nope' }), 'templates:saveOverride')
    rejects(() => parseSaveOverride({ ...good, body: 'a\0b' }), 'templates:saveOverride')
    rejects(() => parseSaveOverride({ ...good, body: 7 }), 'templates:saveOverride')
    rejects(
      () => parseSaveOverride({ ...good, body: 'x'.repeat(500_001) }),
      'templates:saveOverride'
    )
    rejects(() => parseSaveOverride({ ...good, extra: true }), 'templates:saveOverride')
    const missing: Record<string, unknown> = { ...good }
    delete missing.settings
    rejects(() => parseSaveOverride(missing), 'templates:saveOverride')
  })

  test('settings reject bad values and missing or unknown keys', () => {
    const channel = 'templates:update'
    expect(readTemplateSettingsRequest(DEFAULT_TEMPLATE_SETTINGS, channel)).toEqual(
      DEFAULT_TEMPLATE_SETTINGS
    )
    expect(readTemplateSettingsRequest({ ...SETTINGS, language: 'pt-BR' }, channel)).toEqual({
      ...SETTINGS,
      language: 'pt-BR'
    })
    for (const bad of [
      { ...SETTINGS, promptCount: 0 },
      { ...SETTINGS, promptCount: 31 },
      { ...SETTINGS, promptCount: 1.5 },
      { ...SETTINGS, promptCount: '3' },
      { ...SETTINGS, tone: 'loud' },
      { ...SETTINGS, model: 'claude opus' },
      { ...SETTINGS, model: 'x'.repeat(81) },
      { ...SETTINGS, language: 'english!' },
      { ...SETTINGS, temperature: 1 },
      { model: null, language: null, promptCount: null },
      'plain',
      null
    ]) {
      rejects(() => readTemplateSettingsRequest(bad, channel), channel)
    }
  })

  test('templates:versions takes an id or a project step, never both', () => {
    expect(parseTemplateVersions({ id: 'tpl-1' })).toEqual({ id: 'tpl-1' })
    expect(parseTemplateVersions({ projectId: 'proj-1', kind: 'aio_gap' })).toEqual({
      projectId: 'proj-1',
      kind: 'aio_gap'
    })
    rejects(() => parseTemplateVersions({ id: 'tpl-1', kind: 'aio_gap' }), 'templates:versions')
    rejects(() => parseTemplateVersions({ projectId: 'proj-1' }), 'templates:versions')
    rejects(() => parseTemplateVersions({ id: 'tpl-1', page: 1 }), 'templates:versions')
  })

  test('templates:try reads a page, a market or null, and the draft', () => {
    const good = {
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: null,
      kind: 'aio_gap',
      body: 'Draft {{ page.url }}',
      settings: DEFAULT_TEMPLATE_SETTINGS
    }
    expect(parseTryTemplate(good)).toEqual(good)
    expect(parseTryTemplate({ ...good, marketId: 'mkt-uk' })).toEqual({
      ...good,
      marketId: 'mkt-uk'
    })
    rejects(() => parseTryTemplate({ ...good, marketId: undefined }), 'templates:try')
    rejects(() => parseTryTemplate({ ...good, kind: 'nope' }), 'templates:try')
    rejects(() => parseTryTemplate({ ...good, pageId: '' }), 'templates:try')
    rejects(
      () => parseTryTemplate({ ...good, settings: { ...SETTINGS, tone: 'loud' } }),
      'templates:try'
    )
    rejects(() => parseTryTemplate({ ...good, save: true }), 'templates:try')
  })
})

describe('assist and usage parsers', () => {
  test('assist:describe needs an assist id and a project or null', () => {
    expect(parseAssistDescribe({ assistId: 'page.titles', projectId: null })).toEqual({
      assistId: 'page.titles',
      projectId: null
    })
    expect(parseAssistDescribe({ assistId: 'status.why.cost', projectId: 'proj-1' })).toEqual({
      assistId: 'status.why.cost',
      projectId: 'proj-1'
    })
    for (const assistId of ['titles', 'Page.titles', 'page.', 'a.b.c.d', 'page.ti-tles', 7]) {
      rejects(() => parseAssistDescribe({ assistId, projectId: null }), 'assist:describe')
    }
    rejects(() => parseAssistDescribe({ assistId: 'page.titles' }), 'assist:describe')
  })

  test('assist:run reads ids, inputs, and an instruction', () => {
    const good = {
      assistId: 'page.titles',
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: null,
      promptId: null,
      inputs: { title: 'Text alerts', count: 3, short: true, empty: null, tags: ['a', 'b'] },
      instruction: '  Shorter please.  '
    }
    expect(parseAssistRun(good)).toEqual({ ...good, instruction: 'Shorter please.' })
    expect(parseAssistRun({ ...good, instruction: '   ' }).instruction).toBeNull()
    expect(parseAssistRun({ ...good, instruction: null }).instruction).toBeNull()
    expect(() =>
      parseAssistRun({ ...good, instruction: 'x'.repeat(ASSIST_INSTRUCTION_MAX + 1) })
    ).toThrow(/under 1,000 characters/)
    expect(
      parseAssistRun({ ...good, instruction: 'x'.repeat(ASSIST_INSTRUCTION_MAX) }).instruction
    ).toHaveLength(ASSIST_INSTRUCTION_MAX)
    rejects(() => parseAssistRun({ ...good, instruction: 'bell\u0007' }), 'assist:run')
    rejects(() => parseAssistRun({ ...good, inputs: { 'Bad-Key': 1 } }), 'assist:run')
    rejects(() => parseAssistRun({ ...good, inputs: { n: Number.NaN } }), 'assist:run')
    rejects(() => parseAssistRun({ ...good, inputs: { o: { nested: 1 } } }), 'assist:run')
    rejects(() => parseAssistRun({ ...good, inputs: { list: [1] } }), 'assist:run')
    rejects(() => parseAssistRun({ ...good, pageId: 'bad id' }), 'assist:run')
    rejects(() => parseAssistRun({ ...good, extra: 1 }), 'assist:run')
    const missing: Record<string, unknown> = { ...good }
    delete missing.promptId
    rejects(() => parseAssistRun(missing), 'assist:run')
  })

  test('llm:usage takes an optional project id', () => {
    expect(parseLlmUsage({})).toEqual({})
    expect(parseLlmUsage({ projectId: 'proj-1' })).toEqual({ projectId: 'proj-1' })
    rejects(() => parseLlmUsage({ projectId: 1 }), 'llm:usage')
    rejects(() => parseLlmUsage({ since: 'today' }), 'llm:usage')
  })
})

describe('Ask CiteFox parsers', () => {
  test('ask:question trims and limits the question', () => {
    expect(parseAskQuestion({ projectId: 'proj-1', question: '  Which pages lost?  ' })).toEqual({
      projectId: 'proj-1',
      question: 'Which pages lost?'
    })
    for (const question of ['', '   ', 'x'.repeat(ASK_QUESTION_MAX + 1), 'bad\u0000', 3]) {
      expect(() => parseAskQuestion({ projectId: 'proj-1', question })).toThrow(
        /1 to 500 characters/
      )
    }
    rejects(() => parseAskQuestion({ projectId: 'proj-1', question: 'Hi', x: 1 }), 'ask:question')
  })

  test('ask:filter normalises lists, domains, and text', () => {
    expect(
      parseAskFilter({
        projectId: 'proj-1',
        filters: {
          pageIds: ['page-1', 'page-1', 'page-2'],
          marketIds: [],
          statuses: ['page_cited', 'not_cited'],
          movements: ['lost'],
          intentStages: ['problem'],
          citedDomain: 'https://www.SimpleTexting.com/blog/x',
          text: '  gateway  '
        }
      })
    ).toEqual({
      projectId: 'proj-1',
      filters: {
        pageIds: ['page-1', 'page-2'],
        marketIds: null,
        statuses: ['page_cited', 'not_cited'],
        movements: ['lost'],
        intentStages: ['problem'],
        citedDomain: 'simpletexting.com',
        text: 'gateway'
      }
    })
    const empty = {
      pageIds: null,
      marketIds: null,
      statuses: null,
      movements: null,
      intentStages: null,
      citedDomain: null,
      text: null
    }
    expect(parseAskFilter({ projectId: 'proj-1', filters: { ...empty, text: '   ' } })).toEqual({
      projectId: 'proj-1',
      filters: empty
    })
    for (const bad of [
      { ...empty, statuses: ['cited'] },
      { ...empty, movements: ['sideways'] },
      { ...empty, intentStages: ['buy'] },
      { ...empty, pageIds: 'page-1' },
      { ...empty, pageIds: Array.from({ length: 51 }, (_, index) => `page-${index}`) },
      { ...empty, citedDomain: 'bad domain' },
      { ...empty, text: 'x'.repeat(201) },
      { ...empty, extra: null },
      { pageIds: null }
    ]) {
      rejects(() => parseAskFilter({ projectId: 'proj-1', filters: bad }), 'ask:filter')
    }
  })

  test('ask:options takes a project id only', () => {
    expect(parseAskProject({ projectId: 'proj-1' })).toEqual({ projectId: 'proj-1' })
    rejects(() => parseAskProject({}), 'ask:options')
    rejects(() => parseAskProject({ projectId: 'proj-1', all: true }), 'ask:options')
  })
})
