import type { CiteFoxApi } from '@shared/ipc'
import { expect, test, type Page } from '@playwright/test'
import { openHash, openTwoMarketApp, shot } from './screens-app'

type Bridge = typeof globalThis & { citefox: CiteFoxApi }

/** Ids from `seedTwoMarketProject` (screens-seed.ts, imported only after the raw-markdown hook). */
const SEED = { projectId: 'proj-1', pageId: 'page-1', uk: 'mkt-uk' } as const

async function currentHash(page: Page): Promise<string> {
  return page.evaluate(() => window.location.hash)
}

function switcher(page: Page, name: string): ReturnType<Page['getByRole']> {
  return page.getByRole('button', { name: new RegExp(`^Switch project, ${name}`) })
}

test('a link into another project switches project and opens the target in one step', async () => {
  test.setTimeout(180_000)
  const { page, close } = await openTwoMarketApp('cross-project')
  try {
    // A second project, made and opened on real IPC (creating a project opens it).
    const acme = await page.evaluate(() =>
      (globalThis as Bridge).citefox['projects:create']({
        name: 'Acme Clinics',
        domain: 'acmeclinics.com',
        includeSubdomains: false,
        brandNames: ['Acme Clinics'],
        competitors: [],
        clientName: 'Acme Clinics',
        country: 'US',
        language: 'en',
        location: null,
        device: 'desktop'
      })
    )
    await page.reload()
    // An empty project's plain landing opens the guided first run (focus mode, no
    // sidebar), so check the switcher on a screen of the app frame.
    await openHash(page, '#/connections')
    await expect(switcher(page, 'Acme Clinics')).toBeVisible()

    // Connections lists every project's Claude connection; TextBolt's name opens
    // TextBolt's Project settings, switching to it first.
    await openHash(page, '#/connections')
    await page.getByRole('tab', { name: /^Claude/ }).click()
    const link = page.getByRole('link', {
      name: 'Switch to TextBolt and open its Project settings › Claude'
    })
    await expect(link).toHaveAttribute('href', `#/p/${SEED.projectId}/project-settings`)
    await link.click()
    await expect(switcher(page, 'TextBolt')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'Project settings' })).toBeVisible()
    await expect.poll(() => currentHash(page)).toBe('#/project-settings')

    // A project route straight to a page: Acme is open, the page is TextBolt's.
    await openHash(page, `#/p/${acme.id}/pages`)
    await expect(switcher(page, 'Acme Clinics')).toBeVisible()
    await expect.poll(() => currentHash(page)).toBe('#/pages')
    await openHash(page, `#/p/${SEED.projectId}/pages/${SEED.pageId}/results?market=${SEED.uk}`)
    await expect(switcher(page, 'TextBolt')).toBeVisible()
    await expect(page.getByRole('tablist', { name: 'Page sections' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Results' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect
      .poll(() => currentHash(page))
      .toBe(`#/pages/${SEED.pageId}/results?market=${SEED.uk}`)
    await expect(page.getByText('That page is not in this project.')).toHaveCount(0)
    await shot(page, 'cross-project-page-1280x900')

    // Back skips the rewritten project route.
    await page.goBack()
    await expect.poll(() => currentHash(page)).toBe('#/pages')
  } finally {
    await close()
  }
})
