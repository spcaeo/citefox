import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { e2eTopicDns, e2eTopicSiteReader, readE2eTopicSite } from './e2e-site'

const SITE_FILE = resolve('tests/e2e/fixtures/topic-site.json')
const ENV = { CITEFOX_E2E_TOPICS: '1', CITEFOX_E2E_TOPIC_SITE: SITE_FILE }

describe('e2e topic stand-in site', () => {
  test('reads the site from the test fixture file, not the bundle', () => {
    const site = readE2eTopicSite(SITE_FILE)
    expect(site?.pages['/pricing']?.title).toBeTruthy()
    expect(readE2eTopicSite(undefined)).toBeNull()
    expect(readE2eTopicSite(resolve('tests/e2e/fixtures/missing.json'))).toBeNull()
  })

  test('is off when packaged, without the switch, or without the file', () => {
    expect(e2eTopicSiteReader(true, ENV)).toBeUndefined()
    expect(e2eTopicSiteReader(false, { CITEFOX_E2E_TOPIC_SITE: SITE_FILE })).toBeUndefined()
    expect(e2eTopicSiteReader(false, { CITEFOX_E2E_TOPICS: '1' })).toBeUndefined()
    expect(e2eTopicDns(true, ENV)).toBeUndefined()
  })

  test('serves fixed pages, and wide reads only on the site host', async () => {
    const site = readE2eTopicSite(SITE_FILE)
    if (site === null) throw new Error('fixture missing')
    const read = e2eTopicSiteReader(false, ENV)
    expect(await read?.(`https://${site.host}/pricing`)).toEqual(site.pages['/pricing'])
    expect(await read?.(`https://${site.host}/blog/anything`)).toBeNull()

    const wide = e2eTopicSiteReader(false, { ...ENV, CITEFOX_E2E_SITE_WIDE: '1' })
    const page = await wide?.(`https://www.${site.host}/blog/text-reminders`)
    expect(page?.title).toBe(`Text reminders · ${site.name}`)
    expect(await wide?.(`https://other.example.com/blog/x`)).toBeNull()
    expect(await wide?.(`https://${site.host}/help/x`)).toBeNull()
    expect(await wide?.(`https://${site.host}/integrations/x`)).toBeNull()
    expect(await wide?.(`https://${site.host}/integrations/x`)).not.toBeNull()
  })
})
