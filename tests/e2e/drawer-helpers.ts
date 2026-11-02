import type { Page } from '@playwright/test'
import { e2eArtifact } from './artifacts'

/** The two windows every drawer is checked at (the owner's board sizes). */
export const DRAWER_SIZES = [
  { width: 1440, height: 900 },
  { width: 1134, height: 770 }
] as const

/** Waits for the drawer's slide-in (and any other running animation) to end. */
export async function animationsDone(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => undefined))
    )
  })
}

/**
 * Screenshots the open drawer at both sizes as `drawer-<name>-<width>.png`
 * in the e2e artifacts folder, then puts the window back to `restore`.
 */
export async function drawerShots(
  page: Page,
  name: string,
  restore: { width: number; height: number } = { width: 1280, height: 900 }
): Promise<void> {
  for (const size of DRAWER_SIZES) {
    await page.setViewportSize(size)
    await animationsDone(page)
    await page.screenshot({ path: await e2eArtifact(`drawer-${name}-${size.width}.png`) })
  }
  await page.setViewportSize(restore)
}
