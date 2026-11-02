import { beforeEach, describe, expect, test } from 'vitest'
import { SHIPPED_TEMPLATE_NAME, TEMPLATE_VARIABLES } from '@shared/domain'
import { TEMPLATE_ERROR_MESSAGES } from '@shared/ipc'
import { resetM2Memory } from './memory'
import { sha256Hex } from './sha256'
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  resetTemplate,
  restoreTemplate,
  setDefaultTemplate,
  templateUsage,
  updateTemplate
} from './templates'
import { listLabel, statusCounts, statusName, visibleTemplates } from '../../templates/list'

describe('template memory', () => {
  beforeEach(() => {
    resetM2Memory()
  })

  test('lists the three generation templates in run order', async () => {
    const list = await listTemplates()
    expect(list.map((template) => template.kind)).toEqual([
      'buyer_profile',
      'buyer_prompts',
      'coverage'
    ])
    expect(
      list.every(
        (template) =>
          template.isDefault &&
          template.isShipped &&
          template.updatedAt === null &&
          template.deletedAt === null &&
          template.notes === null &&
          template.name === SHIPPED_TEMPLATE_NAME
      )
    ).toBe(true)
    const prompts = list[1]
    expect(prompts).toBeDefined()
    if (!prompts) return
    expect(prompts.variables).toEqual(
      TEMPLATE_VARIABLES.filter((name) => prompts.body.includes(`{{ ${name} }}`))
    )
    expect(prompts.templateHash).toMatch(/^[a-f0-9]{64}$/)
    expect(statusCounts(list)).toEqual({ Default: 3, Edited: 0 })
    expect(listLabel(3, 3, false)).toBe('3 templates')
  })

  test('saves an unknown variable as a warning and records templateUpdatedAt', async () => {
    const copy = await createTemplate({
      kind: 'buyer_profile',
      name: 'Nightly buyer',
      fromId: 'buyer-profile'
    })
    const result = await updateTemplate({
      id: copy.id,
      body: 'Brand {{ brand_name }}. Rival {{ competitor }}.'
    })
    expect(result.warnings.map((warning) => warning.name)).toEqual(['competitor'])
    expect(result.template.warnings).toEqual(result.warnings)
    expect(result.template.isDefault).toBe(false)
    expect(result.template.isShipped).toBe(false)
    expect(statusName(result.template)).toBe('Edited')
    expect(result.template.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(result.template.variables).toEqual(['brand_name'])
    expect((await getTemplate({ id: copy.id })).body).toContain('{{ competitor }}')
    const again = await listTemplates()
    expect(statusCounts(again)).toEqual({ Default: 3, Edited: 1 })
    expect(visibleTemplates(again, '', ['Edited'], 'run', 'asc').map((item) => item.id)).toEqual([
      copy.id
    ])
    expect(listLabel(1, 4, true)).toBe('Showing 1 of 4 templates')
  })

  test('a syntax error blocks the save and leaves the previous body', async () => {
    const copy = await createTemplate({
      kind: 'coverage',
      name: 'Gap copy',
      fromId: 'coverage'
    })
    const before = await getTemplate({ id: copy.id })
    const body = 'Broken {{ page_text SENTINEL_NOT_SAVED'
    await expect(updateTemplate({ id: copy.id, body })).rejects.toThrow(
      'templates:update: Nunjucks syntax error'
    )
    try {
      await updateTemplate({ id: copy.id, body })
    } catch (error) {
      expect(error instanceof Error ? error.message : '').not.toContain('SENTINEL_NOT_SAVED')
    }
    expect(await getTemplate({ id: copy.id })).toEqual(before)
  })

  test('reset is a deprecated alias and does not change the template', async () => {
    const copy = await createTemplate({
      kind: 'buyer_prompts',
      name: 'Prompt copy',
      fromId: 'buyer-prompts'
    })
    const updated = await updateTemplate({
      id: copy.id,
      body: 'Write {{ prompt_count }} questions.'
    })
    const reset = await resetTemplate({ id: copy.id })
    expect(reset.body).toBe(updated.template.body)
    expect(reset.updatedAt).toBe(updated.template.updatedAt)
    expect(reset.isDefault).toBe(false)
    expect(await sha256Hex(reset.body)).toMatch(/^[a-f0-9]{64}$/)
  })

  test('rejects an update of the shipped template', async () => {
    await expect(updateTemplate({ id: 'buyer-profile', name: 'Other name' })).rejects.toThrow(
      `templates:update: ${TEMPLATE_ERROR_MESSAGES.shipped_readonly}`
    )
  })

  test('rejects an untrimmed name and a name outside 1 to 80', async () => {
    await expect(
      createTemplate({ kind: 'coverage', name: '  Gap copy', body: '{{ url }}' })
    ).rejects.toThrow(`templates:create: ${TEMPLATE_ERROR_MESSAGES.name_length}`)
    await expect(createTemplate({ kind: 'coverage', name: '', body: '{{ url }}' })).rejects.toThrow(
      `templates:create: ${TEMPLATE_ERROR_MESSAGES.name_length}`
    )
    await expect(
      createTemplate({ kind: 'coverage', name: 'x'.repeat(81), body: '{{ url }}' })
    ).rejects.toThrow(`templates:create: ${TEMPLATE_ERROR_MESSAGES.name_length}`)
  })

  test('lists one kind and can include a soft-deleted copy', async () => {
    const copy = await createTemplate({
      kind: 'buyer_profile',
      name: 'Nightly buyer',
      fromId: 'buyer-profile'
    })
    expect(copy.isShipped).toBe(false)
    expect(copy.isDefault).toBe(false)
    expect(copy.body).toBe((await getTemplate({ id: 'buyer-profile' })).body)
    expect((await listTemplates({ kind: 'buyer_profile' })).map((item) => item.id)).toEqual([
      'buyer-profile',
      copy.id
    ])
    await setDefaultTemplate({ id: copy.id })
    await expect(deleteTemplate({ id: 'buyer-profile' })).rejects.toThrow(
      'templates:delete: The shipped CiteFox default template is read-only.'
    )
    await setDefaultTemplate({ id: 'buyer-profile' })
    const deleted = await deleteTemplate({ id: copy.id })
    expect(deleted.deletedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(deleted.isDefault).toBe(false)
    expect((await listTemplates()).map((item) => item.id)).not.toContain(copy.id)
    expect(
      (await listTemplates({ includeDeleted: true })).some((item) => item.id === copy.id)
    ).toBe(true)
    const restored = await restoreTemplate({ id: copy.id })
    expect(restored.deletedAt).toBeNull()
    expect((await listTemplates()).some((item) => item.id === copy.id)).toBe(true)
  })

  test('update adds 1 to version and delete and restore leave it', async () => {
    const shipped = await listTemplates()
    expect(shipped.every((template) => template.version === 1)).toBe(true)
    const copy = await createTemplate({
      kind: 'coverage',
      name: 'Nightly gaps',
      body: 'Cover {{ url }}'
    })
    expect(copy.version).toBe(1)
    const renamed = await updateTemplate({ id: copy.id, name: 'Nightly coverage' })
    expect(renamed.template.version).toBe(2)
    const noted = await updateTemplate({ id: copy.id, notes: 'Used at night' })
    expect(noted.template.version).toBe(3)
    const beforeReject = await getTemplate({ id: copy.id })
    await expect(updateTemplate({ id: copy.id, body: 'Broken {{ page_text' })).rejects.toThrow(
      'templates:update: Nunjucks syntax error'
    )
    expect((await getTemplate({ id: copy.id })).version).toBe(beforeReject.version)
    const deleted = await deleteTemplate({ id: copy.id })
    expect(deleted.version).toBe(3)
    const restored = await restoreTemplate({ id: copy.id })
    expect(restored.version).toBe(3)
    expect((await getTemplate({ id: copy.id })).version).toBe(3)
  })

  test('rejects a taken name, a body and a source together, and reports empty usage', async () => {
    await expect(
      createTemplate({ kind: 'buyer_profile', name: 'citefox default', body: 'Hello {{ url }}' })
    ).rejects.toThrow('templates:create: A template of this kind already has that name.')
    const body = 'Broken {{ page_text SENTINEL_NOT_SAVED'
    await expect(createTemplate({ kind: 'coverage', name: 'Bad copy', body })).rejects.toThrow(
      'templates:create: Nunjucks syntax error'
    )
    await expect(
      createTemplate({ kind: 'coverage', name: 'Both', body: 'Hi {{ url }}', fromId: 'coverage' })
    ).rejects.toThrow('templates:create: Provide a body or a fromId, and not both.')
    expect(await listTemplates()).toHaveLength(3)
    expect(await templateUsage({ id: 'buyer-profile', projectId: 'textbolt' })).toEqual({
      templateId: 'buyer-profile',
      buyerProfiles: 0,
      promptSets: 0,
      coverageMatrices: 0,
      lastUsedAt: null
    })
  })
})
