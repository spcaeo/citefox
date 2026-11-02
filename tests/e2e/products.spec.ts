import { expect, test, type Page } from '@playwright/test'
import type {
  CiteFoxApi,
  PageProductView,
  ProductCatalogView,
  SaveProductCatalogRequest
} from '@shared/ipc'
import { e2eArtifact } from './artifacts'
import { expectMainAccessible, openHash, openTwoMarketApp } from './screens-app'
import { openAdd } from './nav-helpers'

/**
 * Prompt audit PC: products and competitors by product on real IPC. Settings › General
 * shows the products and a "Competitors by product" grid that saves at once; the page
 * header's Product picker starts on Automatic and pins a product; the topic wizard's
 * Seed step offers the same choice. Saves `products-settings.png`,
 * `products-page-header.png` and `products-topic-seed.png`.
 */

type Bridge = typeof globalThis & { citefox: CiteFoxApi }

async function readCatalog(page: Page): Promise<ProductCatalogView> {
  return page.evaluate(() =>
    (globalThis as Bridge).citefox['products:get']({ projectId: 'proj-1' })
  )
}

async function saveCatalog(page: Page, request: SaveProductCatalogRequest): Promise<void> {
  await page.evaluate((body) => (globalThis as Bridge).citefox['products:save'](body), request)
}

async function readPageProduct(page: Page): Promise<PageProductView> {
  return page.evaluate(() =>
    (globalThis as Bridge).citefox['products:page']({ projectId: 'proj-1', pageId: 'page-1' })
  )
}

test('products, competitors by product and the page and topic pickers on real IPC', async () => {
  test.setTimeout(180_000)
  const { page, close } = await openTwoMarketApp('products')
  try {
    // The seed's flat list was copied in as whole-business rows by migration 034.
    const before = await readCatalog(page)
    expect(before.competitors.map((row) => [row.name, row.productId])).toEqual([
      ['simpletexting.com', null],
      ['twilio.com', null]
    ])
    await saveCatalog(page, {
      projectId: 'proj-1',
      products: [
        {
          id: 'prod-gw',
          name: 'Email-to-SMS gateway',
          job: 'Send text alerts from email',
          buyer: 'IT teams',
          evidencePath: '/email-to-sms/'
        },
        {
          id: 'prod-bulk',
          name: 'Bulk SMS marketing',
          job: 'Campaigns to customer lists',
          buyer: 'Marketers',
          evidencePath: null
        }
      ],
      competitors: [
        {
          name: 'SimpleTexting',
          domain: 'simpletexting.com',
          productId: 'prod-bulk',
          tier: 'direct',
          startingPrice: null,
          sources: []
        },
        {
          name: 'Twilio',
          domain: 'twilio.com',
          productId: 'prod-gw',
          tier: 'partial',
          startingPrice: null,
          sources: []
        }
      ]
    })

    // Settings › General: the grid shows each competitor's product and tier.
    await openHash(page, '#/project-settings')
    await page.getByRole('tab', { name: 'General', exact: true }).click()
    const general = page.getByRole('region', { name: 'General', exact: true })
    await expect(general.getByRole('grid', { name: 'Products' })).toBeVisible()
    const twilio = general.getByRole('combobox', { name: 'Product for Twilio' })
    await expect(twilio).toHaveValue('prod-gw')
    await expect(general.getByRole('combobox', { name: 'How close Twilio is' })).toHaveValue(
      'partial'
    )
    await twilio.selectOption('')
    await expect
      .poll(async () =>
        (await readCatalog(page)).competitors
          .filter((row) => row.name === 'Twilio')
          .map((row) => row.productId)
      )
      .toEqual([null])
    await general.getByRole('grid', { name: 'Competitors by product' }).scrollIntoViewIfNeeded()
    await expectMainAccessible(page)
    await page.screenshot({ path: await e2eArtifact('products-settings.png') })

    // The page header: Automatic first (this blog post names text alerts), then a pin.
    await openHash(page, '#/pages/page-1/results')
    const picker = page.getByRole('combobox', { name: 'Product' })
    await expect(picker).toHaveValue('auto')
    await expect(picker.locator('option').first()).toHaveText('Automatic (Email-to-SMS gateway)')
    await picker.selectOption('prod-bulk')
    await expect
      .poll(async () => readPageProduct(page))
      .toMatchObject({ productId: 'prod-bulk', pinned: true })
    await page.screenshot({ path: await e2eArtifact('products-page-header.png') })

    // The topic wizard's Seed step: the same choice, following the seed.
    await openAdd(page, 'Topic')
    await expect(
      page.getByRole('heading', { level: 1, name: 'What do you want to track?' })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(
      page.getByRole('heading', { level: 1, name: 'Start from a problem' })
    ).toBeVisible()
    await page.getByLabel('Problem or seed').fill('Run a bulk SMS marketing campaign for a shop')
    // The "Brand and markets" row names the product as a plain fact; Edit changes it.
    const brand = page.getByRole('region', { name: 'Brand and markets' })
    const fact = brand.getByRole('definition').filter({ hasText: 'Bulk SMS marketing' })
    await expect(fact).toHaveText('Bulk SMS marketing · auto')
    const edit = brand.getByRole('button', { name: 'Edit', exact: true })
    await edit.scrollIntoViewIfNeeded()
    // The row wraps instead of pushing Edit past the card's edge.
    const card = await brand.boundingBox()
    const button = await edit.boundingBox()
    expect(card && button && button.x + button.width <= card.x + card.width).toBe(true)
    await page.screenshot({ path: await e2eArtifact('products-topic-seed.png') })
    await edit.click()
    const topicPicker = brand.getByRole('combobox', { name: 'Product this topic is about' })
    await expect(topicPicker.locator('option').first()).toHaveText('Automatic (Bulk SMS marketing)')
    await topicPicker.selectOption('prod-gw')
    await expect(topicPicker).toHaveValue('prod-gw')
    await expect(brand.getByRole('definition').filter({ hasText: 'gateway' })).toHaveText(
      'Email-to-SMS gateway'
    )
    await expectMainAccessible(page)
    await brand.evaluate((node) => node.scrollIntoView({ block: 'end' }))
    await page.screenshot({ path: await e2eArtifact('products-topic-edit.png') })
  } finally {
    await close()
  }
})
