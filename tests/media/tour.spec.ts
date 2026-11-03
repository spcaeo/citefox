import { expect, test, type Locator, type Page } from '@playwright/test'
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { sidebar } from '../e2e/nav-helpers'
import { openHash } from '../e2e/screens-app'
import { Film, type Box } from './film'
import { go, open, OUT, QUESTION, seed, settle, VIEW } from './helpers'

/**
 * Footage for the welcome tour (src/renderer/src/assets/intro/tour.mp4): short real
 * clips and 2× stills of the TextBolt demo project in Sepia at 1440×900, on sample
 * data. Run `npm run media:tour` (scripts/media/make-tour.mjs), which runs this in
 * Docker and composes the film with Revideo (scripts/media/video/src/tour.tsx).
 *
 * The sponsor cards and the release line are hidden, and nothing is ever sent: the
 * Add questions draft is dropped and Check now is only pointed at, never pressed.
 * Output in CITEFOX_MEDIA_OUT/tour: clips/<name>/*.jpg + clips/<name>.ffconcat,
 * stills/<name>.jpg and film.json (the same shape the product video uses).
 */

test.skip(
  process.env.CITEFOX_MEDIA_DOCKER !== '1',
  'Media recording opens a visible window: run it with npm run media:tour (Docker).'
)

const HIDE = `
  .side-sponsor, .side-sponsor-mini, .sponsor-strip, .sponsor-strip-min,
  .sponsor-card, .sponsor-card-min, .write-with, .release-line { display: none !important; }`

/** The nearest `selector` around `target`, or null when it is not on screen. */
async function around(target: Locator, selector: string): Promise<Box | null> {
  try {
    return await target.first().evaluate(
      (node, sel) => {
        const host = node.closest(sel) ?? node
        const r = host.getBoundingClientRect()
        return { x: r.x, y: r.y, w: r.width, h: r.height }
      },
      selector,
      { timeout: 3000 }
    )
  } catch {
    return null
  }
}

async function boxOf(target: Locator): Promise<Box | null> {
  try {
    const box = await target.first().boundingBox({ timeout: 3000 })
    return box ? { x: box.x, y: box.y, w: box.width, h: box.height } : null
  } catch {
    return null
  }
}

/** Keeps only the boxes that were found, so a missing one never stops a long recording. */
function found(boxes: Record<string, Box | null>): Record<string, Box> {
  return Object.fromEntries(Object.entries(boxes).filter(([, box]) => box !== null)) as Record<
    string,
    Box
  >
}

async function warm(page: Page): Promise<void> {
  for (const hash of [
    '#/questions',
    QUESTION,
    '#/competitors',
    '#/fixes',
    '#/fixes?view=changes',
    '#/reports',
    '#/reports?report=visibility',
    '#/overview'
  ]) {
    await openHash(page, hash)
    await settle(page, 600)
  }
}

