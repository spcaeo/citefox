import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { openProgressSeed, PROGRESS_SEED, type ProgressSeed } from './progress.test-helper'

const opened: ProgressSeed[] = []
const directories: string[] = []

afterEach(() => {
  for (const seed of opened.splice(0)) seed.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const base = { projectId: PROGRESS_SEED.projectId }

function project(): ProgressSeed {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-site-types-'))
  directories.push(directory)
  const seed = openProgressSeed(directory)
  opened.push(seed)
  seed.setClock('2026-10-29T12:00:00.000Z')
  return seed
}

describe('site types on a real project file', () => {
  test('sets a role and a custom type per domain, undoes, and deleting the type clears it', async () => {
    const seed = project()
    const { handlers } = seed
    await expect(handlers['competitors:siteTypes'](base)).resolves.toEqual({
      overrides: [],
      customTypes: []
    })
    const partner = await handlers['competitors:saveSiteTypeDef']({
      ...base,
      id: null,
      name: ' Partner ',
      tone: 'ok'
    })
    expect(partner).toMatchObject({ name: 'Partner', tone: 'ok' })

    const set = await handlers['competitors:setSiteType']({
      ...base,
      domain: 'https://www.att.com/business',
      type: `custom:${partner.id}`
    })
    expect(set).toEqual({
      previous: null,
      override: { domain: 'att.com', type: `custom:${partner.id}`, role: null }
    })
    await handlers['competitors:setSiteType']({ ...base, domain: 'att.com', role: 'media' })
    // Undo: the previous value back.
    await handlers['competitors:setSiteType']({ ...base, domain: 'att.com', role: null })

    await handlers['competitors:saveSiteTypeDef']({
      ...base,
      id: partner.id,
      name: 'Reseller',
      tone: 'info'
    })
    expect(await handlers['competitors:siteTypes'](base)).toEqual({
      customTypes: [{ id: partner.id, name: 'Reseller', tone: 'info' }],
      overrides: [{ domain: 'att.com', type: `custom:${partner.id}`, role: null }]
    })
    await expect(
      handlers['competitors:removeSiteTypeDef']({ ...base, id: partner.id })
    ).resolves.toEqual({ cleared: 1 })
    expect(await handlers['competitors:siteTypes'](base)).toEqual({
      overrides: [],
      customTypes: []
    })
  })

  test('refuses requests that are not one', async () => {
    const { handlers } = project()
    const refused = [
      handlers['competitors:setSiteType']({ ...base, domain: 'reddit.com' }),
      handlers['competitors:setSiteType']({ ...base, domain: 'not a domain', role: 'social' }),
      handlers['competitors:setSiteType']({
        ...base,
        domain: 'reddit.com',
        role: 'competitor' as never
      }),
      handlers['competitors:setSiteType']({
        ...base,
        domain: 'reddit.com',
        type: 'yours' as never
      }),
      handlers['competitors:setSiteType']({
        ...base,
        domain: 'reddit.com',
        role: 'social',
        extra: 1
      } as never),
      handlers['competitors:saveSiteTypeDef']({
        ...base,
        id: null,
        name: 'A',
        tone: 'pink' as never
      }),
      handlers['competitors:removeSiteTypeDef']({ ...base, id: 'no such id' })
    ]
    for (const request of refused) await expect(request).rejects.toThrow()
    await expect(
      handlers['competitors:saveSiteTypeDef']({ ...base, id: null, name: '   ', tone: 'ok' })
    ).rejects.toThrow(/Give the type a name/)
    await expect(
      handlers['competitors:setSiteType']({ ...base, domain: 'reddit.com', type: 'custom:gone' })
    ).rejects.toThrow()
  })
})
