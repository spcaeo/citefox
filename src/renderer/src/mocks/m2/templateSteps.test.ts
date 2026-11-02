import { beforeEach, describe, expect, test } from 'vitest'
import {
  DEFAULT_TEMPLATE_SETTINGS,
  GENERATION_TEMPLATE_KINDS,
  isListedTemplateStep
} from '@shared/domain'
import { resetM2Memory } from './memory'
import {
  createTemplate,
  resetTemplateToShipped,
  setDefaultTemplate,
  updateTemplate
} from './templates'
import {
  listTemplateSteps,
  listTemplateVersions,
  resetTemplateOverride,
  saveTemplateOverride,
  tryTemplate
} from './templateSteps'

beforeEach(() => resetM2Memory())

describe('mock template steps', () => {
  test('every listed kind is in run order as the shipped default; planned kinds stay hidden', async () => {
    const listed = GENERATION_TEMPLATE_KINDS.filter((kind) => isListedTemplateStep(kind, false))
    const steps = await listTemplateSteps({ projectId: 'p1' })
    expect(steps.map((step) => step.kind)).toEqual(listed)
    expect(steps.map((step) => step.position)).toEqual(listed.map((_, index) => index + 1))
    expect(steps.some((step) => step.kind === 'coverage')).toBe(false)
    expect(steps.every((step) => step.retired === null)).toBe(true)
    expect(steps.every((step) => step.status === 'shipped')).toBe(true)
    expect(steps.find((step) => step.kind === 'aio_gap')?.schema).toContain('"facts"')
  })

  test('project versions continue their numbers after a reset, and stay per project', async () => {
    const request = {
      projectId: 'p1',
      kind: 'buyer_prompts' as const,
      body: 'Write {{ prompt_count }} prompts.',
      settings: { ...DEFAULT_TEMPLATE_SETTINGS, tone: 'search_short' as const }
    }
    const first = await saveTemplateOverride(request)
    expect(first.status).toBe('project')
    expect(first.effective.version).toBe(1)
    // Search-style short does not apply to buyer prompts, so it is dropped.
    expect(first.effective.settings.tone).toBeNull()
    const reset = await resetTemplateOverride({ projectId: 'p1', kind: 'buyer_prompts' })
    expect(reset.status).toBe('shipped')
    const again = await saveTemplateOverride(request)
    expect(again.effective.version).toBe(2)
    const other = await listTemplateSteps({ projectId: 'p2' })
    expect(other.find((step) => step.kind === 'buyer_prompts')?.status).toBe('shipped')
    const versions = await listTemplateVersions({ projectId: 'p1', kind: 'buyer_prompts' })
    expect(versions.map((entry) => [entry.version, entry.current])).toEqual([
      [2, true],
      [1, false]
    ])
    await expect(
      resetTemplateOverride({ projectId: 'p2', kind: 'coverage_matrix' })
    ).rejects.toThrow('This project has no version of that step.')
  })

  test('a syntax error is rejected without echoing the body', async () => {
    await expect(
      saveTemplateOverride({
        projectId: 'p1',
        kind: 'coverage_matrix',
        body: 'secret {% if x %}',
        settings: DEFAULT_TEMPLATE_SETTINGS
      })
    ).rejects.toThrow('templates:saveOverride: The template has a syntax error.')
  })

  test('a user default makes the step Edited, and reset to shipped copies the shipped body', async () => {
    // The step list seeds the shipped matrix template the copy starts from.
    await listTemplateSteps({})
    const copy = await createTemplate({
      kind: 'coverage_matrix',
      name: 'Mine',
      fromId: 'coverage-matrix'
    })
    await updateTemplate({ id: copy.id, body: 'Mine {{ url }}' })
    await setDefaultTemplate({ id: copy.id })
    const steps = await listTemplateSteps({})
    const coverage = steps.find((step) => step.kind === 'coverage_matrix')
    expect(coverage?.status).toBe('edited')
    expect(coverage?.effective.body).toBe('Mine {{ url }}')
    const reset = await resetTemplateToShipped({ id: copy.id })
    expect(reset.template.body).toBe(coverage?.shipped.body)
    expect(reset.template.version).toBe(3)
    const versions = await listTemplateVersions({ id: copy.id })
    expect(versions.map((entry) => entry.version)).toEqual([3, 2, 1])
  })

  test('Try it renders the draft and saves nothing', async () => {
    const result = await tryTemplate({
      projectId: 'p1',
      pageId: 'alerts',
      marketId: null,
      kind: 'buyer_profile',
      body: 'Read {{ url }}',
      settings: DEFAULT_TEMPLATE_SETTINGS
    })
    expect(result.renderedPrompt).toContain('Read https://textbolt.com/')
    expect(result.matched).toBe(true)
    expect(result.savedNothing).toBe(true)
    const steps = await listTemplateSteps({ projectId: 'p1' })
    expect(steps.every((step) => step.status === 'shipped')).toBe(true)
  })
})