test('tour footage', async () => {
  test.setTimeout(900_000)
  const root = path.join(OUT, 'tour')
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
  const dir = await seed()
  const bin = path.join(dir, 'bin')
  await mkdir(bin, { recursive: true })
  const shim = path.resolve('tests/e2e/claude-shim.mjs')
  await writeFile(path.join(bin, 'claude'), `#!/bin/sh\nexec node ${JSON.stringify(shim)} "$@"\n`)
  await chmod(path.join(bin, 'claude'), 0o755)
  const { app, page } = await open(dir, {
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    CITEFOX_FIXTURE_DIR: path.resolve('src/main/providers/fixtures/textbolt'),
    CITEFOX_TEMPLATE_FIXTURE_DIRS: ['tests/media/fixtures', 'src/main/assistant/fixtures'].join(
      path.delimiter
    ),
    CITEFOX_SHIM_LOG: path.join(dir, 'shim.log')
  })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    ...VIEW,
    deviceScaleFactor: 2,
    mobile: false
  })
  const film = new Film(page, cdp, root)
  const m = page.locator('#main')
  const nav = sidebar(page)
  try {
    await page.addStyleTag({ content: HIDE })
    await warm(page)
    await go(page, '#/overview', 'Summary')
    await page.mouse.move(VIEW.width - 4, VIEW.height - 4)

    // 1. The AI answer your buyers read (a still: the tour opens on it).
    await go(page, QUESTION, /send a text message/)
    const latest = m.getByText('Show the latest check', { exact: true }).first()
    if (await latest.isVisible().catch(() => false)) {
      await latest.click()
      await settle(page, 600)
    }
    await film.still('answer', {
      answer: m.locator('div.aio-g'),
      own: m.locator('li.aio-src.is-own'),
      rail: m.locator('div.aio-rail'),
      title: page.getByRole('heading', { level: 1, name: /send a text message/ })
    })

    // 2. Add the questions buyers ask: + Add, Questions, type one in.
    await go(page, '#/questions', /Questions/)
    await film.start('add')
    await film.hold(0.3)
    const addButton = nav.getByRole('button', { name: 'Add', exact: true })
    await film.click(addButton, 0.7)
    await film.live(400)
    await film.click(
      nav.getByRole('list', { name: 'Add' }).getByRole('link', { name: 'Questions', exact: true }),
      0.5
    )
    const drawer = page.getByRole('dialog', { name: 'Add questions' })
    await expect(drawer).toBeVisible()
    await film.live(700)
    const field = drawer.getByRole('textbox', { name: 'Question 1', exact: true })
    await film.click(field, 0.5)
    await film.type('How do I send a text message from Outlook?', 17)
    await film.mark('typed', { drawer: (await boxOf(drawer)) ?? { x: 700, y: 60, w: 740, h: 800 } })
    await film.hold(0.5)
    await film.stop()
    await film.still('add', found({ drawer: await boxOf(drawer) }))
    // Nothing is saved: drop the draft and leave.
    await page.keyboard.press('Escape')
    await settle(page, 300)
    const guard = page.getByRole('alertdialog')
    if (await guard.isVisible().catch(() => false)) {
      await guard
        .getByRole('button', { name: /Discard|Leave|Close|Don.t save/i })
        .first()
        .click()
    }
    await go(page, '#/questions', /Questions/)

    // 3. The check: pick questions, point at Check now (never press it).
    await film.start('check')
    await film.hold(0.2)
    const grid = page.getByRole('grid', { name: 'Questions' })
    const boxes = grid.getByRole('checkbox', { name: /^Select (?!every)/ })
    for (const i of [0, 1, 2]) await film.click(boxes.nth(i), 0.4)
    const bar = page.getByRole('region', { name: 'Bulk actions' })
    await film.moveTo(bar.getByRole('button', { name: 'Check now' }), 0.5)
    await film.mark('point', { bar: (await boxOf(bar)) ?? { x: 330, y: 780, w: 1000, h: 70 } })
    await film.hold(0.3)
    await film.stop()
    await film.still('check', found({ bar: await boxOf(bar) }))
    await boxes.nth(0).uncheck()
    await boxes.nth(1).uncheck()
    await boxes.nth(2).uncheck()

    // 4. The result: cited in green, "Not cited" in orange (the Questions list's own chips).
    await film.start('result')
    await film.hold(0.5)
    await film.moveTo({ x: 1180, y: 300 }, 0.5)
    await film.hold(0.6)
    await film.stop()
    const rows = grid.getByRole('row')
    await film.still(
      'result',
      found({
        list: await boxOf(grid),
        cited: await around(rows.filter({ hasText: /Right page/ }).first(), '[role="row"]'),
        notCited: await around(rows.filter({ hasText: 'Not cited' }).first(), '[role="row"]')
      })
    )

    // 5. Who is cited instead.
    await film.start('rivals')
    await film.click(nav.getByRole('link', { name: /^Competitors\b/ }), 0.8)
    await film.live(900)
    await expect(page.getByRole('heading', { level: 1, name: 'Competitors' })).toBeVisible()
    await settle(page, 300)
    const twilio = m.getByText('twilio.com', { exact: true }).last()
    const twilioRow = await around(twilio, '.ui-lg-row, tr, [role="row"]')
    if (twilioRow) {
      await film.moveTo(
        { x: twilioRow.x + twilioRow.w - 60, y: twilioRow.y + twilioRow.h + 30 },
        0.8
      )
    }
    await film.hold(0.3)
    await film.stop()
    await film.still('rivals', found({ row: twilioRow }))

    // 6a. A fix: the page to fix and its brief.
    await film.start('fix')
    await film.click(nav.getByRole('link', { name: /^Fixes\b/ }), 0.8)
    await film.live(900)
    await expect(page.getByRole('heading', { level: 1, name: 'Fixes' })).toBeVisible()
    await settle(page, 300)
    const pathCell = m.getByText(/how-to-set-up-text-alerts/).first()
    if (!(await pathCell.isVisible())) {
      await film.click(m.getByText('Improve a page', { exact: true }).first(), 0.7)
      await film.live(500)
    }
    await film.hold(0.3)
    await film.click(pathCell, 0.7)
    const fixDrawer = page.getByRole('dialog', { name: /Improve a page/ })
    await film.live(900)
    await expect(fixDrawer).toBeVisible()
    await settle(page, 400)
    await film.hold(0.3)
    await film.stop()
    await film.still(
      'fix',
      found({
        title: await boxOf(fixDrawer.getByRole('heading', { name: /Improve a page/ })),
        brief: await around(fixDrawer.getByText('Get fix brief').first(), 'section'),
        searches: await around(fixDrawer.getByText('Searches it can win').first(), 'section')
      })
    )
    await page.keyboard.press('Escape')
    await expect(fixDrawer).toHaveCount(0)
    await settle(page, 300)

    // 6b. Did it work? The 14-day verdict.
    await film.start('verdict')
    await film.hold(0.2)
    const tab = m.getByRole('tab', { name: /^Did it work\?/ })
    if (await tab.isVisible().catch(() => false)) await film.click(tab, 0.7)
    else await openHash(page, '#/fixes?view=changes')
    await film.live(900)
    await settle(page, 400)
    await film.hold(0.4)
    await film.stop()
    await film.still(
      'verdict',
      found({ ledger: await around(m.locator('[data-verdict]').first(), '[role="grid"], section') })
    )

    // 7. A client report: Reports, then the Visibility report's opportunity.
    await film.start('report')
    await film.click(nav.getByRole('link', { name: /^Reports\b/ }), 0.8)
    await film.live(900)
    await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible()
    await settle(page, 300)
    const stand = m.locator('section.rv-card').filter({ hasText: 'Where do we stand?' })
    await film.moveTo(stand.getByText('51 of 190').first(), 0.8)
    await film.hold(0.3)
    await film.stop()
    await film.still(
      'report',
      found({ stand: await boxOf(stand), goals: await boxOf(m.locator('div.rv-goal-grid')) })
    )

    await film.start('opportunity')
    await film.click(stand.getByRole('button', { name: 'Open' }).first(), 0.7)
    await film.live(900)
    if (
      !(await page
        .locator('#rv-opp-title')
        .isVisible()
        .catch(() => false))
    ) {
      await openHash(page, '#/reports?report=visibility')
    }
    await expect(page.locator('#rv-opp-title')).toBeVisible()
    await settle(page, 300)
    await film.hold(0.3)
    await film.scrollTo(page.locator('#rv-opp-title'), 90, 1.4)
    await film.hold(0.3)
    await film.stop()
    const oppPanel = m.locator('.rv-panel').filter({ has: page.locator('#rv-opp-title') })
    await film.still('opportunity', found({ panel: await boxOf(oppPanel) }))
    await film.save()
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
