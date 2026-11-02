import { afterEach, describe, expect, test } from 'vitest'
import { assistPrompt } from '../assist/preamble'
import { webAssistPrompt } from '../assist/web-prompt'
import { readHelpFillContext } from '../helpfill/context'
import { buildHelpFillPrompt, buildHelpFillTextPrompt } from '../helpfill/prompt'
import { getHelpFillKind } from '../helpfill/registry'
import type { HelpFillContext } from '../helpfill/types'
import { sectionTask } from '../onboarding/sections/prompt'
import { sectionDef } from '../onboarding/sections/registry'
import { textboltContext } from '../onboarding/sections/test-context.test-helper'
import { openSqliteDatabase } from '../storage/database'
import { migrate } from '../storage/migrate'
import { closeTracked, track } from '../storage/migrate.test-helper'
import { PROJECT_MIGRATIONS } from '../storage/project-schema'
import { activeProjectRules, saveProjectRule } from '../storage/project-rules'
import type { ProjectRecord } from '../storage/records'
import { topicPrompt } from '../topics/claude'
import { PROJECT_RULES_HEAD, projectRulesLines, withProjectRules } from './project-rules'

/**
 * Owner decision 5: every AI prompt for a project carries the owner's rules that are
 * on, as one short block. One test per prompt builder.
 */

const RULES = ["Don't call us a cloud service", 'Say SMS, not texting']
const BLOCK = [PROJECT_RULES_HEAD, `- ${RULES[0]}`, `- ${RULES[1]}`].join('\n')

afterEach(() => closeTracked())

describe('the project rules block', () => {
  test('lists each rule once, and is empty with none', () => {
    expect(projectRulesLines([...RULES, ` ${RULES[0]} `, ''])).toEqual(BLOCK.split('\n'))
    expect(projectRulesLines([])).toEqual([])
  })

  test('goes after the first line (the routing line stays first), once', () => {
    const prompt = 'Template: topic_page_edit.md\nRewrite the page.'
    const ruled = withProjectRules(prompt, RULES)
    expect(ruled.split('\n')[0]).toBe('Template: topic_page_edit.md')
    expect(ruled).toContain(BLOCK)
    expect(withProjectRules(ruled, RULES)).toBe(ruled)
    expect(withProjectRules(prompt, [])).toBe(prompt)
    const variant = withProjectRules('Template: x.md\nVariant: short\nBody.', RULES).split('\n')
    expect(variant.slice(0, 2)).toEqual(['Template: x.md', 'Variant: short'])
  })
})

describe('each prompt builder includes the rules', () => {
  test('setup sections (onboarding cards, ✦ Find more and ✦ Redo)', () => {
    const task = sectionTask(sectionDef('buyers'), {
      context: textboltContext(),
      mode: 'redo',
      instruction: 'Only US buyers',
      current: [],
      rules: RULES
    })
    expect(task).toContain(BLOCK)
  })

  test('topic steps: fix briefs, page edits and Why Google picks', () => {
    for (const body of [
      'Template: topic_fix_draft.md\nWrite a fix for {{question}}.',
      'Template: topic_page_edit.md\nEdit the page for {{question}}.',
      'Template: topic_owner_why.md\nCompare the pages for {{question}}.'
    ]) {
      const prompt = topicPrompt(body, { question: 'How do I text from email?' }, RULES, [])
      expect(prompt).toContain(BLOCK)
      expect(prompt).toContain('How do I text from email?')
    }
  })

  test('assists (saved-data and web search)', () => {
    const input = {
      assistId: 'progress.draftFix',
      task: 'Draft a fix.',
      instruction: null,
      facts: 'x'
    }
    expect(assistPrompt({ ...input, rules: RULES })).toContain(BLOCK)
    expect(webAssistPrompt({ ...input, rules: RULES })).toContain(BLOCK)
    expect(assistPrompt(input)).not.toContain(PROJECT_RULES_HEAD)
  })

  test('help-fill: the project context carries the rules into every kind', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, PROJECT_MIGRATIONS)
    saveProjectRule(
      db,
      { id: null, text: RULES[0] ?? '', enabled: true },
      '2026-11-01T10:00:00.000Z'
    )
    saveProjectRule(
      db,
      { id: null, text: RULES[1] ?? '', enabled: true },
      '2026-11-01T10:00:00.000Z'
    )
    saveProjectRule(
      db,
      { id: null, text: 'An old rule', enabled: false },
      '2026-11-01T10:00:00.000Z'
    )
    expect(activeProjectRules(db)).toEqual(RULES)
    const project: ProjectRecord = {
      id: 'proj-1',
      name: 'TextBolt',
      slug: 'textbolt',
      domain: 'textbolt.com',
      dbPath: ':memory:',
      clientName: null,
      status: 'active'
    }
    const context: HelpFillContext = {
      ...readHelpFillContext(db, project, null),
      promptId: null,
      subject: null
    }
    const kind = getHelpFillKind('buyers')
    if (kind === null) throw new Error('no buyers kind')
    const prompt = buildHelpFillPrompt(kind, context, 5).prompt
    expect(prompt).toContain(BLOCK)
    expect(prompt).not.toContain('An old rule')
    expect(buildHelpFillTextPrompt(kind, context, []).prompt).toContain(BLOCK)
  })
})
