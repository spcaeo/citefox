import { expect, test, type Locator, type Page } from '@playwright/test'
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { sidebar } from '../e2e/nav-helpers'
import { openHash } from '../e2e/screens-app'
import { Film, type Box } from './film'
import { go, open, OUT, QUESTION, seed, settle, VIEW } from './helpers'

/**
 * Footage for the product video (media/demo.mp4): real clips and 2× stills of the
 * TextBolt demo project, in Sepia at 1440×900. Run `npm run media:video`
 * (scripts/media/make-video.mjs), which runs this inside Docker, then composes the
 * video with Revideo (scripts/media/video). It refuses to run outside that container.
 *
 * Output in CITEFOX_MEDIA_OUT/video: clips/<name>/*.jpg with clips/<name>.ffconcat,
 * stills/<name>.jpg, and film.json (clip lengths, and each still's highlight boxes in
 * CSS px). Ask CiteFox answers through the e2e stand-in for the AI
 * (tests/e2e/claude-shim.mjs) with tests/media/fixtures/assistant_help.json, so no
 * live call is made.
 */

test.skip(
  process.env.CITEFOX_MEDIA_DOCKER !== '1',
  'Media recording opens a visible window: run it with npm run media:video (Docker).'
)

/** The box of the nearest `selector` around `target` (a whole row, a whole card). */
async function around(target: Locator, selector: string): Promise<Box> {
  const box = await target.first().evaluate((node, sel) => {
    const host = node.closest(sel) ?? node
    const r = host.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  }, selector)
  return box
}

async function warm(page: Page): Promise<void> {
  for (const hash of [
    '#/questions',
    QUESTION,
    '#/competitors',
    '#/fixes',
    '#/reports',
    '#/reports?report=visibility',
    '#/overview'
  ]) {
    await openHash(page, hash)
    await settle(page, 600)
  }
}

