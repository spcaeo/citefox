import { afterEach, describe, expect, test } from 'vitest'
import type { SaveProductCatalogRequest } from '@shared/ipc'
import { insertPage } from '../storage/pages'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { cleanupHarness, harness, profile } from './test-harness'

afterEach(cleanupHarness)

const GATEWAY = {
  id: 'prod-gw',
  name: 'Email-to-SMS gateway',
  job: 'Send SMS from email',
  buyer: 'IT teams',
  evidencePath: '/email-to-sms/'
}
const BULK = { id: 'prod-bulk', name: 'Bulk SMS', job: 'Campaigns', buyer: 'Marketers' }

async function setup(): Promise<{
  handlers: ReturnType<typeof harness>['handlers']
  projectId: string
}> {
  const { handlers, storage } = harness()
  const state = await handlers['onboarding:saveProfile']({
    ...profile(),
    competitors: ['txtimpact.com']
  })
  const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  try {
    insertPage(db, {
      id: 'page-1',
      projectId: state.profile?.project.id ?? '',
      url: 'https://textbolt.com/email-to-sms/outlook/',
      title: null,
      label: null,
      folder: null,
      status: 'not_tracked',
      setupStep: 'read',
      intervalDays: 14,
      samples: 1,
      promptCount: 10,
      defaultMarketId: null,
      pinned: false,
      score: null,
      promptSetVersion: null
    })
  } finally {
    closeProjectDatabase(db)
  }
  return { handlers, projectId: state.profile?.project.id ?? '' }
}

describe('IPC handlers: products (prompt audit PC)', () => {
  test('products:get reads the migrated flat list as whole-business rows', async () => {
    const { handlers, projectId } = await setup()
    const catalog = await handlers['products:get']({ projectId })
    expect(catalog).toEqual({
      projectId,
      products: [],
      competitors: [
        {
          name: 'txtimpact.com',
          domain: 'txtimpact.com',
          productId: null,
          tier: 'direct',
          startingPrice: null,
          sources: []
        }
      ]
    })
  })

  test('products:save replaces the catalog and the flat list follows', async () => {
    const { handlers, projectId } = await setup()
    const request: SaveProductCatalogRequest = {
      projectId,
      products: [GATEWAY, BULK],
      competitors: [
        {
          name: 'TXTImpact',
          domain: 'txtimpact.com',
          productId: 'prod-gw',
          tier: 'direct',
          startingPrice: '$29/mo',
          sources: []
        },
        {
          name: 'SimpleTexting',
          domain: 'simpletexting.com',
          productId: 'prod-bulk',
          tier: 'partial',
          startingPrice: null,
          sources: []
        }
      ]
    }
    const saved = await handlers['products:save'](request)
    expect(saved.products.map((item) => item.id)).toEqual(['prod-gw', 'prod-bulk'])
    expect(saved.competitors.map((item) => [item.name, item.productId, item.tier])).toEqual([
      ['TXTImpact', 'prod-gw', 'direct'],
      ['SimpleTexting', 'prod-bulk', 'partial']
    ])
    const project = await handlers['projects:get']({ projectId })
    expect(project.competitors).toEqual(['txtimpact.com', 'simpletexting.com'])
    await expect(
      handlers['products:save']({
        ...request,
        competitors: [{ ...request.competitors[0]!, productId: 'prod-missing' }]
      })
    ).rejects.toThrow(/Invalid competitor product/)
    await expect(
      handlers['products:save']({
        projectId,
        products: 'x'
      } as unknown as SaveProductCatalogRequest)
    ).rejects.toThrow('products:save: Invalid request')
  })

  test('products:page infers from the URL; products:setPage pins and returns to automatic', async () => {
    const { handlers, projectId } = await setup()
    await handlers['products:save']({ projectId, products: [GATEWAY, BULK], competitors: [] })
    const auto = await handlers['products:page']({ projectId, pageId: 'page-1' })
    expect(auto).toMatchObject({ productId: 'prod-gw', pinned: false, suggestedId: 'prod-gw' })
    expect(auto.products).toHaveLength(2)
    const pinned = await handlers['products:setPage']({
      projectId,
      pageId: 'page-1',
      mode: 'pick',
      productId: 'prod-bulk'
    })
    expect(pinned).toMatchObject({ productId: 'prod-bulk', pinned: true, suggestedId: 'prod-gw' })
    const whole = await handlers['products:setPage']({
      projectId,
      pageId: 'page-1',
      mode: 'pick',
      productId: null
    })
    expect(whole).toMatchObject({ productId: null, pinned: true })
    const back = await handlers['products:setPage']({
      projectId,
      pageId: 'page-1',
      mode: 'auto',
      productId: null
    })
    expect(back).toMatchObject({ productId: 'prod-gw', pinned: false })
    await expect(handlers['products:page']({ projectId, pageId: 'page-x' })).rejects.toThrow(
      /page was not found/
    )
    await expect(
      handlers['products:setPage']({
        projectId,
        pageId: 'page-1',
        mode: 'maybe',
        productId: null
      } as never)
    ).rejects.toThrow('products:setPage: Invalid request')
  })

  test('products:saveFill keeps the listed competitors by the product they were found for', async () => {
    const { handlers, projectId } = await setup()
    const saved = await handlers['products:saveFill']({
      projectId,
      fill: {
        products: [
          {
            id: 'prod-a',
            name: 'Email-to-SMS gateway',
            job: 'Send SMS from email',
            buyer: 'IT teams',
            evidence: { path: '/email-to-sms/', quote: 'q' },
            searchNote: null
          }
        ],
        competitors: [
          {
            id: 'c1',
            name: 'TXTImpact',
            domain: 'txtimpact.com',
            domainSource: 'search',
            reason: 'r',
            evidence: null,
            checkDomain: false,
            product: 'prod-a',
            tier: 'direct',
            startingPrice: null,
            sources: []
          },
          {
            id: 'c2',
            name: 'Notifyre',
            domain: 'notifyre.com',
            domainSource: 'search',
            reason: 'r',
            evidence: null,
            checkDomain: false,
            product: 'prod-a',
            tier: 'direct',
            startingPrice: null,
            sources: []
          }
        ]
      }
    })
    expect(saved.products.map((item) => item.name)).toEqual(['Email-to-SMS gateway'])
    expect(saved.competitors.map((item) => [item.name, item.productId])).toEqual([
      ['TXTImpact', 'prod-a']
    ])
  })
})
