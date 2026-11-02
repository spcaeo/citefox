#!/usr/bin/env node
/**
 * Refreshes the marketing screenshots in media/ (README and download site):
 * hero.png, summary.png, question.png, reports-home.png, report-visibility.png,
 * competitors.png and fixes.png. The product video is `npm run media:video`
 * (scripts/media/make-video.mjs).
 *
 *   npm run media:record                      # record in Docker, then compress
 *   npm run media:record -- --rebuild         # rebuild the e2e image first
 *   npm run media:record -- --process <dir>   # only compress an earlier raw run
 *
 * 1. Runs tests/media/demo.spec.ts inside the e2e Docker image (scripts/media/
 *    container.mjs), so no window opens on your screen. The spec seeds the TextBolt
 *    demo project, opens the app at 1440×900 in Sepia and takes 2× screenshots.
 * 2. Copies the raw output back to a temporary folder.
 * 3. Resizes the PNGs to 2400 px wide and compresses them, with ImageMagick on this
 *    computer when it is installed, otherwise inside the container.
 * 4. Removes the container and the temporary folder.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appDir, docker, hasTool, log, openContainer, root } from './container.mjs'

const mediaDir = join(root, 'media')
const SHOTS = [
  'hero',
  'summary',
  'question',
  'reports-home',
  'report-visibility',
  'competitors',
  'fixes'
]

const args = process.argv.slice(2)
const processIndex = args.indexOf('--process')
const processOnly = processIndex >= 0 ? args[processIndex + 1] : undefined
const box = openContainer({ name: 'citefox-media', rebuild: args.includes('--rebuild') })

async function record() {
  await box.start()
  log('Recording the screenshots')
  const code = await box.playwright('tests/media/playwright.config.ts', 'demo.spec.ts')
  if (code !== 0) box.fail(`The media spec failed (exit ${code}).`)
  const raw = mkdtempSync(join(tmpdir(), 'citefox-media-raw-'))
  box.copyOut(`${appDir}/test-results/media-out/.`, raw)
  return raw
}

async function encode(raw) {
  const local = hasTool('magick', ['-version'])
  if (!local && !box.started) box.fail('ImageMagick is needed for --process.')
  if (!local) {
    log('Installing ImageMagick in the container')
    const code = await box.exec(
      'apt-get update -qq && apt-get install -y -qq --no-install-recommends imagemagick >/dev/null',
      { user: 'root' }
    )
    if (code !== 0) box.fail('Installing ImageMagick in the container failed')
  }
  mkdirSync(mediaDir, { recursive: true })
  log('Screenshots: 2400 px wide, compressed')
  for (const name of SHOTS) {
    if (!existsSync(join(raw, 'shots', `${name}.png`))) box.fail(`Missing shot ${name}.png`)
    const resize = [
      `shots/${name}.png`,
      '-resize',
      '2400x',
      '-strip',
      '-colors',
      '256',
      '-define',
      'png:compression-level=9',
      `out-${name}.png`
    ]
    if (local) {
      if (spawnSync('magick', resize, { cwd: raw, stdio: 'inherit' }).status !== 0)
        box.fail('magick failed')
    } else {
      const work = `${appDir}/test-results/media-out`
      if (docker(['exec', '-w', work, box.container, 'convert', ...resize]).status !== 0)
        box.fail('convert failed in the container')
      box.copyOut(`${work}/out-${name}.png`, join(raw, `out-${name}.png`))
    }
    copyFileSync(join(raw, `out-${name}.png`), join(mediaDir, `${name}.png`))
    console.log(
      `  media/${name}.png  ${(statSync(join(mediaDir, `${name}.png`)).size / 1024).toFixed(0)} KB`
    )
  }
}

if (processOnly) {
  await encode(processOnly)
} else {
  const raw = await record()
  try {
    await encode(raw)
  } finally {
    rmSync(raw, { recursive: true, force: true })
  }
}
box.cleanup()
log('Done: media/ is up to date. Look at each file before you commit it.')