test('video footage', async () => {
  test.setTimeout(900_000)
  const root = path.join(OUT, 'video')
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
    await warm(page)
    await go(page, '#/overview', 'Summary')
    await page.mouse.move(VIEW.width - 4, VIEW.height - 4)

    // 2. Summary: the headline numbers.
    await film.start('summary')
    await film.hold(0.4)
    const cited = m.locator('section.ui-kpi').filter({ hasText: /You.re cited/ })
    const citedBox = await around(cited, 'section.ui-kpi')
    await film.moveTo({ x: citedBox.x + citedBox.w * 0.86, y: citedBox.y + citedBox.h + 26 }, 0.9)
    await film.hold(0.3)
    await film.stop()
    await film.still('summary', {
      cited: citedBox,
      trend: cited.locator('.ui-kpi-trend'),
      kpis: m.locator('section.ov-kpis'),
      glance: await around(m.getByText('Results at a glance').first(), 'section, .ui-panel')
    })

    // 3. The question page: the AI Overview, its sources, this page.
    await go(page, '#/questions', /Questions/)
    await film.start('question')
    await film.hold(0.3)
    const search = m.getByPlaceholder(/^Search \d+ questions/).first()
    await film.mark('search', { search })
    await film.click(search, 0.7)
    await film.type('Outlook', 12)
    await film.live(600)
    await settle(page, 200)
    await film.hold(0.3)
    const row = m.getByText('How do I send a text message from Outlook?', { exact: true }).first()
    if ((await row.count()) > 0 && (await row.isVisible())) {
      await film.mark('row', { row })
      await film.click(row, 0.8)
      await film.mark('open')
      await film.live(900)
    }
    if (!(await page.evaluate(() => location.hash)).includes('/prompt/page-outlook-q0')) {
      await openHash(page, QUESTION)
    }
    await expect(page.getByRole('heading', { level: 1, name: /send a text message/ })).toBeVisible()
    await settle(page, 400)
    // From the list it opens on the list's check; the video shows the latest one.
    const latest = m.getByText('Show the latest check', { exact: true }).first()
    if (await latest.isVisible().catch(() => false)) {
      await film.click(latest, 0.5)
      await film.live(500)
      await settle(page, 300)
    }
    await film.moveTo({ x: 1240, y: 860 }, 0.6)
    await film.hold(0.3)
    await film.stop()
    const kpis = m.locator('section.pd2-kpis section.ui-kpi')
    await film.still('question', {
      status: kpis.nth(0),
      position: kpis.nth(1),
      own: m.locator('li.aio-src.is-own'),
      rail: m.locator('div.aio-rail'),
      answer: m.locator('div.aio-g'),
      title: page.getByRole('heading', { level: 1, name: /send a text message/ })
    })

    // 4. Competitors: who AI cites instead.
    await film.start('competitors')
    await film.click(nav.getByRole('link', { name: /^Competitors\b/ }), 0.8)
    await film.live(900)
    await expect(page.getByRole('heading', { level: 1, name: 'Competitors' })).toBeVisible()
    await settle(page, 300)
    const twilio = m.getByText('twilio.com', { exact: true }).last()
    const twilioRow = await around(twilio, '.ui-lg-row, tr, [role="row"]')
    await film.moveTo({ x: twilioRow.x + twilioRow.w - 60, y: twilioRow.y + twilioRow.h + 30 }, 0.8)
    await film.hold(0.3)
    await film.stop()
    await film.still('competitors', {
      top: m.locator('section.ui-kpi').filter({ hasText: /Top competitor/ }),
      share: m.locator('section.ui-kpi').filter({ hasText: /Your share of citations/ }),
      row: twilioRow
    })

    // 5. Fixes: the page to fix and its brief.
    await film.start('fixes')
    await film.click(nav.getByRole('link', { name: /^Fixes\b/ }), 0.8)
    await film.live(900)
    await expect(page.getByRole('heading', { level: 1, name: 'Fixes' })).toBeVisible()
    await settle(page, 300)
    const pathCell = m.getByText(/how-to-set-up-text-alerts/).first()
    if (!(await pathCell.isVisible())) {
      await film.click(m.getByText('Improve a page', { exact: true }).first(), 0.7)
      await film.live(500)
    }
    await film.hold(0.4)
    await film.click(pathCell, 0.8)
    await film.mark('open')
    const drawer = page.getByRole('dialog', { name: /Improve a page/ })
    await film.live(900)
    await expect(drawer).toBeVisible()
    await settle(page, 400)
    await film.moveTo({ x: 700, y: 330 }, 0.6)
    await film.hold(0.3)
    await film.stop()
    await film.still('fix', {
      title: drawer.getByRole('heading', { name: /Improve a page/ }).first(),
      brief: await around(drawer.getByText('Get fix brief').first(), 'section'),
      searches: await around(drawer.getByText('Searches it can win').first(), 'section'),
      rail: await around(drawer.getByText('The fix', { exact: true }).first(), 'section')
    })
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
    await settle(page, 300)

    // 6. Reports: By goal, the Visibility report's opportunity, a drill.
    await film.start('reports')
    await film.click(nav.getByRole('link', { name: /^Reports\b/ }), 0.8)
    await film.live(900)
    await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible()
    await settle(page, 300)
    const stand = m.locator('section.rv-card').filter({ hasText: 'Where do we stand?' })
    await film.moveTo(stand.getByText('51 of 190').first(), 0.8)
    await film.hold(0.3)
    await film.stop()
    await film.still('reports', {
      stand,
      goals: m.locator('div.rv-goal-grid')
    })

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
    const panel = m.locator('.rv-panel').filter({ has: page.locator('#rv-opp-title') })
    await film.still('opportunity', {
      panel,
      bars: panel.locator('svg').first(),
      invisible: panel.locator('.rv-legend li').first(),
      funnel: m.locator('.rv-panel').filter({ has: page.locator('#rv-funnel-title') })
    })

    await film.start('drill')
    // "Invisible 39": the questions where the answer neither cites nor names you.
    await film.click(panel.locator('.rv-legend .rv-fig').first(), 0.7)
    await film.live(900)
    const drill = page.getByRole('dialog').first()
    await expect(drill).toBeVisible()
    await settle(page, 400)
    await film.hold(0.3)
    await film.stop()
    await film.still('drill', { drawer: drill })
    await page.keyboard.press('Escape')
    await settle(page, 300)

    // Ask CiteFox: Ctrl+K typing, then the answer streaming in.
    await go(page, '#/overview', 'Summary')
    await film.start('ask')
    await film.hold(0.4)
    const find = page.getByRole('combobox', { name: /^Find anything/u })
    await page.keyboard.press('Control+k')
    await film.hold(0.25)
    await film.mark('typing', { find })
    await film.type('Why is What changed empty', 13)
    await film.live(700)
    await film.mark('results', {
      find,
      list: page.getByRole('listbox').first()
    })
    await film.hold(0.8)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    const ask = page.getByRole('banner').getByRole('button', { name: 'Ask CiteFox', exact: true })
    await film.click(ask, 0.6)
    const dialog = page.getByRole('dialog', { name: 'Ask CiteFox' })
    await film.live(700)
    await expect(dialog).toBeVisible()
    await film.mark('drawer')
    await film.hold(0.3)
    // The drawer suggests this very question for Summary: a real click asks it.
    await film.click(
      dialog.getByRole('button', { name: 'Why is What changed empty?' }).first(),
      0.7
    )
    const answer = dialog.locator('p.asst-answer-text').first()
    await expect(answer).toBeVisible({ timeout: 30_000 })
    await film.mark('answer')
    await film.stream(answer, 24, dialog.locator('section.asst-answer > :not(p.asst-answer-text)'))
    await film.hold(0.4)
    await film.stop()
    await film.still('ask', {
      answer: dialog.locator('section.asst-answer').first(),
      question: await around(dialog.getByText('Why is What changed empty?').first(), 'div, li')
    })
    await film.save()
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
